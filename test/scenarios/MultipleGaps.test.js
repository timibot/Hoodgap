"use strict";

/**
 * test/scenarios/MultipleGaps.test.js
 *
 * Real-world scenario: Multiple policies in the same week.
 * Some gap, some don't. Different thresholds. Reserve usage.
 * Validates accounting integrity across many policies.
 *
 * Updated for all-gap model.
 */

const { expect } = require("chai");
const { ethers } = require("hardhat");
const {
  deploy,
  advanceToOpen,
  USDC,
  STAKE_100K,
  COVERAGE_10K,
  MAX_COVERAGE,
  PRICE_230,
  PRICE_252,
  THRESHOLD_5,
  THRESHOLD_10,
} = require("../helpers/setup");

describe("Scenario: MultipleGaps", function () {
  /**
   * Pool: $100k staked
   * 3 policies bought same gap (Monday):
   *   Policy 0: $10k, 5% threshold  → 8% gap → PAYOUT
   *   Policy 1: $10k, 10% threshold → 8% gap → no payout (below threshold)
   *   Policy 2: $10k, 5% threshold  → 8% gap → PAYOUT
   */

  async function multiPolicySetup() {
    const ctx = await deploy();
    await ctx.hoodgap.connect(ctx.staker).stake(STAKE_100K);

    await ctx.hoodgap.connect(ctx.buyer).buyPolicy(COVERAGE_10K, THRESHOLD_5);
    await ctx.hoodgap.connect(ctx.buyer).buyPolicy(COVERAGE_10K, THRESHOLD_10);
    await ctx.hoodgap.connect(ctx.alice).buyPolicy(COVERAGE_10K, THRESHOLD_5);

    return ctx;
  }

  // ─── Selective payout ─────────────────────────────────────────────────────────
  it("8% gap: 5%-threshold policies pay out, 10%-threshold does not", async function () {
    const ctx = await multiPolicySetup();
    await advanceToOpen(ctx, 4, PRICE_230); // 8% gap

    await ctx.hoodgap.settlePolicy(0n);
    await ctx.hoodgap.settlePolicy(1n);
    await ctx.hoodgap.settlePolicy(2n);

    const p0 = await ctx.hoodgap.policies(0n);
    const p1 = await ctx.hoodgap.policies(1n);
    const p2 = await ctx.hoodgap.policies(2n);

    expect(p0.paidOut).to.equal(true);
    expect(p1.paidOut).to.equal(false); // 8% gap < 10% threshold
    expect(p2.paidOut).to.equal(true);
  });

  // ─── Accounting integrity ─────────────────────────────────────────────────────
  it("totalCoverage drops to 0 after all policies settled", async function () {
    const ctx = await multiPolicySetup();
    await advanceToOpen(ctx, 4, PRICE_230);

    await ctx.hoodgap.settlePolicy(0n);
    await ctx.hoodgap.settlePolicy(1n);
    await ctx.hoodgap.settlePolicy(2n);

    expect(await ctx.hoodgap.totalCoverage()).to.equal(0n);
  });

  it("totalStaked correctly reflects binary payouts (2 × $10k paid out)", async function () {
    const ctx = await multiPolicySetup();

    const [stakedBefore] = await ctx.hoodgap.getPoolStats();

    await advanceToOpen(ctx, 4, PRICE_230);

    await ctx.hoodgap.settlePolicy(0n);
    await ctx.hoodgap.settlePolicy(1n);
    await ctx.hoodgap.settlePolicy(2n);

    const [stakedAfter] = await ctx.hoodgap.getPoolStats();
    expect(stakedBefore - stakedAfter).to.equal(COVERAGE_10K * 2n);
  });

  it("binary payouts go to correct holders", async function () {
    const ctx = await multiPolicySetup();
    await advanceToOpen(ctx, 4, PRICE_230);

    const buyerBefore = await ctx.usdc.balanceOf(ctx.buyer.address);
    const aliceBefore = await ctx.usdc.balanceOf(ctx.alice.address);

    await ctx.hoodgap.settlePolicy(0n);
    await ctx.hoodgap.settlePolicy(1n);
    await ctx.hoodgap.settlePolicy(2n);

    const buyerGain = (await ctx.usdc.balanceOf(ctx.buyer.address)) - buyerBefore;
    const aliceGain = (await ctx.usdc.balanceOf(ctx.alice.address)) - aliceBefore;

    expect(buyerGain).to.equal(COVERAGE_10K);
    expect(aliceGain).to.equal(COVERAGE_10K);
  });

  // ─── Reserve coverage ─────────────────────────────────────────────────────────
  it("reserveBalance accumulates from all three policy premiums", async function () {
    const ctx = await multiPolicySetup();

    const reserve = await ctx.hoodgap.reserveBalance();
    expect(reserve).to.be.gt(0n);
    const minReserve = USDC(3) / 100n;
    expect(reserve).to.be.gte(minReserve);
  });

  // ─── Race to last slot ────────────────────────────────────────────────────────
  it("last-buyer-rejected when pool hits capacity mid-batch", async function () {
    const ctx = await deploy();
    await ctx.hoodgap.connect(ctx.staker).stake(COVERAGE_10K * 2n);

    await ctx.hoodgap.connect(ctx.buyer).buyPolicy(COVERAGE_10K, THRESHOLD_5);
    await ctx.hoodgap.connect(ctx.buyer).buyPolicy(COVERAGE_10K, THRESHOLD_5);

    await expect(ctx.hoodgap.connect(ctx.alice).buyPolicy(COVERAGE_10K, THRESHOLD_5))
      .to.be.revertedWith("Insufficient pool liquidity");
  });

  // ─── No-gap day: all premiums stay in pool ───────────────────────────────────
  it("no-gap day: all policies settled, totalStaked unchanged", async function () {
    const ctx = await deploy();
    await ctx.hoodgap.connect(ctx.staker).stake(STAKE_100K);

    await ctx.hoodgap.connect(ctx.buyer).buyPolicy(COVERAGE_10K, THRESHOLD_5);
    await ctx.hoodgap.connect(ctx.alice).buyPolicy(USDC(5_000), THRESHOLD_5);

    const [stakedBefore] = await ctx.hoodgap.getPoolStats();

    await advanceToOpen(ctx, 4, PRICE_252);
    await ctx.hoodgap.settlePolicy(0n);
    await ctx.hoodgap.settlePolicy(1n);

    const [stakedAfter] = await ctx.hoodgap.getPoolStats();
    expect(stakedAfter).to.equal(stakedBefore);
  });
});
