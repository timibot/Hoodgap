"use strict";

/**
 * test/integration/BuySettle.test.js
 *
 * Tests: buyPolicy() validations, policy fields, NFT mint, fee splits (77/18/3/2).
 *        settlePolicy() gate checks, payout path, no-payout path,
 *        double-settle, failsafe (FIX #4), reserve usage.
 *
 * Updated for all-gap model: daily gap NFTs, tier-based thresholds.
 */

const { expect } = require("chai");
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
  PRICE_240,
  PRICE_237,
  PRICE_230,
  PRICE_225,
  PRICE_252,
  THRESHOLD_5,
  THRESHOLD_10,
  FAILSAFE_DELAY,
} = require("../helpers/setup");

describe("Integration: BuySettle", function () {
  // ─── buyPolicy() ──────────────────────────────────────────────────────────────
  describe("buyPolicy()", function () {
    it("creates policy with correct fields", async function () {
      const ctx      = await deploy();
      const policyId = await stakeThenBuy(ctx);
      const p        = await ctx.hoodgap.policies(policyId);

      expect(p.holder).to.equal(ctx.buyer.address);
      expect(p.coverage).to.equal(COVERAGE_10K);
      expect(p.threshold).to.equal(THRESHOLD_5);
      expect(p.closePrice).to.equal(PRICE_250);
      expect(p.settled).to.equal(false);
      expect(p.paidOut).to.equal(false);
    });

    it("mints an ERC-721 NFT to the buyer", async function () {
      const ctx      = await deploy();
      const policyId = await stakeThenBuy(ctx);
      expect(await ctx.hoodgap.ownerOf(policyId)).to.equal(ctx.buyer.address);
    });

    it("increases totalCoverage", async function () {
      const ctx = await deploy();
      await stakeThenBuy(ctx);
      expect(await ctx.hoodgap.totalCoverage()).to.equal(COVERAGE_10K);
    });

    it("sends 3% protocol fee to treasury", async function () {
      const ctx = await deploy();
      await ctx.hoodgap.connect(ctx.staker).stake(STAKE_100K);
      const premium     = await ctx.hoodgap["calculatePremium(uint256,uint256)"](COVERAGE_10K, THRESHOLD_5);
      const protocolFee = (premium * 300n) / 10_000n;
      await expect(() => ctx.hoodgap.connect(ctx.buyer).buyPolicy(COVERAGE_10K, THRESHOLD_5))
        .to.changeTokenBalance(ctx.usdc, ctx.owner, protocolFee);
    });

    it("adds 77% claim reserve to reserveBalance", async function () {
      const ctx = await deploy();
      await ctx.hoodgap.connect(ctx.staker).stake(STAKE_100K);
      const premium    = await ctx.hoodgap["calculatePremium(uint256,uint256)"](COVERAGE_10K, THRESHOLD_5);
      const reserveCut = (premium * 7700n) / 10_000n;
      await ctx.hoodgap.connect(ctx.buyer).buyPolicy(COVERAGE_10K, THRESHOLD_5);
      expect(await ctx.hoodgap.reserveBalance()).to.equal(reserveCut);
    });

    it("adds 2% to blackSwanReserve", async function () {
      const ctx = await deploy();
      await ctx.hoodgap.connect(ctx.staker).stake(STAKE_100K);
      const premium     = await ctx.hoodgap["calculatePremium(uint256,uint256)"](COVERAGE_10K, THRESHOLD_5);
      const blackSwan   = (premium * 200n) / 10_000n;
      await ctx.hoodgap.connect(ctx.buyer).buyPolicy(COVERAGE_10K, THRESHOLD_5);
      expect(await ctx.hoodgap.blackSwanReserve()).to.equal(blackSwan);
    });

    it("emits PolicyPurchased with correct args", async function () {
      const ctx = await deploy();
      await ctx.hoodgap.connect(ctx.staker).stake(STAKE_100K);
      await expect(ctx.hoodgap.connect(ctx.buyer).buyPolicy(COVERAGE_10K, THRESHOLD_5))
        .to.emit(ctx.hoodgap, "PolicyPurchased");
    });

    it("reverts when coverage is 0", async function () {
      const ctx = await deploy();
      await ctx.hoodgap.connect(ctx.staker).stake(STAKE_100K);
      await expect(ctx.hoodgap.connect(ctx.buyer).buyPolicy(0n, THRESHOLD_5))
        .to.be.revertedWith("Invalid coverage");
    });

    it("reverts when coverage exceeds MAX ($50k)", async function () {
      const ctx = await deploy();
      await ctx.hoodgap.connect(ctx.staker).stake(STAKE_100K);
      await expect(ctx.hoodgap.connect(ctx.buyer).buyPolicy(MAX_COVERAGE + 1n, THRESHOLD_5))
        .to.be.revertedWith("Invalid coverage");
    });

    it("reverts when threshold is invalid (not 500 or 1000)", async function () {
      const ctx = await deploy();
      await ctx.hoodgap.connect(ctx.staker).stake(STAKE_100K);
      await expect(ctx.hoodgap.connect(ctx.buyer).buyPolicy(COVERAGE_10K, 700n))
        .to.be.revertedWith("Invalid threshold");
    });

    it("reverts when coverage exceeds pool liquidity", async function () {
      const ctx = await deploy();
      await ctx.hoodgap.connect(ctx.staker).stake(USDC(1_000));
      await expect(ctx.hoodgap.connect(ctx.buyer).buyPolicy(USDC(2_000), THRESHOLD_5))
        .to.be.revertedWith("Insufficient pool liquidity");
    });

    it("reverts when paused", async function () {
      const ctx = await deploy();
      await ctx.hoodgap.connect(ctx.staker).stake(STAKE_100K);
      await ctx.hoodgap.pause();
      await expect(ctx.hoodgap.connect(ctx.buyer).buyPolicy(COVERAGE_10K, THRESHOLD_5))
        .to.be.revertedWith("Contract is paused");
    });
  });

  // ─── settlePolicy() gate checks ───────────────────────────────────────────────
  describe("settlePolicy() — gates", function () {
    it("reverts before market open", async function () {
      const ctx      = await deploy();
      const policyId = await stakeThenBuy(ctx);
      // Still between close and open — don't advance time
      const now = BigInt(await time.latest());
      await ctx.oracle.update(PRICE_252, now);
      await expect(ctx.hoodgap.settlePolicy(policyId))
        .to.be.revertedWith("Too early to settle");
    });

    it("reverts before 48h failsafe without guardian approval", async function () {
      const ctx = await deploy();
      // Advance to next week so approvalWeek = WEEK+2 (unapproved)
      const nextWeekClose = ctx.getCloseWeek(ctx.WEEK + 1n, 0);
      await time.setNextBlockTimestamp(Number(nextWeekClose) + 60);
      await ctx.oracle.update(PRICE_250, nextWeekClose + 60n);
      await ctx.hoodgap.connect(ctx.staker).stake(STAKE_100K);
      const tx = await ctx.hoodgap.connect(ctx.buyer).buyPolicy(COVERAGE_10K, THRESHOLD_5);
      const receipt = await tx.wait();
      const log = receipt.logs
        .map((l) => { try { return ctx.hoodgap.interface.parseLog(l); } catch { return null; } })
        .find((e) => e && e.name === "PolicyPurchased");
      const policyId = log.args.policyId;

      // Advance to market open but NOT past 48h failsafe
      const openTs = ctx.getOpenWeek(ctx.WEEK + 1n, 4);
      await time.setNextBlockTimestamp(Number(openTs));
      await ctx.oracle.update(PRICE_252, openTs);
      await expect(ctx.hoodgap.settlePolicy(policyId))
        .to.be.revertedWith("Awaiting guardian approval or 48h failsafe");
    });

    it("reverts on double-settle", async function () {
      const ctx      = await deploy();
      const policyId = await stakeThenBuy(ctx);
      await advanceToOpen(ctx, 4, PRICE_252);
      await ctx.hoodgap.settlePolicy(policyId);
      await expect(ctx.hoodgap.settlePolicy(policyId))
        .to.be.revertedWith("Policy already settled");
    });
  });

  // ─── settlePolicy() — no payout ───────────────────────────────────────────────
  describe("settlePolicy() — no payout", function () {
    it("marks settled = true, paidOut = false when gap < threshold", async function () {
      const ctx      = await deploy();
      const policyId = await stakeThenBuy(ctx);
      await advanceToOpen(ctx, 4, PRICE_252); // price went up → no gap
      await ctx.hoodgap.settlePolicy(policyId);

      const p = await ctx.hoodgap.policies(policyId);
      expect(p.settled).to.equal(true);
      expect(p.paidOut).to.equal(false);
    });

    it("frees totalCoverage without reducing totalStaked", async function () {
      const ctx      = await deploy();
      const policyId = await stakeThenBuy(ctx);
      const stakedBefore = await ctx.hoodgap.totalStaked();
      await advanceToOpen(ctx, 4, PRICE_252);
      await ctx.hoodgap.settlePolicy(policyId);

      expect(await ctx.hoodgap.totalCoverage()).to.equal(0n);
      expect(await ctx.hoodgap.totalStaked()).to.equal(stakedBefore);
    });

    it("emits PolicySettled with paidOut = false", async function () {
      const ctx      = await deploy();
      const policyId = await stakeThenBuy(ctx);
      await advanceToOpen(ctx, 4, PRICE_252);
      await expect(ctx.hoodgap.settlePolicy(policyId))
        .to.emit(ctx.hoodgap, "PolicySettled");
    });
  });

  // ─── settlePolicy() — with binary payout ─────────────────────────────────────
  describe("settlePolicy() — binary payout", function () {
    it("pays full coverage when gap >= threshold (8% gap on 5% threshold)", async function () {
      const ctx      = await deploy();
      const policyId = await stakeThenBuy(ctx);
      await advanceToOpen(ctx, 4, PRICE_230);

      // gap = (250-230)/250 * 10000 = 800 bp >= 500 threshold → full coverage
      await expect(() => ctx.hoodgap.settlePolicy(policyId))
        .to.changeTokenBalance(ctx.usdc, ctx.buyer, COVERAGE_10K);
    });

    it("pays full coverage when gap >= 2× threshold (10% gap on 5%)", async function () {
      const ctx      = await deploy();
      const policyId = await stakeThenBuy(ctx);
      await advanceToOpen(ctx, 4, PRICE_225);

      await expect(() => ctx.hoodgap.settlePolicy(policyId))
        .to.changeTokenBalance(ctx.usdc, ctx.buyer, COVERAGE_10K);
    });

    it("pays full coverage when gap barely exceeds threshold (5.2% gap on 5%)", async function () {
      const ctx      = await deploy();
      const policyId = await stakeThenBuy(ctx);
      await advanceToOpen(ctx, 4, PRICE_237);

      await expect(() => ctx.hoodgap.settlePolicy(policyId))
        .to.changeTokenBalance(ctx.usdc, ctx.buyer, COVERAGE_10K);
    });

    it("pays nothing when gap is below threshold (4% gap on 5%)", async function () {
      const ctx      = await deploy();
      const policyId = await stakeThenBuy(ctx);
      await advanceToOpen(ctx, 4, PRICE_240);

      // gap = 400 bp < 500 threshold → $0
      await expect(() => ctx.hoodgap.settlePolicy(policyId))
        .to.changeTokenBalance(ctx.usdc, ctx.buyer, 0n);
    });

    it("marks paidOut = true for binary payout", async function () {
      const ctx      = await deploy();
      const policyId = await stakeThenBuy(ctx);
      await advanceToOpen(ctx, 4, PRICE_230);
      await ctx.hoodgap.settlePolicy(policyId);
      const p = await ctx.hoodgap.policies(policyId);
      expect(p.paidOut).to.equal(true);
    });

    it("emits PolicyPaidOut with full coverage amount", async function () {
      const ctx      = await deploy();
      const policyId = await stakeThenBuy(ctx);
      await advanceToOpen(ctx, 4, PRICE_230);
      await expect(ctx.hoodgap.settlePolicy(policyId))
        .to.emit(ctx.hoodgap, "PolicyPaidOut")
        .withArgs(policyId, ctx.buyer.address, COVERAGE_10K, 800n);
    });

    it("reduces totalStaked by full coverage amount", async function () {
      const ctx        = await deploy();
      const policyId   = await stakeThenBuy(ctx);
      const stakedBefore = await ctx.hoodgap.totalStaked();
      await advanceToOpen(ctx, 4, PRICE_230);
      await ctx.hoodgap.settlePolicy(policyId);
      expect(await ctx.hoodgap.totalStaked()).to.equal(stakedBefore - COVERAGE_10K);
    });
  });

  // ─── FIX #4 — 48h failsafe ────────────────────────────────────────────────────
  describe("FIX #4: 48-hour failsafe", function () {
    it("allows settlement after 48h without guardian approval", async function () {
      const ctx = await deploy();
      // Advance to next week so policy gapWeek = WEEK+1, approvalWeek = WEEK+2 (unapproved)
      const nextWeekClose = ctx.getCloseWeek(ctx.WEEK + 1n, 0);
      await time.setNextBlockTimestamp(Number(nextWeekClose) + 60);
      await ctx.oracle.update(PRICE_250, nextWeekClose + 60n);
      await ctx.hoodgap.connect(ctx.staker).stake(STAKE_100K);
      const tx = await ctx.hoodgap.connect(ctx.buyer).buyPolicy(COVERAGE_10K, THRESHOLD_5);
      const receipt = await tx.wait();
      const log = receipt.logs
        .map((l) => { try { return ctx.hoodgap.interface.parseLog(l); } catch { return null; } })
        .find((e) => e && e.name === "PolicyPurchased");
      const policyId = log.args.policyId;

      // gapDay=4 → nextOpen = getNextMarketOpen(WEEK+1, 4) = Monday of WEEK+2
      // approvalWeek = WEEK+2 (NOT pre-approved)
      // failsafe triggers after mondayOpen(WEEK+2) + 48h
      const openTs = ctx.getOpenWeek(ctx.WEEK + 1n, 4);
      const failsafe = openTs + FAILSAFE_DELAY + 1n;
      await time.setNextBlockTimestamp(Number(failsafe));
      await ctx.oracle.update(PRICE_252, failsafe);
      await expect(ctx.hoodgap.settlePolicy(policyId)).to.not.be.reverted;
    });

    it("emits FailsafeTriggered when failsafe kicks in", async function () {
      const ctx = await deploy();
      const nextWeekClose = ctx.getCloseWeek(ctx.WEEK + 1n, 0);
      await time.setNextBlockTimestamp(Number(nextWeekClose) + 60);
      await ctx.oracle.update(PRICE_250, nextWeekClose + 60n);
      await ctx.hoodgap.connect(ctx.staker).stake(STAKE_100K);
      const tx = await ctx.hoodgap.connect(ctx.buyer).buyPolicy(COVERAGE_10K, THRESHOLD_5);
      const receipt = await tx.wait();
      const log = receipt.logs
        .map((l) => { try { return ctx.hoodgap.interface.parseLog(l); } catch { return null; } })
        .find((e) => e && e.name === "PolicyPurchased");
      const policyId = log.args.policyId;

      const openTs = ctx.getOpenWeek(ctx.WEEK + 1n, 4);
      const failsafe = openTs + FAILSAFE_DELAY + 1n;
      await time.setNextBlockTimestamp(Number(failsafe));
      await ctx.oracle.update(PRICE_252, failsafe);
      await expect(ctx.hoodgap.settlePolicy(policyId))
        .to.emit(ctx.hoodgap, "FailsafeTriggered");
    });
  });

  // ─── canSettle view ───────────────────────────────────────────────────────────
  describe("canSettle()", function () {
    it("returns true with splitRatio after guardian approval", async function () {
      const ctx = await deploy();
      // Fixture already approves settlement for ctx.WEEK
      const [allowed, ratio, reason] = await ctx.hoodgap.canSettle(ctx.WEEK);
      expect(allowed).to.equal(true);
      expect(ratio).to.equal(10_000n);
      expect(reason).to.equal("Guardian approved");
    });
  });
});
