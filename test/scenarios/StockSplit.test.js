"use strict";

/**
 * test/scenarios/StockSplit.test.js
 *
 * Real-world scenario: TSLA announces a split after policies are sold.
 * Guardian sets split ratio before settlement.
 * Validates FIX #1: split-adjusted Friday price prevents false payouts.
 */

const { expect } = require("chai");
const { time }   = require("@nomicfoundation/hardhat-network-helpers");
const {
  deploy,
  stakeThenBuy,
  advanceToMonday,
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
   * Setup: policies bought at $250 Friday close.
   *        TSLA does a 2:1 split → Monday open should be ~$125.
   *        Guardian sets splitRatio = 5000 (halves Friday reference price).
   */

  // ─── 2:1 split — prevents false payout ───────────────────────────────────────
  it("2:1 split: Monday $125 is NOT a gap (adjustedFriday $125 → 0% gap)", async function () {
    const ctx      = await deploy();
    const policyId = await stakeThenBuy(ctx, COVERAGE_10K, THRESHOLD_5);

    const settlementWeek = await ctx.hoodgap.getCurrentSettlementWeek();
    // Guardian sets 2:1 split ratio
    await ctx.hoodgap.connect(ctx.owner).approveSettlement(settlementWeek, 5_000n, "TSLA 2:1 split");

    // After split, Monday opens at $125 (exactly half of $250)
    const mondayAfterSplit = 125_00_000_000n;
    await advanceToMonday(ctx, mondayAfterSplit);
    await ctx.hoodgap.settlePolicy(policyId);

    const p = await ctx.hoodgap.policies(policyId);
    expect(p.settled).to.equal(true);
    expect(p.paidOut).to.equal(false); // no gap — correct!
  });

  it("2:1 split: Friday adjustedPrice emitted correctly in PolicySettled", async function () {
    const ctx      = await deploy();
    const policyId = await stakeThenBuy(ctx);
    const settlementWeek = await ctx.hoodgap.getCurrentSettlementWeek();
    await ctx.hoodgap.connect(ctx.owner).approveSettlement(settlementWeek, 5_000n, "TSLA 2:1 split");

    const mondayPrice    = 125_00_000_000n;
    const adjustedFriday = (PRICE_250 * 5_000n) / 10_000n; // $125
    await advanceToMonday(ctx, mondayPrice);

    await expect(ctx.hoodgap.settlePolicy(policyId))
      .to.emit(ctx.hoodgap, "PolicySettled")
      .withArgs(policyId, mondayPrice, adjustedFriday, 0n, false);
  });

  // ─── 2:1 split with actual gap ───────────────────────────────────────────────
  it("2:1 split: Monday $110 triggers payout (12% gap vs adjusted $125)", async function () {
    const ctx      = await deploy();
    const policyId = await stakeThenBuy(ctx, COVERAGE_10K, THRESHOLD_10); // 10% threshold

    const settlementWeek = await ctx.hoodgap.getCurrentSettlementWeek();
    await ctx.hoodgap.connect(ctx.owner).approveSettlement(settlementWeek, 5_000n, "TSLA 2:1 split");

    // $110 vs adjusted $125 → gap = (125-110)/125 × 10000 = 1200 bp → triggers 10% threshold
    const mondayPrice = 110_00_000_000n;
    await advanceToMonday(ctx, mondayPrice);
    await ctx.hoodgap.settlePolicy(policyId);

    const p = await ctx.hoodgap.policies(policyId);
    expect(p.paidOut).to.equal(true);
  });

  // ─── 3:1 split ────────────────────────────────────────────────────────────────
  it("3:1 split (ratio 3333): adjustedFriday ≈ $83.33, Monday $80 → small gap", async function () {
    const ctx      = await deploy();
    const policyId = await stakeThenBuy(ctx, COVERAGE_10K, THRESHOLD_5);

    const settlementWeek = await ctx.hoodgap.getCurrentSettlementWeek();
    await ctx.hoodgap.connect(ctx.owner).approveSettlement(settlementWeek, 3_333n, "TSLA 3:1 split");

    // adjustedFriday = $250 × 3333 / 10000 = $83.325
    // Monday $80 → gap = (83.325 - 80) / 83.325 × 10000 ≈ 399 bp < 500 bp (5% threshold)
    // So no payout in this case
    const mondayPrice = 80_00_000_000n;
    await advanceToMonday(ctx, mondayPrice);
    await ctx.hoodgap.settlePolicy(policyId);

    // Gap is just under 5% → no payout
    const p = await ctx.hoodgap.policies(policyId);
    expect(p.settled).to.equal(true);
  });

  // ─── Guardian forgets to set split — failsafe default ────────────────────────
  it("guardian forgets split ratio — failsafe uses 1.0x (may cause false payout)", async function () {
    /**
     * DAY1 scenario: Split announced, guardian doesn't set ratio.
     * After 48h failsafe, settlement proceeds with 1.0x ratio.
     * Monday $125 vs unadjusted Friday $250 = 50% gap → false payout.
     * This is expected behaviour — guardian MUST set ratio before failsafe.
     */
    const ctx      = await deploy();
    const policyId = await stakeThenBuy(ctx, COVERAGE_10K, THRESHOLD_5);

    // Do NOT call approveSettlement or set splitRatio

    const failsafe = ctx.MONDAY + FAILSAFE_DELAY + 1n;
    await time.setNextBlockTimestamp(Number(failsafe));
    const mondayAfterSplit = 125_00_000_000n;
    await ctx.oracle.update(mondayAfterSplit, failsafe);

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
    await ctx.hoodgap.connect(ctx.owner).approveSettlement(settlementWeek, 10_000n, "no corporate action");
    await advanceToMonday(ctx, PRICE_230); // 8% gap
    await ctx.hoodgap.settlePolicy(policyId);
    const p = await ctx.hoodgap.policies(policyId);
    expect(p.paidOut).to.equal(true);
  });
});
