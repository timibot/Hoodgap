"use strict";

/**
 * test/helpers/setup.js
 *
 * Shared deploy helper and constants for all HoodGap tests.
 * CommonJS – works with Hardhat 2.22 out of the box.
 *
 * DYNAMIC TIMING:
 *   We pin the chain to a known safe time far in the future.
 *   After deploy we call updateWeekTiming() to initialise the contract's
 *   fridayCloseTime and mondayOpenTime.  We export these values (and the
 *   values computed by the contract) in the context object.
 */

const { ethers }             = require("hardhat");
const { time, loadFixture } = require("@nomicfoundation/hardhat-network-helpers");

// ─── Timing constants ─────────────────────────────────────────────────────────
const REFERENCE_WEEK   = 1_609_770_600n;  // Mon 4-Jan-2021 14:30 UTC
const WEEK_SECONDS     = 604_800n;
const WEEKEND_DURATION = 279_000n;        // Friday 4pm → Monday 9:30am (in seconds)
const FAILSAFE_DELAY   = 48n * 3_600n;   // 48 hours

// ─── USDC amounts (6 decimals) ────────────────────────────────────────────────
const USDC = (dollars) => BigInt(dollars) * 1_000_000n;

const STAKE_100K   = USDC(100_000);
const COVERAGE_10K = USDC(10_000);
const BUYER_WALLET = USDC(50_000);
const MAX_COVERAGE = USDC(50_000);

// ─── Oracle prices (Chainlink 8 decimals) ─────────────────────────────────────
const PRICE_250 = 250_00_000_000n;
const PRICE_240 = 240_00_000_000n;     // 4% gap from 250  (below 5% threshold)
const PRICE_237 = 237_00_000_000n;     // 5.2% gap from 250 (just above 5% threshold → small graduated payout)
const PRICE_230 = 230_00_000_000n;     // 8% gap from 250
const PRICE_252 = 252_00_000_000n;
const PRICE_225 = 225_00_000_000n;     // 10% gap from 250 (= 2× threshold → full payout)
const PRICE_200 = 200_00_000_000n;

// ─── Thresholds (basis points) ────────────────────────────────────────────────
const THRESHOLD_5  = 500n;
const THRESHOLD_10 = 1_000n;
const THRESHOLD_20 = 2_000n;

// ─── Solidity-matching helpers ────────────────────────────────────────────────
function getWeekNumber(ts) { return (ts - REFERENCE_WEEK) / WEEK_SECONDS; }
function getMonday(w)      { return REFERENCE_WEEK + w * WEEK_SECONDS; }
function getFriday(w)      { return getMonday(w) - WEEKEND_DURATION; }

