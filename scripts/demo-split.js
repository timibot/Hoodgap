/**
 * demo-split.js — Stock Split Demo for HoodGap Protocol
 *
 * Demonstrates how the protocol handles a Tesla 2:1 stock split:
 *   - Scenario A: Guardian correctly sets split ratio → no false payout
 *   - Scenario B: Guardian forgets split ratio → false payout occurs
 *
 * This highlights why the guardian role is critical for corporate actions.
 *
 * Usage:
 *   npx hardhat run scripts/demo-split.js --network localhost
 */

const hre = require("hardhat");

const USDC_DECIMALS = 6;
const ORACLE_DECIMALS = 8;
const toUSDC = (n) => BigInt(Math.round(n * 10 ** USDC_DECIMALS));
const toOracle = (n) => BigInt(Math.round(n * 10 ** ORACLE_DECIMALS));
const fromUSDC = (n) => Number(n) / 10 ** USDC_DECIMALS;
const fmt = (n) => `$${fromUSDC(n).toLocaleString("en-US", { minimumFractionDigits: 2 })}`;
const divider = () => console.log("─".repeat(65));

async function runScenario(name, splitRatio, splitDesc) {
  console.log(`\n  🔬 ${name}`);
  console.log("  " + "─".repeat(55));

  const [deployer, staker, buyer] = await hre.ethers.getSigners();

  // Deploy fresh
  const usdc = await (await hre.ethers.getContractFactory("MockUSDC")).deploy();
  const FRIDAY_PRICE = 250.0; // Pre-split price
  const now = (await hre.ethers.provider.getBlock("latest")).timestamp;
  const oracle = await (await hre.ethers.getContractFactory("MockChainlinkOracle")).deploy(
    toOracle(FRIDAY_PRICE), now
  );
  const hoodgap = await (await hre.ethers.getContractFactory("HoodGap")).deploy(
    await usdc.getAddress(), await oracle.getAddress()
  );
  const hgAddr = await hoodgap.getAddress();

  // Seed pool
  const pool = toUSDC(100_000);
  await usdc.mint(staker.address, pool);
  await usdc.connect(staker).approve(hgAddr, pool);
  await hoodgap.connect(staker).stake(pool);

  // Approve settlement WITH the split ratio
  const week = await hoodgap.getCurrentSettlementWeek();
  await hoodgap.approveSettlement(week, splitRatio, splitDesc);

  // Buy policy
  const coverage = toUSDC(5_000);
  const threshold = 500; // 5%
  await usdc.mint(buyer.address, toUSDC(10_000));
  await usdc.connect(buyer).approve(hgAddr, toUSDC(10_000));
  const tx = await hoodgap.connect(buyer).buyPolicy(coverage, threshold);
  const receipt = await tx.wait();
  const event = receipt.logs.find(
    (l) => { try { return hoodgap.interface.parseLog(l)?.name === "PolicyPurchased"; } catch { return false; } }
  );
  const policyId = event ? hoodgap.interface.parseLog(event).args.policyId : 0n;

  const policy = await hoodgap.policies(policyId);
  const fridayClose = Number(policy.fridayClose) / 10 ** ORACLE_DECIMALS;

  // Time-travel to Monday
  const mondayTimestamp = await hoodgap.getMonday(week);
  const targetTime = Number(mondayTimestamp) + 60;
  const currentBlock = await hre.ethers.provider.getBlock("latest");
  const jumpSeconds = targetTime - currentBlock.timestamp;
  if (jumpSeconds > 0) {
    await hre.network.provider.send("evm_increaseTime", [jumpSeconds]);
    await hre.network.provider.send("evm_mine");
  }

  // Monday price: Post-split $130 (was $250 pre-split, 2:1 → $125 adjusted, so $130 = 4% gain)
  const MONDAY_PRICE = 130.0;
  const newBlock = await hre.ethers.provider.getBlock("latest");
  await oracle.update(toOracle(MONDAY_PRICE), newBlock.timestamp);
  await hoodgap.updateWeekTiming();

  // Calculate what the contract will see
  const adjustedFriday = fridayClose * splitRatio / 10000;
  const actualGap = Math.abs(MONDAY_PRICE - adjustedFriday) / adjustedFriday * 100;

  console.log(`  Friday close (recorded):  $${fridayClose.toFixed(2)}`);
  console.log(`  Split ratio:              ${splitRatio / 10000}x (${splitDesc})`);
  console.log(`  Adjusted Friday:          $${adjustedFriday.toFixed(2)}`);
  console.log(`  Monday open:              $${MONDAY_PRICE.toFixed(2)}`);
  console.log(`  Calculated gap:           ${actualGap.toFixed(1)}%`);
  console.log(`  Threshold:                ${threshold / 100}%`);

  // Settle
  const buyerBefore = await usdc.balanceOf(buyer.address);
  try {
    await hoodgap.connect(buyer).settlePolicy(policyId);
    const buyerAfter = await usdc.balanceOf(buyer.address);
    const payout = buyerAfter - buyerBefore;

    if (payout > 0n) {
      console.log(`\n  💸 PAYOUT: ${fmt(payout)}`);
    } else {
      console.log(`\n  📭 No payout — gap below threshold`);
    }
  } catch (e) {
    console.log(`\n  ❌ Settlement failed: ${e.reason || e.message}`);
  }

  return;
}

async function main() {
  console.log("\n📊 HoodGap Protocol — Stock Split Demo");
  console.log("   Demonstrating 2:1 Tesla stock split handling");
  divider();
  console.log("");
  console.log("  Setup: TSLA closes at $250 on Friday");
  console.log("  Event: 2:1 stock split over the weekend");
  console.log("  Monday: TSLA opens at $130 (4% GAIN post-split)");
  console.log("");
  console.log("  Without split adjustment: $250 → $130 looks like -48% gap! 😱");
  console.log("  With split adjustment:    $125 → $130 is actually +4% gain ✅");

  divider();

  // Scenario A: Guardian correctly sets 2:1 split
  await runScenario(
    "Scenario A: Guardian sets 2:1 split ratio (CORRECT)",
    5000,  // 0.5x = 2:1 split
    "TSLA 2:1 split effective Monday"
  );

  console.log("  ✅ Correct: No false payout! The $250→$130 is recognized as a split.\n");

  // Take a snapshot to reset state for next scenario
  const snapshotId = await hre.network.provider.send("evm_snapshot");

  divider();

  // Scenario B: Guardian forgets to set split ratio
  await runScenario(
    "Scenario B: Guardian forgets split ratio (INCORRECT)",
    10000, // 1.0x = no split adjustment
    "Normal week — no split"
  );

  console.log("  ⚠️  WRONG: False payout! Without split adjustment, $250→$130 = 48% gap!\n");

  await hre.network.provider.send("evm_revert", [snapshotId]);

  divider();

  console.log("\n  🎓 LESSON:");
  console.log("  The guardian MUST set the split ratio before settlement when a");
  console.log("  corporate action occurs. This is why the guardian role is critical.");
  console.log("  The 48h failsafe defaults to 1.0x, so a missing guardian during a");
  console.log("  split week would cause false payouts.\n");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
