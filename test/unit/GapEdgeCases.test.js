"use strict";

/**
 * test/unit/GapEdgeCases.test.js
 *
 * Tests: calculateGap() edge cases — penny stock prices, very large prices,
 *        very close prices (rounding), symmetry verification.
 *
 * These complement the basic gap tests in SplitAdjustment.test.js.
 */

const { expect } = require("chai");
const {
  deploy,
  PRICE_250,
} = require("../helpers/setup");

describe("Unit: GapEdgeCases", function () {
  // ─── Penny stock prices ──────────────────────────────────────────────────────
  it("handles very small prices (penny stocks)", async function () {
    const ctx = await deploy();
    // $0.01 in 8-decimal format = 1_000_000
    const priceA = 1_000_000n;  // $0.01
    const priceB = 10_000_000n; // $0.10

    const gap = await ctx.hoodgap.calculateGap(priceA, priceB);
    // diff = 9_000_000, gap = 9_000_000 × 10000 / 10_000_000 = 9000 bp (90%)
    expect(gap).to.equal(9_000n);
  });

  it("handles extremely small values (sub-penny)", async function () {
    const ctx = await deploy();
    const priceA = 1n;   // $0.00000001
    const priceB = 100n; // $0.000001

    const gap = await ctx.hoodgap.calculateGap(priceA, priceB);
    // diff = 99, gap = 99 × 10000 / 100 = 9900 bp (99%)
    expect(gap).to.equal(9_900n);
  });

  // ─── Very large prices ───────────────────────────────────────────────────────
  it("handles large prices ($1000+) without overflow", async function () {
    const ctx = await deploy();
    const priceA = 1_000_00_000_000n; // $1000
    const priceB = 900_00_000_000n;   // $900

    const gap = await ctx.hoodgap.calculateGap(priceA, priceB);
    // diff = 100e8, gap = 100e8 × 10000 / 900e8 = 1111 bp (11.11%)
    expect(gap).to.equal(1_111n);
  });

  it("handles very large prices ($100,000+)", async function () {
    const ctx = await deploy();
    const priceA = 100_000_00_000_000n; // $100,000
    const priceB = 95_000_00_000_000n;  // $95,000

    const gap = await ctx.hoodgap.calculateGap(priceA, priceB);
    // diff = 5000e8, gap = 5000e8 × 10000 / 95000e8 = 526 bp (5.26%)
    expect(gap).to.equal(526n);
  });

  // ─── Very close prices (rounding) ────────────────────────────────────────────
  it("returns 0 for prices differing by 1 unit against a large denominator", async function () {
    const ctx = await deploy();
    // $200.00000000 vs $200.00000001 (1 unit diff on 8-decimal)
    const priceA = 200_00_000_000n;
    const priceB = 200_00_000_001n;

    const gap = await ctx.hoodgap.calculateGap(priceA, priceB);
    // diff = 1, gap = 1 × 10000 / 200_00_000_001 ≈ 0 (rounds down)
    expect(gap).to.equal(0n);
  });

  it("returns small non-zero gap for slightly different prices", async function () {
    const ctx = await deploy();
    // $200 vs $199 = 0.5% gap
    const priceA = 200_00_000_000n;
    const priceB = 199_00_000_000n;

    const gap = await ctx.hoodgap.calculateGap(priceA, priceB);
    // diff = 1e8, gap = 1e8 × 10000 / 199e8 = 50 bp (0.50%)
    expect(gap).to.equal(50n);
  });

  // ─── Symmetry verification ──────────────────────────────────────────────────
  it("gap is not symmetric — different denominators yield different results", async function () {
    const ctx = await deploy();
    const priceA = 200_00_000_000n;
    const priceB = 180_00_000_000n;

    const gap1 = await ctx.hoodgap.calculateGap(priceA, priceB);
    const gap2 = await ctx.hoodgap.calculateGap(priceB, priceA);

    // gap1 = 20e8 × 10000 / 180e8 = 1111 bp (priceB is denominator)
    // gap2 = 20e8 × 10000 / 200e8 = 1000 bp (priceA is denominator)
    // Different because the denominator in calculateGap is priceB
    expect(gap1).to.equal(1_111n);
    expect(gap2).to.equal(1_000n);
    expect(gap1).to.not.equal(gap2);
  });

  it("both gap directions are positive for any non-equal pair", async function () {
    const ctx = await deploy();
    const priceA = PRICE_250;
    const priceB = 240_00_000_000n;

    const gap1 = await ctx.hoodgap.calculateGap(priceA, priceB);
    const gap2 = await ctx.hoodgap.calculateGap(priceB, priceA);

    expect(gap1).to.be.gt(0n);
    expect(gap2).to.be.gt(0n);
  });

  // ─── Maximum realistic gap ──────────────────────────────────────────────────
  it("handles near-total wipeout (95% drop)", async function () {
    const ctx = await deploy();
    const priceA = 10_00_000_000n;  // $10
    const priceB = 200_00_000_000n; // $200

    const gap = await ctx.hoodgap.calculateGap(priceA, priceB);
    // diff = 190e8, gap = 190e8 × 10000 / 200e8 = 9500 bp (95%)
    expect(gap).to.equal(9_500n);
  });
});
