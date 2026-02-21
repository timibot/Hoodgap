"use strict";

/**
 * test/integration/AllGapLifecycle.test.js
 *
 * Core integration test for the all-gap insurance model.
 * Tests: buying policies, subscriptions (5 NFTs/week),
 * settlement (daily gaps), and premium allocation.
 */

const { expect }         = require("chai");
const { ethers }         = require("hardhat");
const { time }           = require("@nomicfoundation/hardhat-network-helpers");
const {
  deploy, USDC, STAKE_100K, COVERAGE_500, COVERAGE_10K,
  PRICE_250, PRICE_237, PRICE_240, PRICE_230,
  THRESHOLD_5, THRESHOLD_10,
  getMarketClose, getNextMarketOpen,
} = require("../helpers/setup");

describe("All-Gap Lifecycle", function () {
  let ctx;

  beforeEach(async function () {
    ctx = await deploy();
    // Stake so pool has liquidity
    await ctx.hoodgap.connect(ctx.staker).stake(STAKE_100K);
  });

  // ─── TIER PRICING ────────────────────────────────────────────────
  describe("Tier-based Pricing", function () {
    it("calculates correct -5% tier premium", async function () {
      // $500 coverage × 10.8% base rate = $54 (before multipliers)
      const premium = await ctx.hoodgap["calculatePremium(uint256,uint256)"](COVERAGE_500, THRESHOLD_5);
      // With low utilization, should be close to base rate
      // Base = 500e6 × 1080 / 10000 = 54e6
      expect(premium).to.be.gte(USDC(50));  // at least $50
      expect(premium).to.be.lte(USDC(60));  // at most $60
    });

    it("calculates correct -10% tier premium", async function () {
      // $500 coverage × 0.6% base rate = $3 (before multipliers)
      const premium = await ctx.hoodgap["calculatePremium(uint256,uint256)"](COVERAGE_500, THRESHOLD_10);
      expect(premium).to.be.gte(USDC(2));
      expect(premium).to.be.lte(USDC(5));
    });

    it("rejects invalid threshold", async function () {
      await expect(
        ctx.hoodgap["calculatePremium(uint256,uint256)"](COVERAGE_500, 700n)
      ).to.be.revertedWith("Invalid threshold tier");
    });
  });

  // ─── SINGLE GAP PURCHASE ─────────────────────────────────────────
  describe("Single Gap Policy (buyPolicy 2-arg)", function () {
    it("buys a single-gap policy", async function () {
      const tx = await ctx.hoodgap.connect(ctx.buyer).buyPolicy(COVERAGE_10K, THRESHOLD_5);
      const receipt = await tx.wait();

      const log = receipt.logs
        .map((l) => { try { return ctx.hoodgap.interface.parseLog(l); } catch { return null; } })
        .find((e) => e && e.name === "PolicyPurchased");

      expect(log).to.not.be.null;
      expect(log.args.coverage).to.equal(COVERAGE_10K);
      expect(log.args.threshold).to.equal(THRESHOLD_5);
    });
  });

  // ─── SUBSCRIPTION (5 NFTs/WEEK) ──────────────────────────────────
  describe("Subscription — 1 week (5 NFTs)", function () {
    it("creates subscription and mints first gap NFT", async function () {
      const tx = await ctx.hoodgap.connect(ctx.buyer).buySubscription(
        COVERAGE_500, THRESHOLD_5, 1n
      );
      const receipt = await tx.wait();

      // Should emit SubscriptionCreated
      const subLog = receipt.logs
        .map((l) => { try { return ctx.hoodgap.interface.parseLog(l); } catch { return null; } })
        .find((e) => e && e.name === "SubscriptionCreated");
      expect(subLog).to.not.be.null;

      // Should also emit GapPolicyMinted (first gap)
      const gapLog = receipt.logs
        .map((l) => { try { return ctx.hoodgap.interface.parseLog(l); } catch { return null; } })
        .find((e) => e && e.name === "GapPolicyMinted");
      expect(gapLog).to.not.be.null;

      // Check subscription state
      const sub = await ctx.hoodgap.getSubscription(0n);
      expect(sub.gapsMinted).to.equal(1n);
      expect(sub.totalWeeks).to.equal(1n);
    });

    it("progressively mints remaining 4 gap NFTs", async function () {
      await ctx.hoodgap.connect(ctx.buyer).buySubscription(
        COVERAGE_500, THRESHOLD_5, 1n
      );

      // Advance to Tuesday close
      const tueClose = getMarketClose(ctx.WEEK, 1n);
      await time.setNextBlockTimestamp(Number(tueClose));
      await ctx.oracle.update(PRICE_250, tueClose);
      await ctx.hoodgap.mintGapPolicy(0n);

      // Advance to Wednesday close
      const wedClose = getMarketClose(ctx.WEEK, 2n);
      await time.setNextBlockTimestamp(Number(wedClose));
      await ctx.oracle.update(PRICE_250, wedClose);
      await ctx.hoodgap.mintGapPolicy(0n);

      // Advance to Thursday close
      const thuClose = getMarketClose(ctx.WEEK, 3n);
      await time.setNextBlockTimestamp(Number(thuClose));
      await ctx.oracle.update(PRICE_250, thuClose);
      await ctx.hoodgap.mintGapPolicy(0n);

      // Advance to Friday close
      const friClose = getMarketClose(ctx.WEEK, 4n);
      await time.setNextBlockTimestamp(Number(friClose));
      await ctx.oracle.update(PRICE_250, friClose);
      await ctx.hoodgap.mintGapPolicy(0n);

      // All 5 minted
      const sub = await ctx.hoodgap.getSubscription(0n);
      expect(sub.gapsMinted).to.equal(5n);

      // Should revert on 6th mint
      await expect(ctx.hoodgap.mintGapPolicy(0n)).to.be.revertedWith("All gaps already minted");
    });
  });

  // ─── SUBSCRIPTION DISCOUNTS ───────────────────────────────────────
  describe("Multi-week Discounts", function () {
    it("applies 4% discount on 4-week plan", async function () {
      const weeklyPremium = await ctx.hoodgap["calculatePremium(uint256,uint256)"](COVERAGE_500, THRESHOLD_5);

      // Need to advance past enough market closes for the subscription
      const balBefore = await ctx.usdc.balanceOf(ctx.buyer.address);
      await ctx.hoodgap.connect(ctx.buyer).buySubscription(
        COVERAGE_500, THRESHOLD_5, 4n
      );
      const balAfter = await ctx.usdc.balanceOf(ctx.buyer.address);
      const spent = balBefore - balAfter;

      // Expected: weeklyPremium × 0.96 × 4
      const discounted = weeklyPremium - (weeklyPremium * 400n) / 10000n;
      const expected = discounted * 4n;
      expect(spent).to.equal(expected);
    });

    it("applies 10% discount on 8-week plan", async function () {
      const weeklyPremium = await ctx.hoodgap["calculatePremium(uint256,uint256)"](COVERAGE_500, THRESHOLD_5);

      const balBefore = await ctx.usdc.balanceOf(ctx.buyer.address);
      await ctx.hoodgap.connect(ctx.buyer).buySubscription(
        COVERAGE_500, THRESHOLD_5, 8n
      );
      const balAfter = await ctx.usdc.balanceOf(ctx.buyer.address);
      const spent = balBefore - balAfter;

      const discounted = weeklyPremium - (weeklyPremium * 1000n) / 10000n;
      const expected = discounted * 8n;
      expect(spent).to.equal(expected);
    });
  });

  // ─── PREMIUM ALLOCATION ──────────────────────────────────────────
  describe("Premium Allocation (77/18/3/2)", function () {
    it("allocates premium correctly", async function () {
      const treasuryBefore = await ctx.usdc.balanceOf(ctx.owner.address);
      const reserveBefore = await ctx.hoodgap.reserveBalance();
      const bsBefore = await ctx.hoodgap.blackSwanReserve();

      await ctx.hoodgap.connect(ctx.buyer).buyPolicy(COVERAGE_10K, THRESHOLD_5);

      const treasuryAfter = await ctx.usdc.balanceOf(ctx.owner.address);
      const reserveAfter = await ctx.hoodgap.reserveBalance();
      const bsAfter = await ctx.hoodgap.blackSwanReserve();

      const protocolFee = treasuryAfter - treasuryBefore;
      const reserveAdded = reserveAfter - reserveBefore;
      const bsAdded = bsAfter - bsBefore;

      // All should be > 0
      expect(protocolFee).to.be.gt(0n);
      expect(reserveAdded).to.be.gt(0n);
      expect(bsAdded).to.be.gt(0n);
    });
  });

  // ─── SETTLEMENT ──────────────────────────────────────────────────
  describe("Daily Gap Settlement", function () {
    it("pays out when gap >= threshold (-5%)", async function () {
      // Buy a policy on Monday gap (day 0)
      const tx = await ctx.hoodgap.connect(ctx.buyer).buyPolicy(COVERAGE_10K, THRESHOLD_5);
      const receipt = await tx.wait();
      const log = receipt.logs
        .map((l) => { try { return ctx.hoodgap.interface.parseLog(l); } catch { return null; } })
        .find((e) => e && e.name === "PolicyPurchased");
      const policyId = log.args.policyId;

      // Advance to Tuesday open (next market open after Monday close)
      const tueOpen = getNextMarketOpen(ctx.WEEK, 4n); // using day=4 since legacy buyPolicy sets day=4
      await time.setNextBlockTimestamp(Number(tueOpen));
      // 8% gap down: 250 → 230
      await ctx.oracle.update(PRICE_230, tueOpen);

      // Approve settlement for the relevant week
      const policyData = await ctx.hoodgap.policies(policyId);

      const buyerBalBefore = await ctx.usdc.balanceOf(ctx.buyer.address);
      await ctx.hoodgap.settlePolicy(policyId);
      const buyerBalAfter = await ctx.usdc.balanceOf(ctx.buyer.address);

      // Should have received full coverage ($10,000)
      expect(buyerBalAfter - buyerBalBefore).to.equal(COVERAGE_10K);
    });

    it("does NOT pay out when gap < threshold", async function () {
      const tx = await ctx.hoodgap.connect(ctx.buyer).buyPolicy(COVERAGE_10K, THRESHOLD_5);
      const receipt = await tx.wait();
      const log = receipt.logs
        .map((l) => { try { return ctx.hoodgap.interface.parseLog(l); } catch { return null; } })
        .find((e) => e && e.name === "PolicyPurchased");
      const policyId = log.args.policyId;

      // Advance to next Monday (day=4 → Friday→Monday)
      const nextOpen = getNextMarketOpen(ctx.WEEK, 4n);
      await time.setNextBlockTimestamp(Number(nextOpen));
      // 4% gap: 250 → 240 (below 5% threshold)
      await ctx.oracle.update(PRICE_240, nextOpen);

      const buyerBalBefore = await ctx.usdc.balanceOf(ctx.buyer.address);
      await ctx.hoodgap.settlePolicy(policyId);
      const buyerBalAfter = await ctx.usdc.balanceOf(ctx.buyer.address);

      // No payout
      expect(buyerBalAfter - buyerBalBefore).to.equal(0n);
    });
  });
});
