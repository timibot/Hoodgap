/**
 * simulate-weekend.js — Simulate a weekend gap scenario on localhost
 *
 * Deploys fresh, seeds pool, buys multiple policies at different thresholds,
 * then simulates various gap sizes (2%, 5%, 10%) to show which settle.
 *
 * Usage:
 *   npx hardhat run scripts/simulate-weekend.js --network localhost
 */

const hre = require("hardhat");

const USDC_DECIMALS = 6;
const ORACLE_DECIMALS = 8;
const toUSDC = (n) => BigInt(Math.round(n * 10 ** USDC_DECIMALS));
const toOracle = (n) => BigInt(Math.round(n * 10 ** ORACLE_DECIMALS));
const fromUSDC = (n) => Number(n) / 10 ** USDC_DECIMALS;
const fmt = (n) => `$${fromUSDC(n).toLocaleString("en-US", { minimumFractionDigits: 2 })}`;
const divider = () => console.log("─".repeat(65));

async function main() {
  console.log("\n🌙 HoodGap — Weekend Gap Simulation");
  console.log("   Network:", hre.network.name);
  divider();

  const [deployer, staker, buyer1, buyer2, buyer3] = await hre.ethers.getSigners();
  const NOW = (await hre.ethers.provider.getBlock("latest")).timestamp;

  // ── Deploy ──────────────────────────────────────────────────────

  const FRIDAY_PRICE = 350.0;

  const usdc = await (await hre.ethers.getContractFactory("MockUSDC")).deploy();
  const oracle = await (await hre.ethers.getContractFactory("MockChainlinkOracle")).deploy(
    toOracle(FRIDAY_PRICE), NOW
  );
  const hoodgap = await (await hre.ethers.getContractFactory("HoodGap")).deploy(
    await usdc.getAddress(), await oracle.getAddress()
  );

  const hgAddr = await hoodgap.getAddress();
  console.log("  Contracts deployed to localhost");

  // ── Seed pool ───────────────────────────────────────────────────

  const POOL = toUSDC(500_000);
  await usdc.mint(staker.address, POOL);
  await usdc.connect(staker).approve(hgAddr, POOL);
  await hoodgap.connect(staker).stake(POOL);
  console.log(`  Pool seeded with ${fmt(POOL)}`);

  // Approve settlement
  const week = await hoodgap.getCurrentSettlementWeek();
  await hoodgap.approveSettlement(week, 10000, "Simulation — no split");

  divider();

  // ── Buy policies at different thresholds ────────────────────────

  console.log("\n  📋 Buying policies at different thresholds:\n");

  const buyers = [
    { signer: buyer1, name: "Buyer1", coverage: 1000, threshold: 500 },  // 5%
    { signer: buyer2, name: "Buyer2", coverage: 2000, threshold: 1000 }, // 10%
    { signer: buyer3, name: "Buyer3", coverage: 500,  threshold: 1500 }, // 15%
  ];

  const policyIds = [];

  for (const b of buyers) {
    const cov = toUSDC(b.coverage);
    await usdc.mint(b.signer.address, toUSDC(10_000));
    await usdc.connect(b.signer).approve(hgAddr, toUSDC(10_000));

    const premium = await hoodgap.calculatePremium(cov);
    const tx = await hoodgap.connect(b.signer).buyPolicy(cov, b.threshold);
    const receipt = await tx.wait();

    const event = receipt.logs.find(
      (l) => { try { return hoodgap.interface.parseLog(l)?.name === "PolicyPurchased"; } catch { return false; } }
    );
    const id = event ? hoodgap.interface.parseLog(event).args.policyId : 0n;
    policyIds.push({ ...b, id, premium });

    console.log(
      `  Policy #${id}: ${b.name} — $${b.coverage} coverage @ ${b.threshold / 100}% threshold (premium: ${fmt(premium)})`
    );
  }

  divider();

  // ── Simulate gaps ───────────────────────────────────────────────

  const GAP_SCENARIOS = [
    { name: "Small gap (2%)", pct: 0.02 },
    { name: "Medium gap (8%)", pct: 0.08 },
    { name: "Large gap (12%)", pct: 0.12 },
  ];

  for (const scenario of GAP_SCENARIOS) {
    console.log(`\n  📉 Scenario: ${scenario.name}`);
    console.log("  " + "─".repeat(55));

    // Snapshot so we can reset between scenarios
    const snapshotId = await hre.network.provider.send("evm_snapshot");

    // Time-travel to Monday
    await hre.network.provider.send("evm_increaseTime", [3 * 24 * 60 * 60]);
    await hre.network.provider.send("evm_mine");

    const newBlock = await hre.ethers.provider.getBlock("latest");
    const mondayPrice = FRIDAY_PRICE * (1 - scenario.pct);
    await oracle.update(toOracle(mondayPrice), newBlock.timestamp);
    await hoodgap.updateWeekTiming();

    console.log(`  Friday: $${FRIDAY_PRICE.toFixed(2)} → Monday: $${mondayPrice.toFixed(2)} (${(scenario.pct * 100).toFixed(0)}% gap)`);
    console.log("");

    for (const p of policyIds) {
      const triggers = scenario.pct * 10000 >= p.threshold;
      const symbol = triggers ? "💸" : "📭";
      const result = triggers ? "PAYS OUT" : "Expires worthless";

      if (triggers) {
        // Actually settle on-chain
        const balBefore = await usdc.balanceOf(p.signer.address);
        try {
          await hoodgap.connect(p.signer).settlePolicy(p.id);
          const balAfter = await usdc.balanceOf(p.signer.address);
          const payout = balAfter - balBefore;
          console.log(`  ${symbol} Policy #${p.id} (${p.threshold / 100}% threshold): ${result} → ${fmt(payout)}`);
        } catch (e) {
          console.log(`  ❌ Policy #${p.id}: Settlement failed — ${e.reason || e.message}`);
        }
      } else {
        console.log(`  ${symbol} Policy #${p.id} (${p.threshold / 100}% threshold): ${result}`);
      }
    }

    // Revert to snapshot for next scenario
    await hre.network.provider.send("evm_revert", [snapshotId]);
  }

  divider();
  console.log("\n  🏁 Simulation complete!\n");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
