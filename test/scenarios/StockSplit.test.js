"use strict";

/**
 * test/scenarios/StockSplit.test.js
 *
 * Real-world scenario: TSLA announces a split after policies are sold.
 * Guardian sets split ratio before settlement.
 * Validates FIX #1: split-adjusted close price prevents false payouts.
 *
 * Updated for all-gap model: daily gap settlement.
 */

const { expect } = require("chai");
const { time }   = require("@nomicfoundation/hardhat-network-helpers");
const {
  deploy,
  stakeThenBuy,
  advanceToOpen,
  USDC,
  STAKE_100K,
  COVERAGE_10K,
  PRICE_250,
  PRICE_230,
  FAILSAFE_DELAY,
  THRESHOLD_5,
  THRESHOLD_10,
} = require("../helpers/setup");

describe("Scenario: StockSplit", function () {
  /**
   * Setup: policies bought at $250 close price.
   *        TSLA does a 2:1 split → next open should be ~$125.
   *        Guardian sets splitRatio = 5000 (halves close reference price).
   */

  // ─── 2:1 split — prevents false payout ───────────────────────────────────────
  it("2:1 split: open $125 is NOT a gap (adjustedClose $125 → 0% gap)", async function () {
    const ctx      = await deploy();
    const policyId = await stakeThenBuy(ctx, COVERAGE_10K, THRESHOLD_5);

    const settlementWeek = await ctx.hoodgap.getCurrentSettlementWeek();
    // gapDay=4 → approvalWeek = gapWeek + 1
    await ctx.hoodgap.connect(ctx.owner).approveSettlement(settlementWeek + 1n, 5_000n, "TSLA 2:1 split");

    // After split, opens at $125 (exactly half of $250)
    const openAfterSplit = 125_00_000_000n;
    await advanceToOpen(ctx, 4, openAfterSplit);
    await ctx.hoodgap.settlePolicy(policyId);

    const p = await ctx.hoodgap.policies(policyId);
    expect(p.settled).to.equal(true);
    expect(p.paidOut).to.equal(false); // no gap — correct!
  });

  it("2:1 split: adjustedClose emitted correctly in PolicySettled", async function () {
    const ctx      = await deploy();
    const policyId = await stakeThenBuy(ctx);
    const settlementWeek = await ctx.hoodgap.getCurrentSettlementWeek();
    await ctx.hoodgap.connect(ctx.owner).approveSettlement(settlementWeek + 1n, 5_000n, "TSLA 2:1 split");

    const openPrice      = 125_00_000_000n;
    const adjustedClose  = (PRICE_250 * 5_000n) / 10_000n; // $125
    await advanceToOpen(ctx, 4, openPrice);

    await expect(ctx.hoodgap.settlePolicy(policyId))
      .to.emit(ctx.hoodgap, "PolicySettled")
      .withArgs(policyId, openPrice, adjustedClose, 0n, false);
  });

  // ─── 2:1 split with actual gap ───────────────────────────────────────────────
  it("2:1 split: open $110 triggers payout (12% gap vs adjusted $125)", async function () {
    const ctx      = await deploy();
    const policyId = await stakeThenBuy(ctx, COVERAGE_10K, THRESHOLD_10); // 10% threshold

    const settlementWeek = await ctx.hoodgap.getCurrentSettlementWeek();
    await ctx.hoodgap.connect(ctx.owner).approveSettlement(settlementWeek + 1n, 5_000n, "TSLA 2:1 split");

    // $110 vs adjusted $125 → gap = (125-110)/125 × 10000 = 1200 bp → triggers 10% threshold
    const openPrice = 110_00_000_000n;
    await advanceToOpen(ctx, 4, openPrice);
    await ctx.hoodgap.settlePolicy(policyId);

    const p = await ctx.hoodgap.policies(policyId);
    expect(p.paidOut).to.equal(true);
  });

  // ─── 3:1 split ────────────────────────────────────────────────────────────────
  it("3:1 split (ratio 3333): adjustedClose ≈ $83.33, open $80 → small gap", async function () {
    const ctx      = await deploy();
    const policyId = await stakeThenBuy(ctx, COVERAGE_10K, THRESHOLD_5);

    const settlementWeek = await ctx.hoodgap.getCurrentSettlementWeek();
    await ctx.hoodgap.connect(ctx.owner).approveSettlement(settlementWeek + 1n, 3_333n, "TSLA 3:1 split");

    // adjustedClose = $250 × 3333 / 10000 = $83.325
    // open $80 → gap = (83.325 - 80) / 83.325 × 10000 ≈ 399 bp < 500 bp (5% threshold)
    const openPrice = 80_00_000_000n;
    await advanceToOpen(ctx, 4, openPrice);
    await ctx.hoodgap.settlePolicy(policyId);

    const p = await ctx.hoodgap.policies(policyId);
    expect(p.settled).to.equal(true);
  });

  // ─── Guardian forgets to set split — failsafe default ────────────────────────
  it("guardian forgets split ratio — failsafe uses 1.0x (may cause false payout)", async function () {
    const ctx = await deploy();
    // Advance to next week so approvalWeek = WEEK+2 (unapproved)
    const nextWeekClose = ctx.getCloseWeek(ctx.WEEK + 1n, 0);
    await time.setNextBlockTimestamp(Number(nextWeekClose) + 60);
    await ctx.oracle.update(PRICE_250, nextWeekClose + 60n);
    await ctx.hoodgap.connect(ctx.staker).stake(STAKE_100K);
    const tx = await ctx.hoodgap.connect(ctx.buyer).buyPolicy(COVERAGE_10K, THRESHOLD_5);
    const receipt = await tx.wait();
    const log = receipt.logs
      .map((l) => { try { return ctx.hoodgap.interface.parseLog(l); } catch { return null; } })
      .find((e) => e && e.name === "PolicyPurchased");
    const policyId = log.args.policyId;

    // Do NOT call approveSettlement for WEEK+2
    const openTs = ctx.getOpenWeek(ctx.WEEK + 1n, 4);
    const failsafe = openTs + FAILSAFE_DELAY + 1n;
    await time.setNextBlockTimestamp(Number(failsafe));
    const openAfterSplit = 125_00_000_000n;
    await ctx.oracle.update(openAfterSplit, failsafe);

    // Settlement proceeds via failsafe with 1.0x — $125 vs $250 = 50% gap → PAYOUT
    await ctx.hoodgap.settlePolicy(policyId);
    const p = await ctx.hoodgap.policies(policyId);
    expect(p.paidOut).to.equal(true); // false payout — guardian should have acted
  });

  // ─── approveSettlement event ─────────────────────────────────────────────────
  it("approveSettlement emits SettlementApproved with split ratio and reason", async function () {
    const ctx = await deploy();
    const settlementWeek = await ctx.hoodgap.getCurrentSettlementWeek();
    await expect(
      ctx.hoodgap.connect(ctx.owner).approveSettlement(settlementWeek, 5_000n, "TSLA 2:1 split"),
    )
      .to.emit(ctx.hoodgap, "SettlementApproved")
      .withArgs(settlementWeek, 5_000n, "TSLA 2:1 split", (v) => typeof v === "bigint");
  });

  // ─── No-split baseline (ratio 10000) ─────────────────────────────────────────
  it("no split (ratio 10000): settlement behaves normally", async function () {
    const ctx      = await deploy();
    const policyId = await stakeThenBuy(ctx, COVERAGE_10K, THRESHOLD_5);
    const settlementWeek = await ctx.hoodgap.getCurrentSettlementWeek();
    await ctx.hoodgap.connect(ctx.owner).approveSettlement(settlementWeek + 1n, 10_000n, "no corporate action");
    await advanceToOpen(ctx, 4, PRICE_230); // 8% gap
    await ctx.hoodgap.settlePolicy(policyId);
    const p = await ctx.hoodgap.policies(policyId);
    expect(p.paidOut).to.equal(true);
  });
});
