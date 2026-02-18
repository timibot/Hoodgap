"use strict";

/**
 * test/integration/StakeWithdraw.test.js
 *
 * Tests: stake(), requestWithdrawal (immediate + queued),
 *        cancelWithdrawalRequest(), processWithdrawalQueue(),
 *        getQueueStats(), getUserWithdrawals().
 */

const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time }   = require("@nomicfoundation/hardhat-network-helpers");
const {
  deploy,
  stakeThenBuy,
  advanceToMonday,
  USDC,
  STAKE_100K,
  COVERAGE_10K,
  PRICE_252,
  THRESHOLD_5,
} = require("../helpers/setup");

describe("Integration: StakeWithdraw", function () {
  // ─── stake() ─────────────────────────────────────────────────────────────────
  describe("stake()", function () {
    it("updates stakerBalances and totalStaked", async function () {
      const ctx = await deploy();
      await ctx.hoodgap.connect(ctx.staker).stake(STAKE_100K);
      expect(await ctx.hoodgap.stakerBalances(ctx.staker.address)).to.equal(STAKE_100K);
      expect(await ctx.hoodgap.totalStaked()).to.equal(STAKE_100K);
    });

    it("transfers USDC from staker to contract", async function () {
      const ctx    = await deploy();
      const hgAddr = await ctx.hoodgap.getAddress();
      await expect(() => ctx.hoodgap.connect(ctx.staker).stake(STAKE_100K))
        .to.changeTokenBalances(ctx.usdc, [ctx.staker, hgAddr], [-STAKE_100K, STAKE_100K]);
    });

    it("emits Staked event", async function () {
      const ctx = await deploy();
      await expect(ctx.hoodgap.connect(ctx.staker).stake(STAKE_100K))
        .to.emit(ctx.hoodgap, "Staked")
        .withArgs(ctx.staker.address, STAKE_100K, (v) => typeof v === "bigint");
    });

    it("multiple stakers are tracked independently", async function () {
      const ctx = await deploy();
      await ctx.usdc.mint(ctx.alice.address, STAKE_100K);
      await ctx.usdc.connect(ctx.alice).approve(await ctx.hoodgap.getAddress(), ethers.MaxUint256);

      await ctx.hoodgap.connect(ctx.staker).stake(STAKE_100K);
      await ctx.hoodgap.connect(ctx.alice).stake(USDC(50_000));

      expect(await ctx.hoodgap.stakerBalances(ctx.staker.address)).to.equal(STAKE_100K);
      expect(await ctx.hoodgap.stakerBalances(ctx.alice.address)).to.equal(USDC(50_000));
      expect(await ctx.hoodgap.totalStaked()).to.equal(STAKE_100K + USDC(50_000));
    });

    it("reverts when amount is 0", async function () {
      const ctx = await deploy();
      await expect(ctx.hoodgap.connect(ctx.staker).stake(0n))
        .to.be.revertedWith("Amount must be > 0");
    });

    it("reverts when contract is paused", async function () {
      const ctx = await deploy();
      await ctx.hoodgap.pause();
      await expect(ctx.hoodgap.connect(ctx.staker).stake(STAKE_100K))
        .to.be.revertedWith("Contract is paused");
    });
  });

  // ─── requestWithdrawal — immediate ───────────────────────────────────────────
  describe("requestWithdrawal() — immediate", function () {
    it("pays out immediately when free liquidity is available", async function () {
      const ctx  = await deploy();
      await ctx.hoodgap.connect(ctx.staker).stake(STAKE_100K);
      await expect(() => ctx.hoodgap.connect(ctx.staker).requestWithdrawal(USDC(10_000)))
        .to.changeTokenBalance(ctx.usdc, ctx.staker, USDC(10_000));
    });

    it("decreases stakerBalances and totalStaked on immediate withdrawal", async function () {
      const ctx = await deploy();
      await ctx.hoodgap.connect(ctx.staker).stake(STAKE_100K);
      await ctx.hoodgap.connect(ctx.staker).requestWithdrawal(USDC(10_000));
      expect(await ctx.hoodgap.stakerBalances(ctx.staker.address)).to.equal(STAKE_100K - USDC(10_000));
      expect(await ctx.hoodgap.totalStaked()).to.equal(STAKE_100K - USDC(10_000));
    });

    it("emits WithdrawalProcessed on immediate withdrawal", async function () {
      const ctx = await deploy();
      await ctx.hoodgap.connect(ctx.staker).stake(STAKE_100K);
      await expect(ctx.hoodgap.connect(ctx.staker).requestWithdrawal(USDC(5_000)))
        .to.emit(ctx.hoodgap, "WithdrawalProcessed");
    });

    it("reverts when withdrawing more than staker balance", async function () {
      const ctx = await deploy();
      await ctx.hoodgap.connect(ctx.staker).stake(USDC(1_000));
      await expect(ctx.hoodgap.connect(ctx.staker).requestWithdrawal(USDC(2_000)))
        .to.be.revertedWith("Insufficient staker balance");
    });
  });

  // ─── requestWithdrawal — queued ──────────────────────────────────────────────
  describe("requestWithdrawal() — queued", function () {
    async function fullPoolCtx() {
      const ctx = await deploy();
      // Stake exactly COVERAGE_10K so pool is fully locked after one policy
      await ctx.hoodgap.connect(ctx.staker).stake(COVERAGE_10K);
      await ctx.usdc.mint(ctx.staker.address, COVERAGE_10K); // extra to refill
      await ctx.hoodgap.connect(ctx.buyer).buyPolicy(COVERAGE_10K, THRESHOLD_5);
      return ctx;
    }

    it("queues when pool liquidity is fully locked", async function () {
      const ctx = await fullPoolCtx();
      await expect(ctx.hoodgap.connect(ctx.staker).requestWithdrawal(COVERAGE_10K))
        .to.emit(ctx.hoodgap, "WithdrawalQueued");
    });

    it("getQueueStats shows 1 pending request", async function () {
      const ctx = await fullPoolCtx();
      await ctx.hoodgap.connect(ctx.staker).requestWithdrawal(COVERAGE_10K);
      const [head, length, pending] = await ctx.hoodgap.getQueueStats();
      expect(pending).to.equal(1n);
      expect(head).to.equal(0n);
      expect(length).to.equal(1n);
    });

    it("does not transfer USDC when queued", async function () {
      const ctx      = await fullPoolCtx();
      const balBefore = await ctx.usdc.balanceOf(ctx.staker.address);
      await ctx.hoodgap.connect(ctx.staker).requestWithdrawal(COVERAGE_10K);
      const balAfter  = await ctx.usdc.balanceOf(ctx.staker.address);
      expect(balAfter).to.equal(balBefore); // unchanged
    });
  });

  // ─── cancelWithdrawalRequest ──────────────────────────────────────────────────
  describe("cancelWithdrawalRequest()", function () {
    async function queuedCtx() {
      const ctx = await deploy();
      await ctx.hoodgap.connect(ctx.staker).stake(COVERAGE_10K);
      await ctx.hoodgap.connect(ctx.buyer).buyPolicy(COVERAGE_10K, THRESHOLD_5);
      await ctx.hoodgap.connect(ctx.staker).requestWithdrawal(COVERAGE_10K);
      return ctx;
    }

    it("marks request as processed", async function () {
      const ctx = await queuedCtx();
      await ctx.hoodgap.connect(ctx.staker).cancelWithdrawalRequest(0n);
      const req = await ctx.hoodgap.withdrawalQueue(0n);
      expect(req.processed).to.equal(true);
    });

    it("emits WithdrawalCancelled", async function () {
      const ctx = await queuedCtx();
      await expect(ctx.hoodgap.connect(ctx.staker).cancelWithdrawalRequest(0n))
        .to.emit(ctx.hoodgap, "WithdrawalCancelled")
        .withArgs(ctx.staker.address, 0n, (v) => typeof v === "bigint");
    });

    it("reverts when called by non-owner of request", async function () {
      const ctx = await queuedCtx();
      await expect(ctx.hoodgap.connect(ctx.alice).cancelWithdrawalRequest(0n))
        .to.be.revertedWith("Not your request");
    });

    it("reverts when request is already processed", async function () {
      const ctx = await queuedCtx();
      await ctx.hoodgap.connect(ctx.staker).cancelWithdrawalRequest(0n);
      await expect(ctx.hoodgap.connect(ctx.staker).cancelWithdrawalRequest(0n))
        .to.be.revertedWith("Already processed");
    });
  });

  // ─── processWithdrawalQueue ───────────────────────────────────────────────────
  describe("processWithdrawalQueue()", function () {
    it("processes requests and advances queueHead when liquidity arrives", async function () {
      const ctx = await deploy();
      await ctx.hoodgap.connect(ctx.staker).stake(COVERAGE_10K);
      await ctx.hoodgap.connect(ctx.buyer).buyPolicy(COVERAGE_10K, THRESHOLD_5);

      // Queue a withdrawal
      await ctx.hoodgap.connect(ctx.staker).requestWithdrawal(COVERAGE_10K);

      // Settle policy to free liquidity (no payout)
      const settlementWeek = await ctx.hoodgap.getCurrentSettlementWeek();
      await ctx.hoodgap.connect(ctx.owner).approveSettlement(settlementWeek, 10_000n, "test");
      await advanceToMonday(ctx, PRICE_252);
      await ctx.hoodgap.settlePolicy(0n);

      // queueHead should have advanced past index 0
      const [head] = await ctx.hoodgap.getQueueStats();
      expect(head).to.equal(1n);
    });

    it("reverts when maxToProcess is 0 or > 50", async function () {
      const ctx = await deploy();
      await expect(ctx.hoodgap.processWithdrawalQueue(0n))
        .to.be.revertedWith("Process 1-50 per call");
      await expect(ctx.hoodgap.processWithdrawalQueue(51n))
        .to.be.revertedWith("Process 1-50 per call");
    });
  });

  // ─── getUserWithdrawals ───────────────────────────────────────────────────────
  describe("getUserWithdrawals()", function () {
    it("returns empty array when user has no requests", async function () {
      const ctx      = await deploy();
      const requests = await ctx.hoodgap.getUserWithdrawals(ctx.staker.address);
      expect(requests.length).to.equal(0);
    });

    it("returns all requests for a user including processed ones", async function () {
      const ctx = await deploy();
      await ctx.hoodgap.connect(ctx.staker).stake(COVERAGE_10K * 3n);
      await ctx.hoodgap.connect(ctx.buyer).buyPolicy(COVERAGE_10K, THRESHOLD_5);
      await ctx.hoodgap.connect(ctx.buyer).buyPolicy(COVERAGE_10K, THRESHOLD_5);
      await ctx.hoodgap.connect(ctx.buyer).buyPolicy(COVERAGE_10K, THRESHOLD_5);

      await ctx.hoodgap.connect(ctx.staker).requestWithdrawal(USDC(1_000));
      await ctx.hoodgap.connect(ctx.staker).requestWithdrawal(USDC(1_000));

      const requests = await ctx.hoodgap.getUserWithdrawals(ctx.staker.address);
      expect(requests.length).to.equal(2);
      expect(requests[0].staker).to.equal(ctx.staker.address);
      expect(requests[1].staker).to.equal(ctx.staker.address);
    });
  });
});