// ─── Fixture ─────────────────────────────────────────────────────────────────
async function deployFixture() {
  const [owner, staker, buyer, alice] = await ethers.getSigners();

  // 1. Determine a safe future timestamp.
  //    We pick a time between the FRIDAY and MONDAY of a week far in the future.
  //    Specifically, we pick the SATURDAY (2h after Friday close) of (currentWeek + 4).
  //    This gives every computed timestamp plenty of room.
  const latestTs    = BigInt(await time.latest());
  const currentWeek = getWeekNumber(latestTs);
  const targetWeek  = currentWeek + 4n; // well ahead of current time

  // All times for the target week:
  const TARGET_MONDAY = getMonday(targetWeek);
  const TARGET_FRIDAY = getFriday(targetWeek);   // = TARGET_MONDAY - 279000
  const TARGET_SAT    = TARGET_FRIDAY + 7_200n;  // 2h after Friday close

  // Next week's Monday
  const TARGET_MONDAY_NEXT = getMonday(targetWeek + 1n);

  // Pin the chain to TARGET_SAT (which is between Friday and Monday of targetWeek)
  // On this Saturday: getWeekNumber() = targetWeek - 1
  // getCurrentSettlementWeek() → targetWeek (because block.timestamp >= getMonday(targetWeek-1))

  // 2. Deploy contracts
  const MockUSDC_f   = await ethers.getContractFactory("MockUSDC");
  const MockOracle_f = await ethers.getContractFactory("MockChainlinkOracle");
  const HoodGap_f    = await ethers.getContractFactory("HoodGap");

  const usdc = await MockUSDC_f.deploy();
  const oracle = await MockOracle_f.deploy(PRICE_250, TARGET_SAT);

  // 3. Pin chain time to TARGET_SAT
  await time.setNextBlockTimestamp(Number(TARGET_SAT));
  const hoodgap = await HoodGap_f.deploy(
    await usdc.getAddress(),
    await oracle.getAddress(),
  );

  // 4. Seed wallets & approvals
  await usdc.mint(staker.address, STAKE_100K);
  await usdc.mint(buyer.address,  BUYER_WALLET);
  await usdc.mint(alice.address,  BUYER_WALLET);
  const hgAddr = await hoodgap.getAddress();
  await usdc.connect(staker).approve(hgAddr, ethers.MaxUint256);
  await usdc.connect(buyer).approve(hgAddr,  ethers.MaxUint256);
  await usdc.connect(alice).approve(hgAddr,  ethers.MaxUint256);

  // 5. Refresh oracle at current time
  const blockTs = BigInt(await time.latest());
  await oracle.update(PRICE_250, blockTs);

  // 6. Call updateWeekTiming so the contract's friday/monday state vars are set.
  //    On Saturday of targetWeek:
  //       contract's currentWeek = targetWeek - 1
  //       fridayCloseTime = getFriday(targetWeek - 1)   [previous week's Friday]
  //       mondayOpenTime  = getMonday(targetWeek)       [this week's Monday = TARGET_MONDAY]
  await hoodgap.updateWeekTiming();

  const contractFriday = await hoodgap.fridayCloseTime();
  const contractMonday = await hoodgap.mondayOpenTime();

  return {
    hoodgap, usdc, oracle, owner, staker, buyer, alice,

    // The week that getCurrentSettlementWeek() returns on this Saturday
    SETTLEMENT_WEEK: targetWeek,

    // 📌 The FRIDAY and MONDAY as set by the contract via updateWeekTiming()
    // fridayCloseTime = previous week's Friday (in the past relative to SAT)
    CONTRACT_FRIDAY: contractFriday,
    // mondayOpenTime = this week's Monday (in the future relative to SAT)
    CONTRACT_MONDAY: contractMonday,

    // The raw target timestamps (for tests that need to advance to specific times)
    FRIDAY: TARGET_FRIDAY,     // Friday close of THIS weekend (just past)
    SATURDAY: TARGET_SAT,      // Saturday (our pin time)
    MONDAY: TARGET_MONDAY,     // Monday open of THIS week
    MONDAY_NEXT: TARGET_MONDAY_NEXT, // Monday open of NEXT week
    WEEK: targetWeek,          // Canonical week number
  };
}

// ─── deploy() ────────────────────────────────────────────────────────────────
async function deploy() {
  return loadFixture(deployFixture);
}

/**
 * Stake STAKE_100K, buy a policy, return the policy ID.
 */
async function stakeThenBuy(ctx, coverage = COVERAGE_10K, threshold = THRESHOLD_5) {
  await ctx.hoodgap.connect(ctx.staker).stake(STAKE_100K);
  const tx      = await ctx.hoodgap.connect(ctx.buyer).buyPolicy(coverage, threshold);
  const receipt = await tx.wait();
  const iface   = ctx.hoodgap.interface;
  const log     = receipt.logs
    .map((l) => { try { return iface.parseLog(l); } catch { return null; } })
    .find((e) => e && e.name === "PolicyPurchased");
  return log.args.policyId;
}

/**
 * Advance chain to Monday of the settlement week, update oracle.
 */
async function advanceToMonday(ctx, mondayPrice, mondayTs) {
  const ts = mondayTs || ctx.MONDAY;
  await time.setNextBlockTimestamp(Number(ts));
  await ctx.oracle.update(mondayPrice, ts);
}

module.exports = {
  REFERENCE_WEEK, WEEK_SECONDS, WEEKEND_DURATION, FAILSAFE_DELAY,
  USDC, STAKE_100K, COVERAGE_10K, BUYER_WALLET, MAX_COVERAGE,
  PRICE_250, PRICE_240, PRICE_237, PRICE_230, PRICE_252, PRICE_225, PRICE_200,
  THRESHOLD_5, THRESHOLD_10, THRESHOLD_20,
  deploy, stakeThenBuy, advanceToMonday,
  getWeekNumber, getMonday, getFriday,
};
