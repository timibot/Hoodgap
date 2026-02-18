/**
 * demo-lifecycle.js — Full HoodGap Protocol Lifecycle Demo
 *
 * Demonstrates: Deploy → Seed → Buy Policy → Time-Travel → Settle → Withdraw
 * Uses Hardhat time manipulation on localhost for a live walkthrough.
 *
 * Usage:
 *   npx hardhat run scripts/demo-lifecycle.js --network localhost
 */

const hre = require("hardhat");

// ── Helpers ──────────────────────────────────────────────────────────

const USDC_DECIMALS = 6;
const ORACLE_DECIMALS = 8;
const toUSDC = (n) => BigInt(Math.round(n * 10 ** USDC_DECIMALS));
const toOracle = (n) => BigInt(Math.round(n * 10 ** ORACLE_DECIMALS));
const fromUSDC = (n) => Number(n) / 10 ** USDC_DECIMALS;
const fmt = (n) => `$${fromUSDC(n).toLocaleString("en-US", { minimumFractionDigits: 2 })}`;
const divider = () => console.log("─".repeat(60));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  console.log("\n🎬 HoodGap Protocol — Full Lifecycle Demo");
  console.log("   Network:", hre.network.name);
  divider();

  const [deployer, staker, buyer] = await hre.ethers.getSigners();
  console.log("👤 Deployer/Guardian:", deployer.address);
  console.log("👤 Staker:          ", staker.address);
  console.log("👤 Buyer:           ", buyer.address);
  divider();

  // ── Step 1: Deploy contracts ─────────────────────────────────────

  console.log("\n📦 STEP 1: Deploying contracts...\n");

  const block = await hre.ethers.provider.getBlock("latest");
  const now = block.timestamp;

  const MockUSDC = await hre.ethers.getContractFactory("MockUSDC");
  const usdc = await MockUSDC.deploy();
  await usdc.waitForDeployment();
  console.log("  ✅ MockUSDC:  ", await usdc.getAddress());

  const fridayPrice = 350.0;
  const MockOracle = await hre.ethers.getContractFactory("MockChainlinkOracle");
  const oracle = await MockOracle.deploy(toOracle(fridayPrice), now);
  await oracle.waitForDeployment();
  console.log("  ✅ MockOracle:", await oracle.getAddress());

  const HoodGap = await hre.ethers.getContractFactory("HoodGap");
  const hoodgap = await HoodGap.deploy(await usdc.getAddress(), await oracle.getAddress());
  await hoodgap.waitForDeployment();
  console.log("  ✅ HoodGap:   ", await hoodgap.getAddress());

  divider();

  // ── Step 2: Fund accounts & seed pool ────────────────────────────

  console.log("\n💰 STEP 2: Funding accounts & seeding pool...\n");

  // Mint USDC to staker and buyer
  const stakeAmount = toUSDC(100_000);
  const buyerFunds = toUSDC(10_000);

  await usdc.mint(staker.address, stakeAmount);
  await usdc.mint(buyer.address, buyerFunds);
  console.log(`  Minted ${fmt(stakeAmount)} USDC to Staker`);
  console.log(`  Minted ${fmt(buyerFunds)} USDC to Buyer`);

  // Staker approves & stakes
  const hoodgapAddr = await hoodgap.getAddress();
  await usdc.connect(staker).approve(hoodgapAddr, stakeAmount);
  await hoodgap.connect(staker).stake(stakeAmount);
  console.log(`  Staker deposited ${fmt(stakeAmount)} into pool ✅`);

  // Show pool stats
  const stats1 = await hoodgap.getPoolStats();
  console.log(`\n  📊 Pool Stats After Seeding:`);
  console.log(`     Total Staked:    ${fmt(stats1[0])}`);
  console.log(`     Total Coverage:  ${fmt(stats1[1])}`);
  console.log(`     Utilization:     ${Number(stats1[2]) / 100}%`);

  divider();

  // ── Step 3: Guardian approves settlement for this week ───────────

  console.log("\n🛡️  STEP 3: Guardian approves settlement...\n");

  const settlementWeek = await hoodgap.getCurrentSettlementWeek();
  console.log(`  Settlement week: ${settlementWeek}`);

  await hoodgap.approveSettlement(settlementWeek, 10000, "No split — normal week");
  console.log("  ✅ Settlement approved (1.0x ratio, no split)");

  divider();

  // ── Step 4: Buyer purchases policy ───────────────────────────────

  console.log("\n🛒 STEP 4: Buying gap insurance policy...\n");

  const coverage = toUSDC(500);
  const threshold = 500; // 5% gap

  // Calculate premium preview
  const premium = await hoodgap.calculatePremium(coverage);
  console.log(`  Coverage:   ${fmt(coverage)}`);
  console.log(`  Threshold:  ${threshold / 100}%`);
  console.log(`  Premium:    ${fmt(premium)}`);
  console.log(`  Rate:       ${((fromUSDC(premium) / fromUSDC(coverage)) * 100).toFixed(2)}%`);

  // Buyer approves USDC & buys
  await usdc.connect(buyer).approve(hoodgapAddr, premium);
  const tx = await hoodgap.connect(buyer).buyPolicy(coverage, threshold);
  const receipt = await tx.wait();

  // Extract policyId from event
  const purchaseEvent = receipt.logs.find(
    (log) => {
      try {
        return hoodgap.interface.parseLog(log)?.name === "PolicyPurchased";
      } catch { return false; }
    }
  );
  const policyId = purchaseEvent
    ? hoodgap.interface.parseLog(purchaseEvent).args.policyId
    : 0n;

  console.log(`  ✅ Policy #${policyId} purchased!`);

  // Show pool stats after purchase
  const stats2 = await hoodgap.getPoolStats();
  console.log(`\n  📊 Pool Stats After Purchase:`);
  console.log(`     Total Staked:    ${fmt(stats2[0])}`);
  console.log(`     Total Coverage:  ${fmt(stats2[1])}`);
  console.log(`     Utilization:     ${Number(stats2[2]) / 100}%`);
  console.log(`     Reserve:         ${fmt(stats2[3])}`);

  divider();

  // ── Step 5: Time-travel to Monday + simulate gap ─────────────────

  console.log("\n⏰ STEP 5: Time-traveling to Monday...\n");

  // Get the exact Monday 9:30am EST timestamp from the contract
  const mondayTimestamp = await hoodgap.getMonday(settlementWeek);
  const targetTime = Number(mondayTimestamp) + 60; // 1 minute after Monday open

  const currentBlock = await hre.ethers.provider.getBlock("latest");
  const jumpSeconds = targetTime - currentBlock.timestamp;

  if (jumpSeconds > 0) {
    await hre.network.provider.send("evm_increaseTime", [jumpSeconds]);
    await hre.network.provider.send("evm_mine");
  }

  const newBlock = await hre.ethers.provider.getBlock("latest");
  const newDate = new Date(newBlock.timestamp * 1000);
  console.log(`  ⏩ Jumped to: ${newDate.toUTCString()}`);

  // Simulate 8% gap down: $350 → $322
  const mondayPrice = fridayPrice * 0.92; // 8% gap down
  await oracle.update(toOracle(mondayPrice), newBlock.timestamp);
  console.log(`  📉 Oracle updated: $${fridayPrice.toFixed(2)} → $${mondayPrice.toFixed(2)} (-8% gap)`);

  // Update week timing
  await hoodgap.updateWeekTiming();
  console.log("  📅 Week timing refreshed");

  divider();

  // ── Step 6: Settle the policy ────────────────────────────────────

  console.log("\n⚖️  STEP 6: Settling policy...\n");

  const policy = await hoodgap.policies(policyId);
  const fridayPriceOracle = Number(policy.fridayClose) / 10 ** ORACLE_DECIMALS;
  const gap = Math.abs(mondayPrice - fridayPriceOracle) / fridayPriceOracle * 100;

  console.log(`  Friday close:  $${fridayPriceOracle.toFixed(2)}`);
  console.log(`  Monday open:   $${mondayPrice.toFixed(2)}`);
  console.log(`  Gap:           ${gap.toFixed(2)}%`);
  console.log(`  Threshold:     ${threshold / 100}%`);
  console.log(`  Triggers:      ${gap >= threshold / 100 ? "YES ✅" : "NO ❌"}`);

  const buyerBefore = await usdc.balanceOf(buyer.address);

  await hoodgap.connect(buyer).settlePolicy(policyId);

  const buyerAfter = await usdc.balanceOf(buyer.address);
  const payout = buyerAfter - buyerBefore;

  if (payout > 0n) {
    console.log(`\n  💸 PAYOUT: ${fmt(payout)} to Buyer!`);
  } else {
    console.log("\n  📭 No payout — gap below threshold");
  }

  // Show final pool stats
  const stats3 = await hoodgap.getPoolStats();
  console.log(`\n  📊 Pool Stats After Settlement:`);
  console.log(`     Total Staked:    ${fmt(stats3[0])}`);
  console.log(`     Total Coverage:  ${fmt(stats3[1])}`);
  console.log(`     Reserve:         ${fmt(stats3[3])}`);

  divider();

  // ── Step 7: Staker withdraws ─────────────────────────────────────

  console.log("\n🏦 STEP 7: Staker withdraws...\n");

  const stakerBalance = await hoodgap.stakerBalances(staker.address);
  const poolFree = stats3[0]; // totalStaked after settlement
  const withdrawable = stakerBalance < poolFree ? stakerBalance : poolFree;

  console.log(`  Staker mapped balance: ${fmt(stakerBalance)}`);
  console.log(`  Pool total staked:     ${fmt(poolFree)}`);
  console.log(`  Withdrawable:          ${fmt(withdrawable)}`);

  if (withdrawable > 0n) {
    const stakerUSDCBefore = await usdc.balanceOf(staker.address);
    await hoodgap.connect(staker).requestWithdrawal(withdrawable);
    const stakerUSDCAfter = await usdc.balanceOf(staker.address);
    const withdrawn = stakerUSDCAfter - stakerUSDCBefore;

    console.log(`  Withdrawn: ${fmt(withdrawn)}`);

    const profitLoss = fromUSDC(withdrawn) - fromUSDC(stakeAmount);
    const profitPct = (profitLoss / fromUSDC(stakeAmount)) * 100;
    const sign = profitLoss >= 0 ? "+" : "";
    console.log(`  P&L: ${sign}$${profitLoss.toFixed(2)} (${sign}${profitPct.toFixed(4)}%)`);
  } else {
    console.log("  ⚠️  No withdrawable liquidity (pool fully utilized)");
  }
  divider();

  // ── Summary ──────────────────────────────────────────────────────

  console.log("\n🏁 DEMO COMPLETE\n");
  console.log("  What happened:");
  console.log(`    1. Staker provided ${fmt(stakeAmount)} liquidity`);
  console.log(`    2. Buyer insured ${fmt(coverage)} at ${threshold / 100}% threshold`);
  console.log(`    3. TSLA gapped ${gap.toFixed(1)}% over the weekend`);
  console.log(`    4. Policy paid out ${fmt(payout)} to buyer`);
  console.log(`    5. Pool absorbs loss: ${fmt(stakeAmount)} → ${fmt(stats3[0])}`);
  console.log(`    6. Staker recovered ${fmt(withdrawable)} of original ${fmt(stakeAmount)}`);
  console.log("");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
