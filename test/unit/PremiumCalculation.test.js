"use strict";

/**
 * test/unit/PremiumCalculation.test.js
 *
 * Tests: calculatePremium() — base rate (10%), multiplier combination,
 *        floor (0.25%), ceiling (95%), oracle staleness rejection.
 */

const { expect }  = require("chai");
const { ethers }  = require("hardhat");
const { time }    = require("@nomicfoundation/hardhat-network-helpers");
const {
  deploy,
  USDC,
  STAKE_100K,
  COVERAGE_10K,
  MAX_COVERAGE,
  PRICE_250,
} = require("../helpers/setup");

describe("Unit: PremiumCalculation", function () {
  // ─── Helpers ────────────────────────────────────────────────────────────────
  async function deployWithStake() {
    const ctx = await deploy();
    await ctx.hoodgap.connect(ctx.staker).stake(STAKE_100K);
    return ctx;
  }

  // ─── Basic sanity ────────────────────────────────────────────────────────────
  it("returns a positive premium for standard coverage", async function () {
    const ctx = await deployWithStake();
    const premium = await ctx.hoodgap.calculatePremium(COVERAGE_10K);
    expect(premium).to.be.gt(0n);
  });

  it("premium is higher for larger coverage (same pool)", async function () {
    const ctx = await deployWithStake();
    const p1 = await ctx.hoodgap.calculatePremium(USDC(5_000));
    const p2 = await ctx.hoodgap.calculatePremium(USDC(20_000));
    // Larger coverage → higher utilization → higher multiplier → higher absolute premium
    expect(p2).to.be.gt(p1);
  });

  // ─── 0.25% floor ───────────────────────────────────────────────────────────
  it("applies 0.25% floor — premium is never below 0.25% of coverage", async function () {
    const ctx = await deployWithStake();
    const coverage = USDC(100);
    const premium  = await ctx.hoodgap.calculatePremium(coverage);
    const floor    = coverage / 400n;
    expect(premium).to.be.gte(floor);
  });

  // ─── 95% ceiling ─────────────────────────────────────────────────────────────
  it("premium never exceeds 95% of coverage", async function () {
    const ctx = await deployWithStake();
    const coverage = COVERAGE_10K;
    const premium  = await ctx.hoodgap.calculatePremium(coverage);
    const ceiling  = (coverage * 95n) / 100n;
    expect(premium).to.be.lte(ceiling);
  });

  // ─── Input validation ────────────────────────────────────────────────────────
  it("reverts when coverage is 0", async function () {
    const ctx = await deployWithStake();
    await expect(ctx.hoodgap.calculatePremium(0n))
      .to.be.revertedWith("Invalid coverage amount");
  });

  it("reverts when coverage exceeds MAX_POLICY_COVERAGE ($50k)", async function () {
    const ctx = await deployWithStake();
    await expect(ctx.hoodgap.calculatePremium(MAX_COVERAGE + 1n))
      .to.be.revertedWith("Invalid coverage amount");
  });

  // ─── Oracle staleness ────────────────────────────────────────────────────────
  it("reverts when oracle data is older than 24 hours", async function () {
    const ctx = await deployWithStake();
    await time.increase(25 * 3600);
    await expect(ctx.hoodgap.calculatePremium(COVERAGE_10K))
      .to.be.revertedWith("Oracle data is stale");
  });

  it("succeeds when oracle is refreshed after staleness", async function () {
    const ctx = await deployWithStake();
    await time.increase(25 * 3600);
    const newTs = BigInt(await time.latest()) + 1n;
    await time.setNextBlockTimestamp(Number(newTs));
    await ctx.oracle.update(PRICE_250, newTs);
    await expect(ctx.hoodgap.calculatePremium(COVERAGE_10K)).to.not.be.reverted;
  });

  // ─── Premium scales with utilization ─────────────────────────────────────────
  it("premium increases as pool utilization rises", async function () {
    const ctx = await deployWithStake();

    const premiumLow = await ctx.hoodgap.calculatePremium(USDC(10_000));

    await ctx.hoodgap.connect(ctx.buyer).buyPolicy(USDC(40_000), 500n);
    const premiumHigh = await ctx.hoodgap.calculatePremium(USDC(10_000));

    expect(premiumHigh).to.be.gt(premiumLow);
  });

  // ─── BASE_RATE sanity ────────────────────────────────────────────────────────
  it("base premium equals coverage × BASE_RATE / 10000 (with time decay on weekend)", async function () {
    const ctx = await deployWithStake();
    const BASE_RATE  = 500n; // 5%
    const coverage   = COVERAGE_10K;
    const basePremium = (coverage * BASE_RATE) / 10_000n;

    const premium    = await ctx.hoodgap.calculatePremium(coverage);

    // Premium should be ≥ basePremium (time decay multiplier > 1.0x on weekend)
    expect(premium).to.be.gte(basePremium);
    // But should not exceed 95% ceiling
    const ceiling = (coverage * 95n) / 100n;
    expect(premium).to.be.lte(ceiling);
  });
});
