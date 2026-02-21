"use strict";

/**
 * test/scenarios/ExtremeVolatility.test.js
 *
 * Real-world scenario: Market enters high-volatility regime.
 * Validates: volatility multiplier effect on premiums, timelock protection,
 *            premium ceiling at 95%, pool behaviour under stress.
 *
 * Updated for all-gap model.
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

    const premiumNormal = await ctx.hoodgap["calculatePremium(uint256,uint256)"](COVERAGE_10K, THRESHOLD_5);

    await ctx.hoodgap.connect(ctx.owner).queueVolatilityChange(10_000n, "crisis vol");
    await time.increase(24 * 3600 + 1);
    const ts = BigInt(await time.latest()) + 1n;
    await time.setNextBlockTimestamp(Number(ts));
    await ctx.oracle.update(PRICE_250, ts);
    await ctx.hoodgap.executeVolatilityChange();

    const premiumHigh = await ctx.hoodgap["calculatePremium(uint256,uint256)"](COVERAGE_10K, THRESHOLD_5);
    expect(premiumHigh).to.be.gt(premiumNormal);
  });

  it("volatility multiplier: 100% vol (10000) = 2× baseline (5000) → 2.0x multiplier", async function () {
    const ctx = await deploy();
    const mult = await ctx.hoodgap.getVolatilityMultiplier();
    expect(mult).to.equal(10_000n);

    await ctx.hoodgap.connect(ctx.owner).queueVolatilityChange(10_000n, "crisis");
    await time.increase(24 * 3600 + 1);
    await ctx.hoodgap.executeVolatilityChange();

    const multHigh = await ctx.hoodgap.getVolatilityMultiplier();
    expect(multHigh).to.equal(20_000n);
  });

  it("low volatility (calm market): multiplier < 1.0× reduces premium", async function () {
    const ctx = await deploy();
    await ctx.hoodgap.connect(ctx.staker).stake(STAKE_100K);
    const premiumBaseline = await ctx.hoodgap["calculatePremium(uint256,uint256)"](COVERAGE_10K, THRESHOLD_5);

    await ctx.hoodgap.connect(ctx.owner).queueVolatilityChange(2_500n, "calm market");
    await time.increase(24 * 3600 + 1);
    const ts = BigInt(await time.latest()) + 1n;
    await time.setNextBlockTimestamp(Number(ts));
    await ctx.oracle.update(PRICE_250, ts);
    await ctx.hoodgap.executeVolatilityChange();

    const premiumCalm = await ctx.hoodgap["calculatePremium(uint256,uint256)"](COVERAGE_10K, THRESHOLD_5);
    expect(premiumCalm).to.be.lt(premiumBaseline);
  });

  // ─── 95% premium ceiling ─────────────────────────────────────────────────────
  it("premium is capped at 95% of coverage even at max volatility + max utilisation", async function () {
    const ctx = await deploy();
    await ctx.hoodgap.connect(ctx.staker).stake(STAKE_100K);

    await ctx.hoodgap.connect(ctx.owner).queueVolatilityChange(15_000n, "max vol");
    await time.increase(24 * 3600 + 1);
    const ts = BigInt(await time.latest()) + 1n;
    await time.setNextBlockTimestamp(Number(ts));
    await ctx.oracle.update(PRICE_250, ts);
    await ctx.hoodgap.executeVolatilityChange();

    await ctx.hoodgap.connect(ctx.buyer).buyPolicy(COVERAGE_10K, THRESHOLD_5);
    await ctx.hoodgap.connect(ctx.alice).buyPolicy(COVERAGE_10K, THRESHOLD_5);

    const coverage = COVERAGE_10K;
    const premium  = await ctx.hoodgap["calculatePremium(uint256,uint256)"](coverage, THRESHOLD_5);
    const ceiling  = (coverage * 95n) / 100n;
    expect(premium).to.be.lte(ceiling);
  });

  // ─── Timelock protects users from sudden vol spike ───────────────────────────
  it("users see pending vol change and can withdraw before it executes", async function () {
    const ctx = await deploy();
    await ctx.hoodgap.connect(ctx.staker).stake(STAKE_100K);

    await ctx.hoodgap.connect(ctx.owner).queueVolatilityChange(15_000n, "emergency spike");

    await expect(() => ctx.hoodgap.connect(ctx.staker).requestWithdrawal(STAKE_100K))
      .to.changeTokenBalance(ctx.usdc, ctx.staker, STAKE_100K);

    expect(await ctx.hoodgap.currentVolatility()).to.equal(5_000n);
  });

  // ─── Protocol still functional at extreme volatility ─────────────────────────
  it("full lifecycle works correctly at 150% volatility", async function () {
    const ctx = await deploy();

    await ctx.hoodgap.connect(ctx.owner).queueVolatilityChange(15_000n, "crisis");
    await time.increase(24 * 3600 + 1);
    const ts = BigInt(await time.latest()) + 1n;
    await time.setNextBlockTimestamp(Number(ts));
    await ctx.oracle.update(PRICE_250, ts);
    await ctx.hoodgap.executeVolatilityChange();

    const policyId = await stakeThenBuy(ctx, COVERAGE_10K, THRESHOLD_5);
    await advanceToOpen(ctx, 4, PRICE_230);

    await expect(ctx.hoodgap.settlePolicy(policyId))
      .to.emit(ctx.hoodgap, "PolicyPaidOut");
  });

  // ─── Vol change cancelled — no effect ────────────────────────────────────────
  it("cancelled volatility change has no effect on current volatility", async function () {
    const ctx = await deploy();
    await ctx.hoodgap.connect(ctx.owner).queueVolatilityChange(15_000n, "crisis");
    await ctx.hoodgap.cancelVolatilityChange();

    expect(await ctx.hoodgap.currentVolatility()).to.equal(5_000n);

    await expect(ctx.hoodgap.connect(ctx.owner).queueVolatilityChange(8_000n, "moderate"))
      .to.not.be.reverted;
  });

  // ─── Volatility multiplier direction ─────────────────────────────────────────
  it("getVolatilityMultiplier scales linearly with currentVolatility", async function () {
    const ctx  = await deploy();

    const m1 = await ctx.hoodgap.getVolatilityMultiplier();
    expect(m1).to.equal(10_000n);

    await ctx.hoodgap.connect(ctx.owner).queueVolatilityChange(7_500n, "elevated");
    await time.increase(24 * 3600 + 1);
    await ctx.hoodgap.executeVolatilityChange();

    const m2 = await ctx.hoodgap.getVolatilityMultiplier();
    expect(m2).to.equal(15_000n);
  });
});
