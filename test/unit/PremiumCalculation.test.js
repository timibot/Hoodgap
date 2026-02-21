"use strict";

/**
 * test/unit/PremiumCalculation.test.js
 *
 * Tests: calculatePremium() — tier-based rates (10.8% / 0.6%),
 *        multiplier combination, floor (0.1%), ceiling (95%).
 */

const { expect }  = require("chai");
const { ethers }  = require("hardhat");
const { time }    = require("@nomicfoundation/hardhat-network-helpers");
const {
  deploy,
  USDC,
  STAKE_100K,
  COVERAGE_10K,
  COVERAGE_500,
  MAX_COVERAGE,
  PRICE_250,
  THRESHOLD_5,
  THRESHOLD_10,
} = require("../helpers/setup");

describe("Unit: PremiumCalculation", function () {
  async function deployWithStake() {
    const ctx = await deploy();
    await ctx.hoodgap.connect(ctx.staker).stake(STAKE_100K);
    return ctx;
  }

  // ─── Basic sanity ────────────────────────────────────────────────────────────
  it("returns a positive premium for standard coverage (-5% tier)", async function () {
    const ctx = await deployWithStake();
    const premium = await ctx.hoodgap["calculatePremium(uint256,uint256)"](COVERAGE_10K, THRESHOLD_5);
    expect(premium).to.be.gt(0n);
  });

  it("returns a positive premium for standard coverage (-10% tier)", async function () {
    const ctx = await deployWithStake();
    const premium = await ctx.hoodgap["calculatePremium(uint256,uint256)"](COVERAGE_10K, THRESHOLD_10);
    expect(premium).to.be.gt(0n);
  });

  it("-5% tier is much more expensive than -10% tier", async function () {
    const ctx = await deployWithStake();
    const p5 = await ctx.hoodgap["calculatePremium(uint256,uint256)"](COVERAGE_10K, THRESHOLD_5);
    const p10 = await ctx.hoodgap["calculatePremium(uint256,uint256)"](COVERAGE_10K, THRESHOLD_10);
    // -5% is 10.8% vs -10% is 0.6% → ~18x difference
    expect(p5).to.be.gt(p10 * 10n);
  });

  it("premium is higher for larger coverage (same pool)", async function () {
    const ctx = await deployWithStake();
    const p1 = await ctx.hoodgap["calculatePremium(uint256,uint256)"](USDC(5_000), THRESHOLD_5);
    const p2 = await ctx.hoodgap["calculatePremium(uint256,uint256)"](USDC(20_000), THRESHOLD_5);
    expect(p2).to.be.gt(p1);
  });

  // ─── Tier rate verification ─────────────────────────────────────────────────
  it("-5% tier base premium = coverage × 10.8%", async function () {
    const ctx = await deployWithStake();
    const coverage = COVERAGE_500;
    const TIER_5_RATE = 1080n;
    const basePremium = (coverage * TIER_5_RATE) / 10_000n; // $54 for $500

    const premium = await ctx.hoodgap["calculatePremium(uint256,uint256)"](coverage, THRESHOLD_5);

    // Should be ≥ base (utilization multiplier ≥ 1.0x)
    expect(premium).to.be.gte(basePremium);
    // But should not exceed 95% ceiling
    const ceiling = (coverage * 95n) / 100n;
    expect(premium).to.be.lte(ceiling);
  });

  it("-10% tier base premium = coverage × 0.6%", async function () {
    const ctx = await deployWithStake();
    const coverage = COVERAGE_500;
    const TIER_10_RATE = 60n;
    const basePremium = (coverage * TIER_10_RATE) / 10_000n; // $3 for $500

    const premium = await ctx.hoodgap["calculatePremium(uint256,uint256)"](coverage, THRESHOLD_10);

    expect(premium).to.be.gte(basePremium);
    const ceiling = (coverage * 95n) / 100n;
    expect(premium).to.be.lte(ceiling);
  });

  // ─── 0.1% floor ────────────────────────────────────────────────────────────
  it("applies 0.1% floor — premium is never below 0.1% of coverage", async function () {
    const ctx = await deployWithStake();
    const coverage = USDC(100);
    const premium = await ctx.hoodgap["calculatePremium(uint256,uint256)"](coverage, THRESHOLD_10);
    const floor = coverage / 1000n;
    expect(premium).to.be.gte(floor);
  });

  // ─── 95% ceiling ─────────────────────────────────────────────────────────────
  it("premium never exceeds 95% of coverage", async function () {
    const ctx = await deployWithStake();
    const coverage = COVERAGE_10K;
    const premium = await ctx.hoodgap["calculatePremium(uint256,uint256)"](coverage, THRESHOLD_5);
    const ceiling = (coverage * 95n) / 100n;
    expect(premium).to.be.lte(ceiling);
  });

  // ─── Input validation ────────────────────────────────────────────────────────
  it("reverts when coverage is 0", async function () {
    const ctx = await deployWithStake();
    await expect(ctx.hoodgap["calculatePremium(uint256,uint256)"](0n, THRESHOLD_5))
      .to.be.revertedWith("Invalid coverage amount");
  });

  it("reverts when coverage exceeds MAX_POLICY_COVERAGE ($50k)", async function () {
    const ctx = await deployWithStake();
    await expect(ctx.hoodgap["calculatePremium(uint256,uint256)"](MAX_COVERAGE + 1n, THRESHOLD_5))
      .to.be.revertedWith("Invalid coverage amount");
  });

  it("reverts for invalid threshold (not 500 or 1000)", async function () {
    const ctx = await deployWithStake();
    await expect(ctx.hoodgap["calculatePremium(uint256,uint256)"](COVERAGE_10K, 700n))
      .to.be.revertedWith("Invalid threshold tier");
  });

  // ─── Premium scales with utilization ─────────────────────────────────────────
  it("premium increases as pool utilization rises", async function () {
    const ctx = await deployWithStake();

    const premiumLow = await ctx.hoodgap["calculatePremium(uint256,uint256)"](USDC(10_000), THRESHOLD_5);

    await ctx.hoodgap.connect(ctx.buyer)["buyPolicy(uint256,uint256)"](USDC(40_000), THRESHOLD_5);
    const premiumHigh = await ctx.hoodgap["calculatePremium(uint256,uint256)"](USDC(10_000), THRESHOLD_5);

    expect(premiumHigh).to.be.gt(premiumLow);
  });

  // ─── Backward compat: 1-arg overload ─────────────────────────────────────────
  it("1-arg calculatePremium uses -5% tier", async function () {
    const ctx = await deployWithStake();
    const p1 = await ctx.hoodgap["calculatePremium(uint256)"](COVERAGE_10K);
    const p2 = await ctx.hoodgap["calculatePremium(uint256,uint256)"](COVERAGE_10K, THRESHOLD_5);
    expect(p1).to.equal(p2);
  });
});
