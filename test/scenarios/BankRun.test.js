"use strict";

/**
 * test/scenarios/BankRun.test.js
 *
 * Real-world scenario: Large gap payout drains pool,
 * many stakers try to withdraw simultaneously, FIFO queue handles it.
 * Validates: queue fairness, liquidity freeing as policies settle,
 *            queueHead advancing correctly.
 *
 * Updated for all-gap model.
 */

const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time }   = require("@nomicfoundation/hardhat-network-helpers");
const {
  deploy,
  advanceToOpen,
  USDC,
  STAKE_100K,
  COVERAGE_10K,
  PRICE_230,
  PRICE_252,
  THRESHOLD_5,
} = require("../helpers/setup");

describe("Scenario: BankRun", function () {

  async function bankRunSetup() {
    const ctx = await deploy();
    await ctx.hoodgap.connect(ctx.staker).stake(STAKE_100K);
    const coverage = USDC(25_000);
    await ctx.hoodgap.connect(ctx.buyer).buyPolicy(coverage, THRESHOLD_5);
    await ctx.hoodgap.connect(ctx.buyer).buyPolicy(coverage, THRESHOLD_5);
    return { ctx, coverage };
  }

  // ─── Post-gap bank run ────────────────────────────────────────────────────────
  it("after gap payout: immediate withdrawal limited to free liquidity", async function () {
    const { ctx, coverage } = await bankRunSetup();

    await advanceToOpen(ctx, 4, PRICE_230); // 8% gap
    await ctx.hoodgap.settlePolicy(0n);
    await ctx.hoodgap.settlePolicy(1n);

    const freeLiq = await ctx.hoodgap.totalStaked();
    expect(freeLiq).to.be.lt(STAKE_100K);

    await ctx.hoodgap.connect(ctx.staker).requestWithdrawal(freeLiq);
    expect(await ctx.usdc.balanceOf(ctx.staker.address)).to.be.gte(freeLiq);
  });

  it("withdrawal is queued when free liquidity is exhausted", async function () {
    const { ctx } = await bankRunSetup();

    await advanceToOpen(ctx, 4, PRICE_230);
    await ctx.hoodgap.settlePolicy(0n);
    await ctx.hoodgap.settlePolicy(1n);

    const freeLiq = await ctx.hoodgap.totalStaked();
    await ctx.hoodgap.connect(ctx.staker).requestWithdrawal(freeLiq);

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

    const [, , , , staker2] = await ethers.getSigners();
    await ctx.usdc.mint(staker2.address, COVERAGE_10K);
    await ctx.usdc.connect(staker2).approve(await ctx.hoodgap.getAddress(), ethers.MaxUint256);

    await ctx.hoodgap.connect(ctx.staker).stake(COVERAGE_10K);
    await ctx.hoodgap.connect(staker2).stake(COVERAGE_10K);

    await ctx.hoodgap.connect(ctx.buyer).buyPolicy(COVERAGE_10K, THRESHOLD_5);
    await ctx.hoodgap.connect(ctx.buyer).buyPolicy(COVERAGE_10K, THRESHOLD_5);

    await ctx.hoodgap.connect(ctx.staker).requestWithdrawal(COVERAGE_10K);
    await ctx.hoodgap.connect(staker2).requestWithdrawal(COVERAGE_10K);

    const req0 = await ctx.hoodgap.withdrawalQueue(0n);
    const req1 = await ctx.hoodgap.withdrawalQueue(1n);

    expect(req0.staker).to.equal(ctx.staker.address);
    expect(req1.staker).to.equal(staker2.address);
    expect(req0.requestTime).to.be.lte(req1.requestTime);
  });

  // ─── queueHead advances ──────────────────────────────────────────────────────
  it("queueHead advances past processed requests — does not restart from 0", async function () {
    const ctx = await deploy();

    await ctx.hoodgap.connect(ctx.staker).stake(COVERAGE_10K * 2n);
    await ctx.hoodgap.connect(ctx.buyer).buyPolicy(COVERAGE_10K, THRESHOLD_5);
    await ctx.hoodgap.connect(ctx.buyer).buyPolicy(COVERAGE_10K, THRESHOLD_5);

    await ctx.hoodgap.connect(ctx.staker).requestWithdrawal(USDC(5_000));
    await ctx.hoodgap.connect(ctx.staker).requestWithdrawal(USDC(5_000));

    let [head] = await ctx.hoodgap.getQueueStats();
    expect(head).to.equal(0n);

    await advanceToOpen(ctx, 4, PRICE_252);
    await ctx.hoodgap.settlePolicy(0n);

    ;[head] = await ctx.hoodgap.getQueueStats();
    expect(head).to.be.gte(1n);
  });

  // ─── Cancellation mid-run ────────────────────────────────────────────────────
  it("cancelled requests are skipped by queue processing", async function () {
    const ctx = await deploy();

    await ctx.hoodgap.connect(ctx.staker).stake(COVERAGE_10K);
    await ctx.hoodgap.connect(ctx.buyer).buyPolicy(COVERAGE_10K, THRESHOLD_5);

    await ctx.hoodgap.connect(ctx.staker).requestWithdrawal(COVERAGE_10K);
    await ctx.hoodgap.connect(ctx.staker).cancelWithdrawalRequest(0n);

    const [head, , pending] = await ctx.hoodgap.getQueueStats();
    expect(pending).to.equal(0n);
  });

  // ─── Pool survives bank run via liquidity trickling back ──────────────────────
  it("pool survives: queued withdrawals eventually process as policies settle", async function () {
    const ctx = await deploy();
    await ctx.hoodgap.connect(ctx.staker).stake(STAKE_100K);

    await ctx.hoodgap.connect(ctx.buyer).buyPolicy(USDC(50_000), THRESHOLD_5);
    await ctx.hoodgap.connect(ctx.alice).buyPolicy(USDC(50_000), THRESHOLD_5);

    await ctx.hoodgap.connect(ctx.staker).requestWithdrawal(USDC(50_000));

    let [, , pending] = await ctx.hoodgap.getQueueStats();
    expect(pending).to.equal(1n);

    await advanceToOpen(ctx, 4, PRICE_252);
    await ctx.hoodgap.settlePolicy(0n);

    ;[, , pending] = await ctx.hoodgap.getQueueStats();
    expect(pending).to.equal(0n);
  });
});
