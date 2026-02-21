"use strict";

/**
 * test/integration/FullLifecycle.test.js
 *
 * Tests: Complete end-to-end flows, access control (onlyOwner),
 *        volatility timelock, pause/unpause, treasury, getPoolStats,
 *        canBuyPolicy, getPolicies views.
 *
 * Updated for all-gap model.
 */

const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time }   = require("@nomicfoundation/hardhat-network-helpers");
const {
  deploy,
  stakeThenBuy,
  advanceToOpen,
  USDC,
  STAKE_100K,
  COVERAGE_10K,
  PRICE_230,
  PRICE_252,
  THRESHOLD_5,
  THRESHOLD_10,
} = require("../helpers/setup");

describe("Integration: FullLifecycle", function () {
  // ─── End-to-end: stake → buy → no-payout → withdraw ─────────────────────────
  it("full lifecycle: stake → buy → settle (no gap) → withdraw", async function () {
    const ctx      = await deploy();
    const policyId = await stakeThenBuy(ctx);

    // Advance to market open with no gap
    await advanceToOpen(ctx, 4, PRICE_252);
    await ctx.hoodgap.settlePolicy(policyId);

    // Pool liquidity freed — staker can withdraw
    await expect(() => ctx.hoodgap.connect(ctx.staker).requestWithdrawal(STAKE_100K))
      .to.changeTokenBalance(ctx.usdc, ctx.staker, STAKE_100K);
  });

  it("full lifecycle: stake → buy → settle (gap triggered) → holder receives full payout", async function () {
    const ctx      = await deploy();
    const policyId = await stakeThenBuy(ctx);

    await advanceToOpen(ctx, 4, PRICE_230);

    // 8% gap on 5% threshold → binary payout = full coverage
    const holderBefore = await ctx.usdc.balanceOf(ctx.buyer.address);
    await ctx.hoodgap.settlePolicy(policyId);
    const holderAfter  = await ctx.usdc.balanceOf(ctx.buyer.address);
    expect(holderAfter - holderBefore).to.equal(COVERAGE_10K);
  });

  // ─── Access control ───────────────────────────────────────────────────────────
  describe("Access control (onlyOwner)", function () {
    it("non-owner cannot pause", async function () {
      const ctx = await deploy();
      await expect(ctx.hoodgap.connect(ctx.alice).pause())
        .to.be.revertedWithCustomError(ctx.hoodgap, "OwnableUnauthorizedAccount");
    });

    it("non-owner cannot unpause", async function () {
      const ctx = await deploy();
      await ctx.hoodgap.pause();
      await expect(ctx.hoodgap.connect(ctx.alice).unpause())
        .to.be.revertedWithCustomError(ctx.hoodgap, "OwnableUnauthorizedAccount");
    });

    it("non-owner cannot approveSettlement", async function () {
      const ctx = await deploy();
      const settlementWeek = await ctx.hoodgap.getCurrentSettlementWeek();
      await expect(ctx.hoodgap.connect(ctx.alice).approveSettlement(settlementWeek, 10_000n, "hack"))
        .to.be.revertedWithCustomError(ctx.hoodgap, "OwnableUnauthorizedAccount");
    });

    it("non-owner cannot queueVolatilityChange", async function () {
      const ctx = await deploy();
      await expect(ctx.hoodgap.connect(ctx.alice).queueVolatilityChange(6_000n, "hack"))
        .to.be.revertedWithCustomError(ctx.hoodgap, "OwnableUnauthorizedAccount");
    });

    it("non-owner cannot setTreasury", async function () {
      const ctx = await deploy();
      await expect(ctx.hoodgap.connect(ctx.alice).setTreasury(ctx.alice.address))
        .to.be.revertedWithCustomError(ctx.hoodgap, "OwnableUnauthorizedAccount");
    });
  });

  // ─── Volatility timelock ──────────────────────────────────────────────────────
  describe("Volatility timelock", function () {
    it("queues change and emits VolatilityChangeQueued", async function () {
      const ctx = await deploy();
      await expect(ctx.hoodgap.connect(ctx.owner).queueVolatilityChange(6_000n, "elevated"))
        .to.emit(ctx.hoodgap, "VolatilityChangeQueued");
      const pending = await ctx.hoodgap.pendingVolatilityChange();
      expect(pending.exists).to.equal(true);
      expect(pending.value).to.equal(6_000n);
    });

    it("reverts execution before 24h", async function () {
      const ctx = await deploy();
      await ctx.hoodgap.connect(ctx.owner).queueVolatilityChange(6_000n, "test");
      await expect(ctx.hoodgap.executeVolatilityChange())
        .to.be.revertedWith("Timelock not elapsed");
    });

    it("executes successfully after 24h", async function () {
      const ctx = await deploy();
      await ctx.hoodgap.connect(ctx.owner).queueVolatilityChange(6_000n, "test");
      await time.increase(24 * 3600 + 1);
      await expect(ctx.hoodgap.executeVolatilityChange())
        .to.emit(ctx.hoodgap, "VolatilityUpdated")
        .withArgs(5_000n, 6_000n);
      expect(await ctx.hoodgap.currentVolatility()).to.equal(6_000n);
    });

    it("can be cancelled before execution", async function () {
      const ctx = await deploy();
      await ctx.hoodgap.connect(ctx.owner).queueVolatilityChange(6_000n, "test");
      await expect(ctx.hoodgap.cancelVolatilityChange())
        .to.emit(ctx.hoodgap, "VolatilityChangeCancelled");
      const pending = await ctx.hoodgap.pendingVolatilityChange();
      expect(pending.exists).to.equal(false);
    });

    it("reverts if vol out of range", async function () {
      const ctx = await deploy();
      await expect(ctx.hoodgap.connect(ctx.owner).queueVolatilityChange(999n, "too low"))
        .to.be.revertedWith("Volatility must be 10-150%");
      await expect(ctx.hoodgap.connect(ctx.owner).queueVolatilityChange(15_001n, "too high"))
        .to.be.revertedWith("Volatility must be 10-150%");
    });

    it("reverts double-queue without cancelling first", async function () {
      const ctx = await deploy();
      await ctx.hoodgap.connect(ctx.owner).queueVolatilityChange(6_000n, "first");
      await expect(ctx.hoodgap.connect(ctx.owner).queueVolatilityChange(7_000n, "second"))
        .to.be.revertedWith("Change already pending");
    });
  });

  // ─── Pause / Unpause ─────────────────────────────────────────────────────────
  describe("Pause / Unpause", function () {
    it("owner can pause and unpause", async function () {
      const ctx = await deploy();
      await expect(ctx.hoodgap.pause())
        .to.emit(ctx.hoodgap, "Paused").withArgs(ctx.owner.address);
      expect(await ctx.hoodgap.paused()).to.equal(true);

      await expect(ctx.hoodgap.unpause())
        .to.emit(ctx.hoodgap, "Unpaused").withArgs(ctx.owner.address);
      expect(await ctx.hoodgap.paused()).to.equal(false);
    });

    it("withdrawal still works while paused (users can exit)", async function () {
      const ctx = await deploy();
      await ctx.hoodgap.connect(ctx.staker).stake(STAKE_100K);
      await ctx.hoodgap.pause();
      await expect(ctx.hoodgap.connect(ctx.staker).requestWithdrawal(USDC(5_000)))
        .to.not.be.reverted;
    });

    it("settlement still works while paused (holders can claim)", async function () {
      const ctx      = await deploy();
      const policyId = await stakeThenBuy(ctx);
      await advanceToOpen(ctx, 4, PRICE_252);
      await ctx.hoodgap.pause();
      await expect(ctx.hoodgap.settlePolicy(policyId)).to.not.be.reverted;
    });
  });

  // ─── Treasury ─────────────────────────────────────────────────────────────────
  describe("Treasury", function () {
    it("setTreasury updates address and emits TreasuryUpdated", async function () {
      const ctx = await deploy();
      await expect(ctx.hoodgap.connect(ctx.owner).setTreasury(ctx.alice.address))
        .to.emit(ctx.hoodgap, "TreasuryUpdated")
        .withArgs(ctx.owner.address, ctx.alice.address);
      expect(await ctx.hoodgap.treasury()).to.equal(ctx.alice.address);
    });

    it("reverts on zero address", async function () {
      const ctx = await deploy();
      await expect(ctx.hoodgap.connect(ctx.owner).setTreasury(ethers.ZeroAddress))
        .to.be.revertedWith("Treasury cannot be zero address");
    });

    it("protocol fee routes to new treasury after update", async function () {
      const ctx = await deploy();
      await ctx.hoodgap.connect(ctx.owner).setTreasury(ctx.alice.address);
      await ctx.hoodgap.connect(ctx.staker).stake(STAKE_100K);
      const premium     = await ctx.hoodgap["calculatePremium(uint256,uint256)"](COVERAGE_10K, THRESHOLD_5);
      const protocolFee = (premium * 300n) / 10_000n;
      await expect(() => ctx.hoodgap.connect(ctx.buyer).buyPolicy(COVERAGE_10K, THRESHOLD_5))
        .to.changeTokenBalance(ctx.usdc, ctx.alice, protocolFee);
    });
  });

  // ─── View functions ───────────────────────────────────────────────────────────
  describe("View functions", function () {
    it("getPoolStats returns zeros on fresh deploy", async function () {
      const ctx = await deploy();
      const [staked, coverage, util, reserve] = await ctx.hoodgap.getPoolStats();
      expect(staked).to.equal(0n);
      expect(coverage).to.equal(0n);
      expect(util).to.equal(0n);
      expect(reserve).to.equal(0n);
    });

    it("getPoolStats utilization is 1000 (10%) after buying 10% of pool", async function () {
      const ctx = await deploy();
      await stakeThenBuy(ctx);
      const [, , util] = await ctx.hoodgap.getPoolStats();
      expect(util).to.equal(1_000n);
    });

    it("canBuyPolicy returns false when paused", async function () {
      const ctx = await deploy();
      await ctx.hoodgap.pause();
      const [canBuy, reason] = await ctx.hoodgap.canBuyPolicy(ctx.buyer.address, COVERAGE_10K, THRESHOLD_5);
      expect(canBuy).to.equal(false);
      expect(reason).to.equal("Contract paused");
    });

    it("canBuyPolicy returns true with premium when ready", async function () {
      const ctx = await deploy();
      await ctx.hoodgap.connect(ctx.staker).stake(STAKE_100K);
      const [canBuy, reason, premium] = await ctx.hoodgap.canBuyPolicy(ctx.buyer.address, COVERAGE_10K, THRESHOLD_5);
      expect(canBuy).to.equal(true);
      expect(reason).to.equal("Ready to purchase");
      expect(premium).to.be.gt(0n);
    });

    it("getPolicies batch-fetches multiple policies in order", async function () {
      const ctx = await deploy();
      await ctx.hoodgap.connect(ctx.staker).stake(STAKE_100K);
      await ctx.hoodgap.connect(ctx.buyer).buyPolicy(COVERAGE_10K, THRESHOLD_5);
      await ctx.hoodgap.connect(ctx.buyer).buyPolicy(USDC(5_000), THRESHOLD_10);

      const results = await ctx.hoodgap.getPolicies([0n, 1n]);
      expect(results.length).to.equal(2);
      expect(results[0].coverage).to.equal(COVERAGE_10K);
      expect(results[1].coverage).to.equal(USDC(5_000));
      expect(results[1].threshold).to.equal(THRESHOLD_10);
    });
  });
});
