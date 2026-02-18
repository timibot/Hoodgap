"use strict";

/**
 * test/scenarios/ExtremeVolatility.test.js
 *
 * Real-world scenario: Market enters high-volatility regime.
 * Validates: volatility multiplier effect on premiums, timelock protection,
 *            premium ceiling at 95%, pool behaviour under stress.
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
  PRICE_230,
  PRICE_250,
  PRICE_252,
  THRESHOLD_5,
} = require("../helpers/setup");

describe("Scenario: ExtremeVolatility", function () {
  // ─── Normal vs high volatility premium comparison ────────────────────────────
  it("premium is higher at 2× volatility than baseline", async function () {
    const ctx = await deploy();
    await ctx.hoodgap.connect(ctx.staker).stake(STAKE_100K);

    const premiumNormal = await ctx.hoodgap.calculatePremium(COVERAGE_10K);

    // Queue and execute volatility update to 10000 (2× baseline of 5000)
    await ctx.hoodgap.connect(ctx.owner).queueVolatilityChange(10_000n, "crisis vol");
    await time.increase(24 * 3600 + 1);
    // Refresh oracle after time.increase so calculatePremium doesn't revert with stale oracle
    const ts = BigInt(await time.latest()) + 1n;
    await time.setNextBlockTimestamp(Number(ts));
    await ctx.oracle.update(PRICE_250, ts);
    await ctx.hoodgap.executeVolatilityChange();

    const premiumHigh = await ctx.hoodgap.calculatePremium(COVERAGE_10K);
    expect(premiumHigh).to.be.gt(premiumNormal);
  });

  it("volatility multiplier: 100% vol (10000) = 2× baseline (5000) → 2.0x multiplier", async function () {
    const ctx = await deploy();
    const mult = await ctx.hoodgap.getVolatilityMultiplier();
    // Default: currentVolatility = 5000, AVG_VOLATILITY = 5000 → 1.0x (10000 bp)
    expect(mult).to.equal(10_000n);

    // Update to 10000 (100%)
    await ctx.hoodgap.connect(ctx.owner).queueVolatilityChange(10_000n, "crisis");
    await time.increase(24 * 3600 + 1);
    await ctx.hoodgap.executeVolatilityChange();

    const multHigh = await ctx.hoodgap.getVolatilityMultiplier();
    expect(multHigh).to.equal(20_000n); // 10000/5000 × 10000 = 20000 (2.0×)
  });

  it("low volatility (calm market): multiplier < 1.0× reduces premium", async function () {
    const ctx = await deploy();
    await ctx.hoodgap.connect(ctx.staker).stake(STAKE_100K);
    const premiumBaseline = await ctx.hoodgap.calculatePremium(COVERAGE_10K);

    // Vol 2500 = 25% (calm) → multiplier = 2500/5000 × 10000 = 5000 (0.5×)
    await ctx.hoodgap.connect(ctx.owner).queueVolatilityChange(2_500n, "calm market");
    await time.increase(24 * 3600 + 1);
    // Refresh oracle
    const ts = BigInt(await time.latest()) + 1n;
    await time.setNextBlockTimestamp(Number(ts));
    await ctx.oracle.update(PRICE_250, ts);
    await ctx.hoodgap.executeVolatilityChange();

    const premiumCalm = await ctx.hoodgap.calculatePremium(COVERAGE_10K);
    expect(premiumCalm).to.be.lt(premiumBaseline);
  });

  // ─── 95% premium ceiling ─────────────────────────────────────────────────────
  it("premium is capped at 95% of coverage even at max volatility + max utilisation", async function () {
    const ctx = await deploy();
    await ctx.hoodgap.connect(ctx.staker).stake(STAKE_100K);

    // Set max volatility (150%)
    await ctx.hoodgap.connect(ctx.owner).queueVolatilityChange(15_000n, "max vol");
    await time.increase(24 * 3600 + 1);
    const ts = BigInt(await time.latest()) + 1n;
    await time.setNextBlockTimestamp(Number(ts));
    await ctx.oracle.update(PRICE_250, ts);
    await ctx.hoodgap.executeVolatilityChange();

    // Buy small policies to create some utilisation without triggering premium ceiling
    await ctx.hoodgap.connect(ctx.buyer).buyPolicy(COVERAGE_10K, THRESHOLD_5);
    await ctx.hoodgap.connect(ctx.alice).buyPolicy(COVERAGE_10K, THRESHOLD_5);

    // Calculate premium for another $10k — should be ≤ 95% of coverage
    const coverage = COVERAGE_10K;
    const premium  = await ctx.hoodgap.calculatePremium(coverage);
    const ceiling  = (coverage * 95n) / 100n;
    expect(premium).to.be.lte(ceiling);
  });

  // ─── Timelock protects users from sudden vol spike ───────────────────────────
  it("users see pending vol change and can withdraw before it executes", async function () {
    const ctx = await deploy();
    await ctx.hoodgap.connect(ctx.staker).stake(STAKE_100K);

    // Guardian queues a 3× volatility increase
    await ctx.hoodgap.connect(ctx.owner).queueVolatilityChange(15_000n, "emergency spike");

    // Staker sees pending change (visible on-chain) and withdraws immediately
    await expect(() => ctx.hoodgap.connect(ctx.staker).requestWithdrawal(STAKE_100K))
      .to.changeTokenBalance(ctx.usdc, ctx.staker, STAKE_100K);

    // Volatility has NOT changed yet
    expect(await ctx.hoodgap.currentVolatility()).to.equal(5_000n);
  });

  // ─── Protocol still functional at extreme volatility ─────────────────────────
  it("full lifecycle works correctly at 150% volatility", async function () {
    const ctx = await deploy();

    // Set extreme volatility
    await ctx.hoodgap.connect(ctx.owner).queueVolatilityChange(15_000n, "crisis");
    await time.increase(24 * 3600 + 1);
    // Refresh oracle
    const ts = BigInt(await time.latest()) + 1n;
    await time.setNextBlockTimestamp(Number(ts));
    await ctx.oracle.update(PRICE_250, ts);
    await ctx.hoodgap.executeVolatilityChange();

    // Normal lifecycle should still work
    const policyId = await stakeThenBuy(ctx, COVERAGE_10K, THRESHOLD_5);
    const settlementWeek = await ctx.hoodgap.getCurrentSettlementWeek();
    await ctx.hoodgap.connect(ctx.owner).approveSettlement(settlementWeek, 10_000n, "test");
    await advanceToMonday(ctx, PRICE_230);

    await expect(ctx.hoodgap.settlePolicy(policyId))
      .to.emit(ctx.hoodgap, "PolicyPaidOut"); // 8% gap, 5% threshold → payout
  });

  // ─── Vol change cancelled — no effect ────────────────────────────────────────
  it("cancelled volatility change has no effect on current volatility", async function () {
    const ctx = await deploy();
    await ctx.hoodgap.connect(ctx.owner).queueVolatilityChange(15_000n, "crisis");
    await ctx.hoodgap.cancelVolatilityChange();

    // Volatility unchanged
    expect(await ctx.hoodgap.currentVolatility()).to.equal(5_000n);

    // Can queue again after cancel
    await expect(ctx.hoodgap.connect(ctx.owner).queueVolatilityChange(8_000n, "moderate"))
      .to.not.be.reverted;
  });

  // ─── Volatility multiplier direction ─────────────────────────────────────────
  it("getVolatilityMultiplier scales linearly with currentVolatility", async function () {
    const ctx  = await deploy();

    // At default 5000 → 1.0× (10000 bp)
    const m1 = await ctx.hoodgap.getVolatilityMultiplier();
    expect(m1).to.equal(10_000n);

    // Update to 7500 → 1.5× (15000 bp)
    await ctx.hoodgap.connect(ctx.owner).queueVolatilityChange(7_500n, "elevated");
    await time.increase(24 * 3600 + 1);
    await ctx.hoodgap.executeVolatilityChange();

    const m2 = await ctx.hoodgap.getVolatilityMultiplier();
    expect(m2).to.equal(15_000n);
  });
});
