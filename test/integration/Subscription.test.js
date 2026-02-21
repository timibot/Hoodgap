"use strict";

/**
 * test/integration/Subscription.test.js
 *
 * Tests: buySubscription(), mintGapPolicy(), subscription lifecycle.
 * Updated for all-gap model: 5 gap NFTs per week, mintGapPolicy replaces
 * mintWeekPolicy, gapsMinted replaces weeksMinted, 4%/10% discounts.
 */

const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");
const {
  deploy, advanceToOpen,
  STAKE_100K, COVERAGE_10K, MAX_COVERAGE, BUYER_WALLET,
  PRICE_250, PRICE_230, PRICE_240,
  THRESHOLD_5, THRESHOLD_10,
  USDC, WEEK_SECONDS,
  getMarketClose,
} = require("../helpers/setup");

describe("Integration: Subscription", function () {

  // ─── buySubscription() — 4-week plan ─────────────────────────────────────
  describe("buySubscription() — 4-week plan", function () {

    it("creates subscription and mints first gap NFT immediately", async function () {
      const ctx = await deploy();
      await ctx.hoodgap.connect(ctx.staker).stake(STAKE_100K);

      const tx = await ctx.hoodgap.connect(ctx.buyer).buySubscription(COVERAGE_10K, THRESHOLD_5, 4);
      const receipt = await tx.wait();

      // Check SubscriptionCreated event
      const subEvent = receipt.logs
        .map(l => { try { return ctx.hoodgap.interface.parseLog(l); } catch { return null; } })
        .find(e => e && e.name === "SubscriptionCreated");
      expect(subEvent).to.not.be.null;
      expect(subEvent.args.numWeeks).to.equal(4n);

      // Check GapPolicyMinted event (first gap)
      const mintEvent = receipt.logs
        .map(l => { try { return ctx.hoodgap.interface.parseLog(l); } catch { return null; } })
        .find(e => e && e.name === "GapPolicyMinted");
      expect(mintEvent).to.not.be.null;

      // Subscription record
      const sub = await ctx.hoodgap.getSubscription(0);
      expect(sub.owner).to.equal(ctx.buyer.address);
      expect(sub.totalWeeks).to.equal(4n);
      expect(sub.gapsMinted).to.equal(1n);
      expect(sub.coverage).to.equal(COVERAGE_10K);
    });

    it("applies 4% discount correctly for 4-week plan", async function () {
      const ctx = await deploy();
      await ctx.hoodgap.connect(ctx.staker).stake(STAKE_100K);

      const weeklyPremium = await ctx.hoodgap["calculatePremium(uint256,uint256)"](COVERAGE_10K, THRESHOLD_5);
      const expectedDiscounted = weeklyPremium - (weeklyPremium * 400n) / 10000n;
      const expectedTotal = expectedDiscounted * 4n;

      const buyerBefore = await ctx.usdc.balanceOf(ctx.buyer.address);
      await ctx.hoodgap.connect(ctx.buyer).buySubscription(COVERAGE_10K, THRESHOLD_5, 4);
      const buyerAfter = await ctx.usdc.balanceOf(ctx.buyer.address);

      expect(buyerBefore - buyerAfter).to.equal(expectedTotal);
    });

    it("reverts if pool lacks liquidity", async function () {
      const ctx = await deploy();
      await ctx.hoodgap.connect(ctx.staker).stake(USDC(1_000)); // small pool
      await expect(
        ctx.hoodgap.connect(ctx.buyer).buySubscription(COVERAGE_10K, THRESHOLD_5, 4)
      ).to.be.revertedWith("Insufficient pool liquidity");
    });

    it("reverts for invalid weeks (not 1, 4, or 8)", async function () {
      const ctx = await deploy();
      await ctx.hoodgap.connect(ctx.staker).stake(STAKE_100K);

      await expect(
        ctx.hoodgap.connect(ctx.buyer).buySubscription(COVERAGE_10K, THRESHOLD_5, 3)
      ).to.be.revertedWith("Must be 1, 4, or 8 weeks");

      await expect(
        ctx.hoodgap.connect(ctx.buyer).buySubscription(COVERAGE_10K, THRESHOLD_5, 12)
      ).to.be.revertedWith("Must be 1, 4, or 8 weeks");
    });
  });

  // ─── buySubscription() — 8-week plan ──────────────────────────────────────
  describe("buySubscription() — 8-week plan", function () {

    it("creates 8-week subscription with 10% discount", async function () {
      const ctx = await deploy();
      await ctx.hoodgap.connect(ctx.staker).stake(STAKE_100K);

      const weeklyPremium = await ctx.hoodgap["calculatePremium(uint256,uint256)"](COVERAGE_10K, THRESHOLD_5);
      const expectedDiscounted = weeklyPremium - (weeklyPremium * 1000n) / 10000n;
      const expectedTotal = expectedDiscounted * 8n;

      const buyerBefore = await ctx.usdc.balanceOf(ctx.buyer.address);
      await ctx.hoodgap.connect(ctx.buyer).buySubscription(COVERAGE_10K, THRESHOLD_5, 8);
      const buyerAfter = await ctx.usdc.balanceOf(ctx.buyer.address);

      expect(buyerBefore - buyerAfter).to.equal(expectedTotal);

      const sub = await ctx.hoodgap.getSubscription(0);
      expect(sub.totalWeeks).to.equal(8n);
      expect(sub.gapsMinted).to.equal(1n);
    });
  });

  // ─── buySubscription() — 1-week plan (no discount) ────────────────────────
  describe("buySubscription() — 1-week plan", function () {

    it("creates 1-week subscription with no discount", async function () {
      const ctx = await deploy();
      await ctx.hoodgap.connect(ctx.staker).stake(STAKE_100K);

      const weeklyPremium = await ctx.hoodgap["calculatePremium(uint256,uint256)"](COVERAGE_10K, THRESHOLD_5);
      const expectedTotal = weeklyPremium; // no discount

      const buyerBefore = await ctx.usdc.balanceOf(ctx.buyer.address);
      await ctx.hoodgap.connect(ctx.buyer).buySubscription(COVERAGE_10K, THRESHOLD_5, 1);
      const buyerAfter = await ctx.usdc.balanceOf(ctx.buyer.address);

      expect(buyerBefore - buyerAfter).to.equal(expectedTotal);

      const sub = await ctx.hoodgap.getSubscription(0);
      expect(sub.totalWeeks).to.equal(1n);
      expect(sub.gapsMinted).to.equal(1n);
    });
  });

  // ─── mintGapPolicy() ────────────────────────────────────────────────────────
  describe("mintGapPolicy()", function () {

    it("mints second gap NFT after Tuesday market close", async function () {
      const ctx = await deploy();
      await ctx.hoodgap.connect(ctx.staker).stake(STAKE_100K);
      await ctx.hoodgap.connect(ctx.buyer).buySubscription(COVERAGE_10K, THRESHOLD_5, 1);

      // Advance to after Tuesday close (day 1)
      const tuesdayClose = ctx.getClose(1);
      await time.setNextBlockTimestamp(Number(tuesdayClose) + 60);
      await ctx.oracle.update(PRICE_250, tuesdayClose + 60n);

      const tx = await ctx.hoodgap.mintGapPolicy(0);
      const receipt = await tx.wait();

      const mintEvent = receipt.logs
        .map(l => { try { return ctx.hoodgap.interface.parseLog(l); } catch { return null; } })
        .find(e => e && e.name === "GapPolicyMinted");
      expect(mintEvent).to.not.be.null;

      const sub = await ctx.hoodgap.getSubscription(0);
      expect(sub.gapsMinted).to.equal(2n);
    });

    it("reverts if called before market close for next gap", async function () {
      const ctx = await deploy();
      await ctx.hoodgap.connect(ctx.staker).stake(STAKE_100K);
      await ctx.hoodgap.connect(ctx.buyer).buySubscription(COVERAGE_10K, THRESHOLD_5, 1);

      // Already minted day 0 — trying to mint day 1 before Tuesday close
      await expect(ctx.hoodgap.mintGapPolicy(0)).to.be.revertedWith("Market not closed yet for this gap");
    });

    it("reverts when all gaps are minted", async function () {
      const ctx = await deploy();
      await ctx.hoodgap.connect(ctx.staker).stake(STAKE_100K);
      await ctx.hoodgap.connect(ctx.buyer).buySubscription(COVERAGE_10K, THRESHOLD_5, 1);

      // Mint remaining 4 gaps (days 1-4)
      for (let day = 1; day < 5; day++) {
        const closeTs = ctx.getClose(day);
        await time.setNextBlockTimestamp(Number(closeTs) + 60);
        await ctx.oracle.update(PRICE_250, closeTs + 60n);
        await ctx.hoodgap.mintGapPolicy(0);
      }

      const sub = await ctx.hoodgap.getSubscription(0);
      expect(sub.gapsMinted).to.equal(5n); // 1 week × 5 gaps

      // Try minting 6th
      const nextClose = ctx.getCloseWeek(ctx.WEEK + 1n, 0);
      await time.setNextBlockTimestamp(Number(nextClose) + 60);
      await ctx.oracle.update(PRICE_250, nextClose + 60n);
      await expect(ctx.hoodgap.mintGapPolicy(0)).to.be.revertedWith("All gaps already minted");
    });

    it("each gap policy settles independently with binary payout", async function () {
      const ctx = await deploy();
      await ctx.hoodgap.connect(ctx.staker).stake(STAKE_100K);
      await ctx.hoodgap.connect(ctx.buyer).buySubscription(COVERAGE_10K, THRESHOLD_5, 1);

      // Settle policy 0 (Monday gap) at market open with 8% drop
      await advanceToOpen(ctx, 0, PRICE_230);

      const buyerBefore = await ctx.usdc.balanceOf(ctx.buyer.address);
      await ctx.hoodgap.settlePolicy(0);
      const buyerAfter = await ctx.usdc.balanceOf(ctx.buyer.address);

      // gap = |250-230|/250 = 800bp >= 500bp threshold → full coverage
      expect(buyerAfter - buyerBefore).to.equal(COVERAGE_10K);
    });

    it("can be called by anyone (permissionless)", async function () {
      const ctx = await deploy();
      await ctx.hoodgap.connect(ctx.staker).stake(STAKE_100K);
      await ctx.hoodgap.connect(ctx.buyer).buySubscription(COVERAGE_10K, THRESHOLD_5, 1);

      const tuesdayClose = ctx.getClose(1);
      await time.setNextBlockTimestamp(Number(tuesdayClose) + 60);
      await ctx.oracle.update(PRICE_250, tuesdayClose + 60n);

      // Alice (not the subscriber) calls mintGapPolicy
      await expect(ctx.hoodgap.connect(ctx.alice).mintGapPolicy(0)).to.not.be.reverted;

      // NFT still minted to subscription owner (buyer)
      const policyId = 1;
      expect(await ctx.hoodgap.ownerOf(policyId)).to.equal(ctx.buyer.address);
    });
  });

  // ─── policySubscriptionId mapping ────────────────────────────────────────
  describe("subscription tracking", function () {

    it("links policies to subscription via policySubscriptionId", async function () {
      const ctx = await deploy();
      await ctx.hoodgap.connect(ctx.staker).stake(STAKE_100K);
      await ctx.hoodgap.connect(ctx.buyer).buySubscription(COVERAGE_10K, THRESHOLD_5, 4);

      // Policy 0 should link to subscription 0
      expect(await ctx.hoodgap.policySubscriptionId(0)).to.equal(0n);
    });
  });
});
