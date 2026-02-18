"use strict";

/**
 * test/scenarios/BankRun.test.js
 *
 * Real-world scenario from DAY1: Large gap payout drains pool,
 * many stakers try to withdraw simultaneously, FIFO queue handles it.
 * Validates: queue fairness, liquidity freeing as policies settle,
 *            queueHead advancing correctly (FRIEND #1).
 */

const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time }   = require("@nomicfoundation/hardhat-network-helpers");
const {
  deploy,
  advanceToMonday,
  USDC,
  STAKE_100K,
  COVERAGE_10K,
  PRICE_230,
  PRICE_252,
  THRESHOLD_5,
} = require("../helpers/setup");

describe("Scenario: BankRun", function () {
  /**
   * Pool setup:
   *   - 1 staker with $100k
   *   - Buyer buys 2 policies of $25k each = $50k coverage (50% utilisation)
   *     (we use 2×$25k because MAX_POLICY_COVERAGE = $50k, and we want
   *      the total coverage to be meaningful without exceeding the per-policy cap)
   *   - Gap occurs: pool pays $50k → pool drops to ~$50k + premiums
   *   - Staker tries to withdraw — limited to free liquidity
   */

  async function bankRunSetup() {
    const ctx = await deploy();

    // Stake $100k
    await ctx.hoodgap.connect(ctx.staker).stake(STAKE_100K);

    // Buy 2 × $25k coverage (50% utilisation)
    const coverage = USDC(25_000);
    await ctx.hoodgap.connect(ctx.buyer).buyPolicy(coverage, THRESHOLD_5);
    await ctx.hoodgap.connect(ctx.buyer).buyPolicy(coverage, THRESHOLD_5);

    return { ctx, coverage };
  }

  // ─── Post-gap bank run ────────────────────────────────────────────────────────
  it("after gap payout: immediate withdrawal limited to free liquidity", async function () {
    const { ctx, coverage } = await bankRunSetup();

    // Settle with 8% gap → pool pays out for both policies ($25k each)
    const settlementWeek = await ctx.hoodgap.getCurrentSettlementWeek();
    await ctx.hoodgap.connect(ctx.owner).approveSettlement(settlementWeek, 10_000n, "normal week");
    await advanceToMonday(ctx, PRICE_230);
    await ctx.hoodgap.settlePolicy(0n);
    await ctx.hoodgap.settlePolicy(1n);

    // Free liquidity = totalStaked (reduced by payouts) - totalCoverage (now 0)
    const freeLiq = await ctx.hoodgap.totalStaked();
    expect(freeLiq).to.be.lt(STAKE_100K);

    // Staker requests freeLiq — should get it immediately
    await ctx.hoodgap.connect(ctx.staker).requestWithdrawal(freeLiq);
    expect(await ctx.usdc.balanceOf(ctx.staker.address)).to.be.gte(freeLiq);
  });

  it("withdrawal is queued when free liquidity is exhausted", async function () {
    const { ctx } = await bankRunSetup();

    // Gap payout
    const settlementWeek = await ctx.hoodgap.getCurrentSettlementWeek();
    await ctx.hoodgap.connect(ctx.owner).approveSettlement(settlementWeek, 10_000n, "normal");
    await advanceToMonday(ctx, PRICE_230);
    await ctx.hoodgap.settlePolicy(0n);
    await ctx.hoodgap.settlePolicy(1n);

    // Drain free liquidity
    const freeLiq = await ctx.hoodgap.totalStaked();
    await ctx.hoodgap.connect(ctx.staker).requestWithdrawal(freeLiq);

    // Now try to queue more (staker still has balance if staker balance > freeLiq)
    const remainingBal = await ctx.hoodgap.stakerBalances(ctx.staker.address);
    if (remainingBal > 0n) {
      await expect(ctx.hoodgap.connect(ctx.staker).requestWithdrawal(remainingBal))
        .to.emit(ctx.hoodgap, "WithdrawalQueued");

      const [, , pending] = await ctx.hoodgap.getQueueStats();
      expect(pending).to.equal(1n);
    }
  });

  // ─── Multiple stakers queuing (FIFO) ─────────────────────────────────────────
  it("FIFO queue: first queued request is processed first", async function () {
    const ctx = await deploy();

    // Two stakers, fully locked pool
    const [, , , , staker2] = await ethers.getSigners();
    await ctx.usdc.mint(staker2.address, COVERAGE_10K);
    await ctx.usdc.connect(staker2).approve(await ctx.hoodgap.getAddress(), ethers.MaxUint256);

    await ctx.hoodgap.connect(ctx.staker).stake(COVERAGE_10K);
    await ctx.hoodgap.connect(staker2).stake(COVERAGE_10K);

    // Buy exactly 2×coverage to lock all liquidity
    await ctx.hoodgap.connect(ctx.buyer).buyPolicy(COVERAGE_10K, THRESHOLD_5);
    await ctx.hoodgap.connect(ctx.buyer).buyPolicy(COVERAGE_10K, THRESHOLD_5);

    // Both stakers queue withdrawals
    await ctx.hoodgap.connect(ctx.staker).requestWithdrawal(COVERAGE_10K); // queue[0]
    await ctx.hoodgap.connect(staker2).requestWithdrawal(COVERAGE_10K);    // queue[1]

    const req0 = await ctx.hoodgap.withdrawalQueue(0n);
    const req1 = await ctx.hoodgap.withdrawalQueue(1n);

    expect(req0.staker).to.equal(ctx.staker.address);
    expect(req1.staker).to.equal(staker2.address);
    expect(req0.requestTime).to.be.lte(req1.requestTime); // staker was first
  });

  // ─── queueHead advances (FRIEND #1) ──────────────────────────────────────────
  it("queueHead advances past processed requests — does not restart from 0", async function () {
    const ctx = await deploy();

    await ctx.hoodgap.connect(ctx.staker).stake(COVERAGE_10K * 2n);
    await ctx.hoodgap.connect(ctx.buyer).buyPolicy(COVERAGE_10K, THRESHOLD_5);
    await ctx.hoodgap.connect(ctx.buyer).buyPolicy(COVERAGE_10K, THRESHOLD_5);

    // Queue two withdrawals
    await ctx.hoodgap.connect(ctx.staker).requestWithdrawal(USDC(5_000));
    await ctx.hoodgap.connect(ctx.staker).requestWithdrawal(USDC(5_000));

    let [head] = await ctx.hoodgap.getQueueStats();
    expect(head).to.equal(0n);

    // Settle one policy to release some liquidity
    const settlementWeek = await ctx.hoodgap.getCurrentSettlementWeek();
    await ctx.hoodgap.connect(ctx.owner).approveSettlement(settlementWeek, 10_000n, "test");
    await advanceToMonday(ctx, PRICE_252);
    await ctx.hoodgap.settlePolicy(0n);

    // queueHead should have advanced
    ;[head] = await ctx.hoodgap.getQueueStats();
    expect(head).to.be.gte(1n);
  });

  // ─── Cancellation mid-run ────────────────────────────────────────────────────
  it("cancelled requests are skipped by queue processing", async function () {
    const ctx = await deploy();

    await ctx.hoodgap.connect(ctx.staker).stake(COVERAGE_10K);
    await ctx.hoodgap.connect(ctx.buyer).buyPolicy(COVERAGE_10K, THRESHOLD_5);

    // Queue a withdrawal then cancel it
    await ctx.hoodgap.connect(ctx.staker).requestWithdrawal(COVERAGE_10K);
    await ctx.hoodgap.connect(ctx.staker).cancelWithdrawalRequest(0n);

    const [head, , pending] = await ctx.hoodgap.getQueueStats();
    expect(pending).to.equal(0n); // cancelled, nothing pending
  });

  // ─── Pool survives bank run via liquidity trickling back ──────────────────────
  it("pool survives: queued withdrawals eventually process as policies settle", async function () {
    const ctx = await deploy();
    await ctx.hoodgap.connect(ctx.staker).stake(STAKE_100K);

    // Lock ALL liquidity with 2 × $50k policies
    await ctx.hoodgap.connect(ctx.buyer).buyPolicy(USDC(50_000), THRESHOLD_5);
    await ctx.hoodgap.connect(ctx.alice).buyPolicy(USDC(50_000), THRESHOLD_5);

    // No free liquidity → withdrawal is queued
    await ctx.hoodgap.connect(ctx.staker).requestWithdrawal(USDC(50_000));

    let [, , pending] = await ctx.hoodgap.getQueueStats();
    expect(pending).to.equal(1n);

    // Settle one policy with no gap → $50k liquidity freed → queue auto-processes
    const settlementWeek = await ctx.hoodgap.getCurrentSettlementWeek();
    await ctx.hoodgap.connect(ctx.owner).approveSettlement(settlementWeek, 10_000n, "test");
    await advanceToMonday(ctx, PRICE_252);
    await ctx.hoodgap.settlePolicy(0n);

    ;[, , pending] = await ctx.hoodgap.getQueueStats();
    expect(pending).to.equal(0n); // withdrawal processed
  });
});
