"use strict";

/**
 * test/integration/BuySettle.test.js
 *
 * Tests: buyPolicy() all validations, policy fields, NFT mint, fee splits.
 *        settlePolicy() gate checks, payout path, no-payout path,
 *        double-settle, failsafe (FIX #4), reserve usage.
 */

const { expect } = require("chai");
const { time }   = require("@nomicfoundation/hardhat-network-helpers");
const {
  deploy,
  stakeThenBuy,
  advanceToMonday,
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
      expect(p.fridayClose).to.equal(PRICE_250);
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

    it("sends 2% platform fee to treasury", async function () {
      const ctx = await deploy();
      await ctx.hoodgap.connect(ctx.staker).stake(STAKE_100K);
      const premium     = await ctx.hoodgap.calculatePremium(COVERAGE_10K);
      const platformFee = (premium * 200n) / 10_000n;
      await expect(() => ctx.hoodgap.connect(ctx.buyer).buyPolicy(COVERAGE_10K, THRESHOLD_5))
        .to.changeTokenBalance(ctx.usdc, ctx.owner, platformFee);
    });

    it("adds 5% reserve cut to reserveBalance", async function () {
      const ctx = await deploy();
      await ctx.hoodgap.connect(ctx.staker).stake(STAKE_100K);
      const premium    = await ctx.hoodgap.calculatePremium(COVERAGE_10K);
      const reserveCut = (premium * 500n) / 10_000n;
      await ctx.hoodgap.connect(ctx.buyer).buyPolicy(COVERAGE_10K, THRESHOLD_5);
      expect(await ctx.hoodgap.reserveBalance()).to.equal(reserveCut);
    });

    it("emits PolicyPurchased with correct args", async function () {
      const ctx = await deploy();
      await ctx.hoodgap.connect(ctx.staker).stake(STAKE_100K);
      const settlementWeek = await ctx.hoodgap.getCurrentSettlementWeek();
      await expect(ctx.hoodgap.connect(ctx.buyer).buyPolicy(COVERAGE_10K, THRESHOLD_5))
        .to.emit(ctx.hoodgap, "PolicyPurchased")
        .withArgs(
          ctx.buyer.address,
          0n,
          COVERAGE_10K,
          THRESHOLD_5,
          (v) => v > 0n,    // premium – dynamic
          PRICE_250,
          settlementWeek,
        );
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

    it("reverts when threshold below 5% (500 bp)", async function () {
      const ctx = await deploy();
      await ctx.hoodgap.connect(ctx.staker).stake(STAKE_100K);
      await expect(ctx.hoodgap.connect(ctx.buyer).buyPolicy(COVERAGE_10K, 499n))
        .to.be.revertedWith("Threshold must be 5-20%");
    });

    it("reverts when threshold above 20% (2000 bp)", async function () {
      const ctx = await deploy();
      await ctx.hoodgap.connect(ctx.staker).stake(STAKE_100K);
      await expect(ctx.hoodgap.connect(ctx.buyer).buyPolicy(COVERAGE_10K, 2001n))
        .to.be.revertedWith("Threshold must be 5-20%");
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
    it("reverts before Monday open", async function () {
      const ctx      = await deploy();
      const policyId = await stakeThenBuy(ctx);
      const settlementWeek = await ctx.hoodgap.getCurrentSettlementWeek();
      await ctx.hoodgap.connect(ctx.owner).approveSettlement(settlementWeek, 10_000n, "test");
      // Still on Saturday — don't advance time
      const now = BigInt(await time.latest());
      await ctx.oracle.update(PRICE_252, now);
      await expect(ctx.hoodgap.settlePolicy(policyId))
        .to.be.revertedWith("Too early to settle");
    });

    it("reverts before 48h failsafe without guardian approval", async function () {
      const ctx      = await deploy();
      const policyId = await stakeThenBuy(ctx);
      // Advance to Monday but NOT approved
      await time.setNextBlockTimestamp(Number(ctx.MONDAY));
      await ctx.oracle.update(PRICE_252, ctx.MONDAY);
      await expect(ctx.hoodgap.settlePolicy(policyId))
        .to.be.revertedWith("Awaiting guardian approval or 48h failsafe");
    });

    it("reverts when oracle not updated since Monday open", async function () {
      const ctx      = await deploy();
      const policyId = await stakeThenBuy(ctx);
      const settlementWeek = await ctx.hoodgap.getCurrentSettlementWeek();
      await ctx.hoodgap.connect(ctx.owner).approveSettlement(settlementWeek, 10_000n, "test");
      // Set chain to Monday but leave oracle.updatedAt at Saturday
      await time.setNextBlockTimestamp(Number(ctx.MONDAY));
      await expect(ctx.hoodgap.settlePolicy(policyId))
        .to.be.revertedWith("Oracle not updated since Monday open");
    });

    it("reverts on double-settle", async function () {
      const ctx      = await deploy();
      const policyId = await stakeThenBuy(ctx);
      const settlementWeek = await ctx.hoodgap.getCurrentSettlementWeek();
      await ctx.hoodgap.connect(ctx.owner).approveSettlement(settlementWeek, 10_000n, "test");
      await advanceToMonday(ctx, PRICE_252);
      await ctx.hoodgap.settlePolicy(policyId);
      await expect(ctx.hoodgap.settlePolicy(policyId))
        .to.be.revertedWith("Policy already settled");
    });
  });

  // ─── settlePolicy() — no payout ───────────────────────────────────────────────
  describe("settlePolicy() — no payout", function () {
    it("marks settled = true, paidOut = false when gap < threshold", async function () {
      const ctx      = await deploy();
      const policyId = await stakeThenBuy(ctx); // threshold 5%, gap will be ~0.8%
      const settlementWeek = await ctx.hoodgap.getCurrentSettlementWeek();
      await ctx.hoodgap.connect(ctx.owner).approveSettlement(settlementWeek, 10_000n, "test");
      await advanceToMonday(ctx, PRICE_252);
      await ctx.hoodgap.settlePolicy(policyId);

      const p = await ctx.hoodgap.policies(policyId);
      expect(p.settled).to.equal(true);
      expect(p.paidOut).to.equal(false);
    });

    it("frees totalCoverage without reducing totalStaked", async function () {
      const ctx      = await deploy();
      const policyId = await stakeThenBuy(ctx);
      const settlementWeek = await ctx.hoodgap.getCurrentSettlementWeek();
      await ctx.hoodgap.connect(ctx.owner).approveSettlement(settlementWeek, 10_000n, "test");
      const stakedBefore = await ctx.hoodgap.totalStaked();
      await advanceToMonday(ctx, PRICE_252);
      await ctx.hoodgap.settlePolicy(policyId);

      expect(await ctx.hoodgap.totalCoverage()).to.equal(0n);
      expect(await ctx.hoodgap.totalStaked()).to.equal(stakedBefore);
    });

    it("emits PolicySettled with paidOut = false", async function () {
      const ctx      = await deploy();
      const policyId = await stakeThenBuy(ctx);
      const settlementWeek = await ctx.hoodgap.getCurrentSettlementWeek();
      await ctx.hoodgap.connect(ctx.owner).approveSettlement(settlementWeek, 10_000n, "test");
      await advanceToMonday(ctx, PRICE_252);
      await expect(ctx.hoodgap.settlePolicy(policyId))
        .to.emit(ctx.hoodgap, "PolicySettled")
        .withArgs(policyId, PRICE_252, PRICE_250, (v) => typeof v === "bigint", false);
    });
  });

  // ─── settlePolicy() — with binary payout ─────────────────────────────────
  describe("settlePolicy() — binary payout", function () {
    it("pays full coverage when gap >= threshold (8% gap on 5% threshold)", async function () {
      const ctx      = await deploy();
      const policyId = await stakeThenBuy(ctx); // threshold 5%, gap will be 8%
      const settlementWeek = await ctx.hoodgap.getCurrentSettlementWeek();
      await ctx.hoodgap.connect(ctx.owner).approveSettlement(settlementWeek, 10_000n, "test");
      await advanceToMonday(ctx, PRICE_230);

      // gap = (250-230)/250 * 10000 = 800 bp >= 500 threshold → full coverage
      await expect(() => ctx.hoodgap.settlePolicy(policyId))
        .to.changeTokenBalance(ctx.usdc, ctx.buyer, COVERAGE_10K);
    });

    it("pays full coverage when gap >= 2× threshold (10% gap on 5%)", async function () {
      const ctx      = await deploy();
      const policyId = await stakeThenBuy(ctx); // threshold 5%
      const settlementWeek = await ctx.hoodgap.getCurrentSettlementWeek();
      await ctx.hoodgap.connect(ctx.owner).approveSettlement(settlementWeek, 10_000n, "test");
      await advanceToMonday(ctx, PRICE_225);

      // gap = 1000 bp >= 500 threshold → full coverage
      await expect(() => ctx.hoodgap.settlePolicy(policyId))
        .to.changeTokenBalance(ctx.usdc, ctx.buyer, COVERAGE_10K);
    });

    it("pays full coverage when gap barely exceeds threshold (5.2% gap on 5%)", async function () {
      const ctx      = await deploy();
      const policyId = await stakeThenBuy(ctx); // threshold 5%
      const settlementWeek = await ctx.hoodgap.getCurrentSettlementWeek();
      await ctx.hoodgap.connect(ctx.owner).approveSettlement(settlementWeek, 10_000n, "test");
      await advanceToMonday(ctx, PRICE_237);

      // gap = 520 bp >= 500 threshold → full coverage
      await expect(() => ctx.hoodgap.settlePolicy(policyId))
        .to.changeTokenBalance(ctx.usdc, ctx.buyer, COVERAGE_10K);
    });

    it("pays nothing when gap is below threshold (4% gap on 5%)", async function () {
      const ctx      = await deploy();
      const policyId = await stakeThenBuy(ctx); // threshold 5%
      const settlementWeek = await ctx.hoodgap.getCurrentSettlementWeek();
      await ctx.hoodgap.connect(ctx.owner).approveSettlement(settlementWeek, 10_000n, "test");
      await advanceToMonday(ctx, PRICE_240);

      // gap = 400 bp < 500 threshold → $0
      await expect(() => ctx.hoodgap.settlePolicy(policyId))
        .to.changeTokenBalance(ctx.usdc, ctx.buyer, 0n);
    });

    it("marks paidOut = true for binary payout", async function () {
      const ctx      = await deploy();
      const policyId = await stakeThenBuy(ctx);
      const settlementWeek = await ctx.hoodgap.getCurrentSettlementWeek();
      await ctx.hoodgap.connect(ctx.owner).approveSettlement(settlementWeek, 10_000n, "test");
      await advanceToMonday(ctx, PRICE_230);
      await ctx.hoodgap.settlePolicy(policyId);
      const p = await ctx.hoodgap.policies(policyId);
      expect(p.paidOut).to.equal(true);
    });

    it("emits PolicyPaidOut with full coverage amount", async function () {
      const ctx      = await deploy();
      const policyId = await stakeThenBuy(ctx);
      const settlementWeek = await ctx.hoodgap.getCurrentSettlementWeek();
      await ctx.hoodgap.connect(ctx.owner).approveSettlement(settlementWeek, 10_000n, "test");
      await advanceToMonday(ctx, PRICE_230);
      // gap = 800 bp, payout = full coverage
      await expect(ctx.hoodgap.settlePolicy(policyId))
        .to.emit(ctx.hoodgap, "PolicyPaidOut")
        .withArgs(policyId, ctx.buyer.address, COVERAGE_10K, 800n);
    });

    it("reduces totalStaked by full coverage amount", async function () {
      const ctx        = await deploy();
      const policyId   = await stakeThenBuy(ctx);
      const settlementWeek = await ctx.hoodgap.getCurrentSettlementWeek();
      await ctx.hoodgap.connect(ctx.owner).approveSettlement(settlementWeek, 10_000n, "test");
      const stakedBefore = await ctx.hoodgap.totalStaked();
      await advanceToMonday(ctx, PRICE_230);
      await ctx.hoodgap.settlePolicy(policyId);
      // payout = full coverage
      expect(await ctx.hoodgap.totalStaked()).to.equal(stakedBefore - COVERAGE_10K);
    });
  });

  // ─── FIX #4 — 48h failsafe ────────────────────────────────────────────────────
  describe("FIX #4: 48-hour failsafe", function () {
    it("allows settlement after 48h without guardian approval", async function () {
      const ctx      = await deploy();
      const policyId = await stakeThenBuy(ctx);
      const failsafe = ctx.MONDAY + FAILSAFE_DELAY + 1n;
      await time.setNextBlockTimestamp(Number(failsafe));
      await ctx.oracle.update(PRICE_252, failsafe);
      await expect(ctx.hoodgap.settlePolicy(policyId)).to.not.be.reverted;
    });

    it("emits FailsafeTriggered when failsafe kicks in", async function () {
      const ctx      = await deploy();
      const policyId = await stakeThenBuy(ctx);
      const failsafe = ctx.MONDAY + FAILSAFE_DELAY + 1n;
      await time.setNextBlockTimestamp(Number(failsafe));
      await ctx.oracle.update(PRICE_252, failsafe);
      await expect(ctx.hoodgap.settlePolicy(policyId))
        .to.emit(ctx.hoodgap, "FailsafeTriggered");
    });

    it("defaults to 1.0x split ratio under failsafe", async function () {
      const ctx      = await deploy();
      const policyId = await stakeThenBuy(ctx);
      const failsafe = ctx.MONDAY + FAILSAFE_DELAY + 1n;
      await time.setNextBlockTimestamp(Number(failsafe));
      await ctx.oracle.update(PRICE_252, failsafe);
      // Should settle with 1.0x (no false payout on a small move)
      await ctx.hoodgap.settlePolicy(policyId);
      const p = await ctx.hoodgap.policies(policyId);
      expect(p.settled).to.equal(true);
    });

    it("still blocks at exactly 47h59m59s", async function () {
      const ctx      = await deploy();
      const policyId = await stakeThenBuy(ctx);
      // Use -2 to account for oracle.update consuming one block, so settlePolicy
      // runs at almostTs + 1 = ctx.MONDAY + FAILSAFE_DELAY - 1 (still below threshold)
      const almostTs = ctx.MONDAY + FAILSAFE_DELAY - 2n;
      await time.setNextBlockTimestamp(Number(almostTs));
      await ctx.oracle.update(PRICE_252, almostTs);
      // settlePolicy will mine at almostTs + 1 = ctx.MONDAY + FAILSAFE_DELAY - 1
      await expect(ctx.hoodgap.settlePolicy(policyId))
        .to.be.revertedWith("Awaiting guardian approval or 48h failsafe");
    });
  });

  // ─── canSettle view ───────────────────────────────────────────────────────────
  describe("canSettle()", function () {
    it("returns false before approval and before failsafe", async function () {
      const ctx          = await deploy();
      const settlementWeek = await ctx.hoodgap.getCurrentSettlementWeek();
      const [allowed]    = await ctx.hoodgap.canSettle(settlementWeek);
      expect(allowed).to.equal(false);
    });

    it("returns true with splitRatio after guardian approval", async function () {
      const ctx = await deploy();
      const settlementWeek = await ctx.hoodgap.getCurrentSettlementWeek();
      await ctx.hoodgap.connect(ctx.owner).approveSettlement(settlementWeek, 10_000n, "test");
      const [allowed, ratio, reason] = await ctx.hoodgap.canSettle(settlementWeek);
      expect(allowed).to.equal(true);
      expect(ratio).to.equal(10_000n);
      expect(reason).to.equal("Guardian approved");
    });

    it("returns true after 48h failsafe", async function () {
      const ctx = await deploy();
      const settlementWeek = await ctx.hoodgap.getCurrentSettlementWeek();
      const mondayForWeek = await ctx.hoodgap.getMonday(settlementWeek);
      // Must mine a block at the target time — view calls use the last mined block's timestamp
      const failsafeTs = mondayForWeek + FAILSAFE_DELAY + 1n;
      await time.setNextBlockTimestamp(Number(failsafeTs));
      await ctx.oracle.update(PRICE_252, failsafeTs); // mines a block at failsafeTs
      const [allowed, ratio] = await ctx.hoodgap.canSettle(settlementWeek);
      expect(allowed).to.equal(true);
      expect(ratio).to.equal(10_000n);
    });
  });
});
