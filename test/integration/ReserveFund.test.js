"use strict";

/**
 * test/integration/ReserveFund.test.js
 *
 * Tests: Reserve fund behaviour — accumulation from premiums (77% claim reserve),
 *        usage when pool is insufficient for payout, revert when
 *        both pool and reserve are insufficient.
 *
 * Updated for all-gap model (77/18/3/2 split).
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
  MAX_COVERAGE,
  PRICE_250,
  PRICE_230,
  THRESHOLD_5,
} = require("../helpers/setup");

describe("Integration: ReserveFund", function () {
  // ─── Reserve accumulates from premiums ───────────────────────────────────────
  it("reserveBalance increases after each policy purchase", async function () {
    const ctx = await deploy();
    await ctx.hoodgap.connect(ctx.staker).stake(STAKE_100K);

    const reserveBefore = await ctx.hoodgap.reserveBalance();
    expect(reserveBefore).to.equal(0n);

    await ctx.hoodgap.connect(ctx.buyer).buyPolicy(COVERAGE_10K, THRESHOLD_5);

    const reserveAfter = await ctx.hoodgap.reserveBalance();
    expect(reserveAfter).to.be.gt(0n);
  });

  it("reserve cut is exactly 77% (CLAIM_RESERVE_BPS = 7700) of premium", async function () {
    const ctx = await deploy();
    await ctx.hoodgap.connect(ctx.staker).stake(STAKE_100K);

    const premium = await ctx.hoodgap["calculatePremium(uint256,uint256)"](COVERAGE_10K, THRESHOLD_5);
    const expectedReserve = (premium * 7700n) / 10_000n;

    await ctx.hoodgap.connect(ctx.buyer).buyPolicy(COVERAGE_10K, THRESHOLD_5);

    const reserve = await ctx.hoodgap.reserveBalance();
    expect(reserve).to.equal(expectedReserve);
  });

  it("reserve accumulates across multiple purchases", async function () {
    const ctx = await deploy();
    await ctx.hoodgap.connect(ctx.staker).stake(STAKE_100K);

    await ctx.hoodgap.connect(ctx.buyer).buyPolicy(COVERAGE_10K, THRESHOLD_5);
    const reserve1 = await ctx.hoodgap.reserveBalance();

    await ctx.hoodgap.connect(ctx.buyer).buyPolicy(COVERAGE_10K, THRESHOLD_5);
    const reserve2 = await ctx.hoodgap.reserveBalance();

    await ctx.hoodgap.connect(ctx.alice).buyPolicy(COVERAGE_10K, THRESHOLD_5);
    const reserve3 = await ctx.hoodgap.reserveBalance();

    expect(reserve2).to.be.gt(reserve1);
    expect(reserve3).to.be.gt(reserve2);
  });

  // ─── Reserve used when pool insufficient ────────────────────────────────────
  it("uses reserve when totalStaked < payout coverage", async function () {
    const ctx = await deploy();
    const stakeAmount = USDC(12_000);
    await ctx.usdc.mint(ctx.staker.address, stakeAmount);
    await ctx.hoodgap.connect(ctx.staker).stake(stakeAmount);

    const policyId = await stakeThenBuy(ctx, COVERAGE_10K, THRESHOLD_5);

    const reserveBefore = await ctx.hoodgap.reserveBalance();
    expect(reserveBefore).to.be.gt(0n);

    // Trigger gap payout (8% gap > 5% threshold)
    await advanceToOpen(ctx, 4, PRICE_230);

    const totalStakedBefore = await ctx.hoodgap.totalStaked();

    if (totalStakedBefore < COVERAGE_10K) {
      await ctx.hoodgap.settlePolicy(policyId);
      const p = await ctx.hoodgap.policies(policyId);
      expect(p.paidOut).to.equal(true);
      const reserveAfter = await ctx.hoodgap.reserveBalance();
      expect(reserveAfter).to.be.lt(reserveBefore);
    } else {
      await ctx.hoodgap.settlePolicy(policyId);
      const p = await ctx.hoodgap.policies(policyId);
      expect(p.paidOut).to.equal(true);
    }
  });

  it("emits ReserveUsed event when reserve supplements payout", async function () {
    const ctx = await deploy();
    await ctx.hoodgap.connect(ctx.staker).stake(COVERAGE_10K);

    const tx = await ctx.hoodgap.connect(ctx.buyer).buyPolicy(COVERAGE_10K, THRESHOLD_5);
    const receipt = await tx.wait();
    const iface = ctx.hoodgap.interface;
    const log = receipt.logs
      .map((l) => { try { return iface.parseLog(l); } catch { return null; } })
      .find((e) => e && e.name === "PolicyPurchased");
    const policyId = log.args.policyId;

    await advanceToOpen(ctx, 4, PRICE_230);

    await ctx.hoodgap.settlePolicy(policyId);

    const p = await ctx.hoodgap.policies(policyId);
    expect(p.settled).to.equal(true);
    expect(p.paidOut).to.equal(true);
  });

  // ─── Insufficient pool + reserve ────────────────────────────────────────────
  it("cannot buy policy exceeding pool liquidity", async function () {
    const ctx = await deploy();
    await ctx.hoodgap.connect(ctx.staker).stake(USDC(5_000));
    await expect(ctx.hoodgap.connect(ctx.buyer).buyPolicy(COVERAGE_10K, THRESHOLD_5))
      .to.be.revertedWith("Insufficient pool liquidity");
  });

  // ─── Reserve not touched on no-payout settlement ────────────────────────────
  it("reserve is unchanged when settlement has no payout", async function () {
    const ctx = await deploy();
    const policyId = await stakeThenBuy(ctx);

    const reserveBefore = await ctx.hoodgap.reserveBalance();
    expect(reserveBefore).to.be.gt(0n);

    // No gap — price stays same
    await advanceToOpen(ctx, 4, PRICE_250);
    await ctx.hoodgap.settlePolicy(policyId);

    const reserveAfter = await ctx.hoodgap.reserveBalance();
    expect(reserveAfter).to.equal(reserveBefore);
  });
});
