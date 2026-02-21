"use strict";

/**
 * test/helpers/setup.js
 *
 * Shared deploy helper and constants for all HoodGap tests.
 * CommonJS – works with Hardhat 2.22 out of the box.
 *
 * ALL-GAP MODEL:
 *   Covers 5 overnight gaps per week (Mon–Fri close → next open).
 *   Each gap gets its own NFT. Subscriptions = numWeeks × 5 NFTs.
 */

const { ethers }             = require("hardhat");
const { time, loadFixture } = require("@nomicfoundation/hardhat-network-helpers");

// ─── Timing constants (must match HoodGapMath.sol) ────────────────────────────
const REFERENCE_WEEK   = 1_609_940_200n;  // Wed 6-Jan-2021 14:30 UTC (Mon 9:30am EST)
const WEEK_SECONDS     = 604_800n;
const DAY_SECONDS      = 86_400n;
const FAILSAFE_DELAY   = 48n * 3_600n;   // 48 hours

// Market timing offsets (UTC)
const MARKET_CLOSE_OFFSET = 75_600n;  // 21:00 UTC = 4pm EST
const MARKET_OPEN_OFFSET  = 52_200n;  // 14:30 UTC = 9:30am EST

// ─── USDC amounts (6 decimals) ────────────────────────────────────────────────
const USDC = (dollars) => BigInt(dollars) * 1_000_000n;

const STAKE_100K   = USDC(100_000);
const COVERAGE_500 = USDC(500);
const COVERAGE_10K = USDC(10_000);
const BUYER_WALLET = USDC(50_000);
const MAX_COVERAGE = USDC(50_000);

// ─── Oracle prices (Chainlink 8 decimals) ─────────────────────────────────────
const PRICE_250 = 250_00_000_000n;
const PRICE_240 = 240_00_000_000n;     // 4% gap from 250  (below 5% threshold)
const PRICE_237 = 237_00_000_000n;     // 5.2% gap from 250 (above 5% threshold → payout)
const PRICE_230 = 230_00_000_000n;     // 8% gap from 250
const PRICE_252 = 252_00_000_000n;
const PRICE_225 = 225_00_000_000n;     // 10% gap from 250
const PRICE_200 = 200_00_000_000n;

// ─── Thresholds (basis points) ────────────────────────────────────────────────
const THRESHOLD_5  = 500n;
const THRESHOLD_10 = 1_000n;

// ─── Solidity-matching helpers ────────────────────────────────────────────────
function getWeekNumber(ts) { return (ts - REFERENCE_WEEK) / WEEK_SECONDS; }
function getMonday(w)      { return REFERENCE_WEEK + w * WEEK_SECONDS; }
function getFriday(w) {
  return REFERENCE_WEEK + w * WEEK_SECONDS + 4n * DAY_SECONDS + MARKET_CLOSE_OFFSET - MARKET_OPEN_OFFSET;
}
function getMarketClose(w, day) {
  const mondayMidnight = REFERENCE_WEEK + w * WEEK_SECONDS - MARKET_OPEN_OFFSET;
  return mondayMidnight + day * DAY_SECONDS + MARKET_CLOSE_OFFSET;
}
function getNextMarketOpen(w, day) {
  if (day < 4n) {
    const mondayMidnight = REFERENCE_WEEK + w * WEEK_SECONDS - MARKET_OPEN_OFFSET;
    return mondayMidnight + (day + 1n) * DAY_SECONDS + MARKET_OPEN_OFFSET;
  }
  return getMonday(w + 1n); // Friday → next Monday
}

// ─── Fixture ─────────────────────────────────────────────────────────────────
async function deployFixture() {
  const [owner, staker, buyer, alice] = await ethers.getSigners();

  // Pick a time well into the future — a Monday close (day=0)
  const latestTs    = BigInt(await time.latest());
  const currentWeek = getWeekNumber(latestTs);
  const targetWeek  = currentWeek + 4n;

  // Pin to Tuesday 10:00am EST of target week (between Mon close and Tue open)
  // That way we can test minting the Monday gap NFT immediately.
  const MONDAY_CLOSE = getMarketClose(targetWeek, 0n);
  const PIN_TIME = MONDAY_CLOSE + 3_600n; // 1 hour after Monday close

  // Deploy contracts
  const MockUSDC_f   = await ethers.getContractFactory("MockUSDC");
  const MockOracle_f = await ethers.getContractFactory("MockChainlinkOracle");
  const HoodGap_f    = await ethers.getContractFactory("HoodGap");

  const usdc = await MockUSDC_f.deploy();
  const oracle = await MockOracle_f.deploy(PRICE_250, PIN_TIME);

  // Pin chain time
  await time.setNextBlockTimestamp(Number(PIN_TIME));
  const hoodgap = await HoodGap_f.deploy(
    await usdc.getAddress(),
    await oracle.getAddress(),
  );

  // Seed wallets & approvals
  await usdc.mint(staker.address, STAKE_100K);
  await usdc.mint(buyer.address,  BUYER_WALLET);
  await usdc.mint(alice.address,  BUYER_WALLET);
  const hgAddr = await hoodgap.getAddress();
  await usdc.connect(staker).approve(hgAddr, ethers.MaxUint256);
  await usdc.connect(buyer).approve(hgAddr,  ethers.MaxUint256);
  await usdc.connect(alice).approve(hgAddr,  ethers.MaxUint256);

  // Refresh oracle
  const blockTs = BigInt(await time.latest());
  await oracle.update(PRICE_250, blockTs);

  // Approve settlement for current and next week
  await hoodgap.approveSettlement(targetWeek, 10000, "test setup");
  await hoodgap.approveSettlement(targetWeek + 1n, 10000, "test setup");

  return {
    hoodgap, usdc, oracle, owner, staker, buyer, alice,
    WEEK: targetWeek,
    MONDAY_CLOSE,
    PIN_TIME,
    // Helper timestamps for each day's close and open
    getClose: (day) => getMarketClose(targetWeek, BigInt(day)),
    getOpen: (day) => getNextMarketOpen(targetWeek, BigInt(day)),
    getCloseWeek: (w, day) => getMarketClose(w, BigInt(day)),
    getOpenWeek: (w, day) => getNextMarketOpen(w, BigInt(day)),
  };
}

// ─── deploy() ────────────────────────────────────────────────────────────────
async function deploy() {
  return loadFixture(deployFixture);
}

/**
 * Stake STAKE_100K, buy a weekly subscription (5 gap NFTs), return the sub ID.
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
 * Advance chain to the next market open for a given gap day, update oracle.
 */
async function advanceToOpen(ctx, day, openPrice, week) {
  const w = week || ctx.WEEK;
  const openTs = getNextMarketOpen(w, BigInt(day));
  await time.setNextBlockTimestamp(Number(openTs));
  await ctx.oracle.update(openPrice, openTs);
}

module.exports = {
  REFERENCE_WEEK, WEEK_SECONDS, DAY_SECONDS, FAILSAFE_DELAY,
  MARKET_CLOSE_OFFSET, MARKET_OPEN_OFFSET,
  USDC, STAKE_100K, COVERAGE_500, COVERAGE_10K, BUYER_WALLET, MAX_COVERAGE,
  PRICE_250, PRICE_240, PRICE_237, PRICE_230, PRICE_252, PRICE_225, PRICE_200,
  THRESHOLD_5, THRESHOLD_10,
  deploy, stakeThenBuy, advanceToOpen,
  getWeekNumber, getMonday, getFriday, getMarketClose, getNextMarketOpen,
};
