"use strict";

/**
 * test/unit/UtilizationMultiplier.test.js
 *
 * Tests: getUtilizationMultiplier() — 0%, 25%, 50%, 70%, 95%+ utilisation,
 *        getCurrentUtilization(), getPoolStats() utilization field.
 */

const { expect } = require("chai");
const {
  deploy,
  USDC,
  STAKE_100K,
  COVERAGE_10K,
  THRESHOLD_5,
} = require("../helpers/setup");

describe("Unit: UtilizationMultiplier", function () {
  // ─── getUtilizationMultiplier via view ────────────────────────────────────────
  it("returns 10000 (1.0x) when pool is empty", async function () {
    const ctx = await deploy();
    // No stakers → totalStaked = 0
    const mult = await ctx.hoodgap.getUtilizationMultiplier(COVERAGE_10K);
    expect(mult).to.equal(10_000n);
  });

  it("returns close to 10000 (1.0x) at near-zero utilisation", async function () {
    const ctx = await deploy();
    await ctx.hoodgap.connect(ctx.staker).stake(STAKE_100K);
    // $100 coverage on $100k pool = 0.1% util → multiplier ≈ 1.000001
    const mult = await ctx.hoodgap.getUtilizationMultiplier(USDC(100));
    expect(mult).to.be.gte(10_000n);
    expect(mult).to.be.lt(10_010n);
  });

  it("returns ~10625 (1.0625x) at 25% utilisation", async function () {
    const ctx = await deploy();
    await ctx.hoodgap.connect(ctx.staker).stake(STAKE_100K);
    // 25 % → U = 2500 bp → U² = 2500²/10000 = 625 → 1 + 625 = 10625
    const mult = await ctx.hoodgap.getUtilizationMultiplier(USDC(25_000));
    expect(mult).to.equal(10_625n);
  });

  it("returns ~12500 (1.25x) at 50% utilisation", async function () {
    const ctx = await deploy();
    await ctx.hoodgap.connect(ctx.staker).stake(STAKE_100K);
    // 50 % → U = 5000 bp → U² = 25000000/10000 = 2500 → 12500
    const mult = await ctx.hoodgap.getUtilizationMultiplier(USDC(50_000));
    expect(mult).to.equal(12_500n);
  });

  it("returns ~19025 (1.9025x) when capped at 95% utilisation", async function () {
    const ctx = await deploy();
    await ctx.hoodgap.connect(ctx.staker).stake(STAKE_100K);
    // Pool is $100k. Buying $99k → 99%, but capped at 95%
    // U = 9500 → U² = 9500²/10000 = 9025 → 10000 + 9025 = 19025
    const mult = await ctx.hoodgap.getUtilizationMultiplier(USDC(99_000));
    expect(mult).to.equal(19_025n);
  });

  it("multiplier increases monotonically with coverage", async function () {
    const ctx = await deploy();
    await ctx.hoodgap.connect(ctx.staker).stake(STAKE_100K);

    const m1 = await ctx.hoodgap.getUtilizationMultiplier(USDC(10_000));
    const m2 = await ctx.hoodgap.getUtilizationMultiplier(USDC(30_000));
    const m3 = await ctx.hoodgap.getUtilizationMultiplier(USDC(60_000));

    expect(m2).to.be.gt(m1);
    expect(m3).to.be.gt(m2);
  });

  // ─── getCurrentUtilization ────────────────────────────────────────────────────
  it("getCurrentUtilization returns 0 on empty pool", async function () {
    const ctx = await deploy();
    expect(await ctx.hoodgap.getCurrentUtilization()).to.equal(0n);
  });

  it("getCurrentUtilization returns 1000 (10%) after buying 10% of pool", async function () {
    const ctx = await deploy();
    await ctx.hoodgap.connect(ctx.staker).stake(STAKE_100K);       // $100k
    await ctx.hoodgap.connect(ctx.buyer).buyPolicy(USDC(10_000), THRESHOLD_5); // $10k
    expect(await ctx.hoodgap.getCurrentUtilization()).to.equal(1_000n);
  });

  it("getCurrentUtilization returns 5000 (50%) at half capacity", async function () {
    const ctx = await deploy();
    await ctx.hoodgap.connect(ctx.staker).stake(STAKE_100K);
    await ctx.hoodgap.connect(ctx.buyer).buyPolicy(USDC(50_000), THRESHOLD_5);
    expect(await ctx.hoodgap.getCurrentUtilization()).to.equal(5_000n);
  });

  // ─── getPoolStats utilization field ──────────────────────────────────────────
  it("getPoolStats.utilization matches getCurrentUtilization", async function () {
    const ctx = await deploy();
    await ctx.hoodgap.connect(ctx.staker).stake(STAKE_100K);
    await ctx.hoodgap.connect(ctx.buyer).buyPolicy(USDC(25_000), THRESHOLD_5);

    const [, , statUtil] = await ctx.hoodgap.getPoolStats();
    const directUtil     = await ctx.hoodgap.getCurrentUtilization();
    expect(statUtil).to.equal(directUtil);
  });
});
