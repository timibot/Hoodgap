"use strict";

/**
 * test/integration/Subscription.test.js
 *
 * Tests: buySubscription(), mintWeekPolicy(), subscription lifecycle.
 */

const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");
const {
  deploy, stakeThenBuy, advanceToMonday,
  STAKE_100K, COVERAGE_10K, BUYER_WALLET,
  PRICE_250, PRICE_230, PRICE_240,
  THRESHOLD_5, THRESHOLD_10,
  USDC, WEEK_SECONDS,
} = require("../helpers/setup");

describe("Integration: Subscription", function () {

  // ─── buySubscription() — monthly (4 weeks) ───────────────────────────────
  describe("buySubscription() — monthly", function () {

    it("creates subscription and mints week 1 NFT immediately", async function () {
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

      // Check WeekPolicyMinted event (week 1)
      const mintEvent = receipt.logs
        .map(l => { try { return ctx.hoodgap.interface.parseLog(l); } catch { return null; } })
        .find(e => e && e.name === "WeekPolicyMinted");
      expect(mintEvent).to.not.be.null;
      expect(mintEvent.args.weekNumber).to.equal(1n);

      // Subscription record
      const sub = await ctx.hoodgap.getSubscription(0);
      expect(sub.owner).to.equal(ctx.buyer.address);
      expect(sub.totalWeeks).to.equal(4n);
      expect(sub.weeksMinted).to.equal(1n);
      expect(sub.coverage).to.equal(COVERAGE_10K);
    });

    it("applies 5% monthly discount correctly", async function () {
      const ctx = await deploy();
      await ctx.hoodgap.connect(ctx.staker).stake(STAKE_100K);

      const weeklyPremium = await ctx.hoodgap.calculatePremium(COVERAGE_10K);
      const expectedDiscounted = weeklyPremium - (weeklyPremium * 500n) / 10000n;
      const expectedTotal = expectedDiscounted * 4n;

      const buyerBefore = await ctx.usdc.balanceOf(ctx.buyer.address);
      await ctx.hoodgap.connect(ctx.buyer).buySubscription(COVERAGE_10K, THRESHOLD_5, 4);
      const buyerAfter = await ctx.usdc.balanceOf(ctx.buyer.address);

      expect(buyerBefore - buyerAfter).to.equal(expectedTotal);
    });

    it("reverts if pool lacks liquidity", async function () {
      const ctx = await deploy();
      // No staking — pool is empty
      await expect(
        ctx.hoodgap.connect(ctx.buyer).buySubscription(COVERAGE_10K, THRESHOLD_5, 4)
      ).to.be.revertedWith("Insufficient pool liquidity");
    });

    it("reverts for invalid weeks (not 4 or 8)", async function () {
      const ctx = await deploy();
      await ctx.hoodgap.connect(ctx.staker).stake(STAKE_100K);

      await expect(
        ctx.hoodgap.connect(ctx.buyer).buySubscription(COVERAGE_10K, THRESHOLD_5, 3)
      ).to.be.revertedWith("Must be 4 or 8 weeks");

      await expect(
        ctx.hoodgap.connect(ctx.buyer).buySubscription(COVERAGE_10K, THRESHOLD_5, 12)
      ).to.be.revertedWith("Must be 4 or 8 weeks");
    });
  });

  // ─── buySubscription() — season (8 weeks) ────────────────────────────────
  describe("buySubscription() — season pass", function () {

    it("creates 8-week subscription with 10% discount", async function () {
      const ctx = await deploy();
      await ctx.hoodgap.connect(ctx.staker).stake(STAKE_100K);

      const weeklyPremium = await ctx.hoodgap.calculatePremium(COVERAGE_10K);
      const expectedDiscounted = weeklyPremium - (weeklyPremium * 1000n) / 10000n;
      const expectedTotal = expectedDiscounted * 8n;

      const buyerBefore = await ctx.usdc.balanceOf(ctx.buyer.address);
      await ctx.hoodgap.connect(ctx.buyer).buySubscription(COVERAGE_10K, THRESHOLD_5, 8);
      const buyerAfter = await ctx.usdc.balanceOf(ctx.buyer.address);

      expect(buyerBefore - buyerAfter).to.equal(expectedTotal);

      const sub = await ctx.hoodgap.getSubscription(0);
      expect(sub.totalWeeks).to.equal(8n);
      expect(sub.weeksMinted).to.equal(1n);
    });
  });

  // ─── mintWeekPolicy() ────────────────────────────────────────────────────
  describe("mintWeekPolicy()", function () {

    it("mints week 2 policy after advancing to next week", async function () {
      const ctx = await deploy();
      await ctx.hoodgap.connect(ctx.staker).stake(STAKE_100K);
      await ctx.hoodgap.connect(ctx.buyer).buySubscription(COVERAGE_10K, THRESHOLD_5, 4);

      // Advance time by 1 week
      const nextWeekTs = ctx.SATURDAY + WEEK_SECONDS;
      await time.setNextBlockTimestamp(Number(nextWeekTs));
      const newPrice = PRICE_240;
      await ctx.oracle.update(newPrice, nextWeekTs);

      const tx = await ctx.hoodgap.mintWeekPolicy(0);
      const receipt = await tx.wait();

      const mintEvent = receipt.logs
        .map(l => { try { return ctx.hoodgap.interface.parseLog(l); } catch { return null; } })
        .find(e => e && e.name === "WeekPolicyMinted");
      expect(mintEvent.args.weekNumber).to.equal(2n);

      // Policy should use the new oracle price
      const policyId = mintEvent.args.policyId;
      const policy = await ctx.hoodgap.policies(policyId);
      expect(policy.fridayClose).to.equal(newPrice);

      const sub = await ctx.hoodgap.getSubscription(0);
      expect(sub.weeksMinted).to.equal(2n);
    });

    it("reverts if called too early (same week)", async function () {
      const ctx = await deploy();
      await ctx.hoodgap.connect(ctx.staker).stake(STAKE_100K);
      await ctx.hoodgap.connect(ctx.buyer).buySubscription(COVERAGE_10K, THRESHOLD_5, 4);

      // Already minted week 1 — trying to mint week 2 in same week
      await expect(ctx.hoodgap.mintWeekPolicy(0)).to.be.revertedWith("Too early to mint this week");
    });

    it("reverts when all weeks are minted", async function () {
      const ctx = await deploy();
      await ctx.hoodgap.connect(ctx.staker).stake(STAKE_100K);
      await ctx.hoodgap.connect(ctx.buyer).buySubscription(COVERAGE_10K, THRESHOLD_5, 4);

      // Mint weeks 2, 3, 4
      for (let i = 1; i < 4; i++) {
        const ts = ctx.SATURDAY + WEEK_SECONDS * BigInt(i);
        await time.setNextBlockTimestamp(Number(ts));
        await ctx.oracle.update(PRICE_250, ts);
        await ctx.hoodgap.mintWeekPolicy(0);
      }

      const sub = await ctx.hoodgap.getSubscription(0);
      expect(sub.weeksMinted).to.equal(4n);

      // Try minting 5th
      const ts5 = ctx.SATURDAY + WEEK_SECONDS * 4n;
      await time.setNextBlockTimestamp(Number(ts5));
      await ctx.oracle.update(PRICE_250, ts5);
      await expect(ctx.hoodgap.mintWeekPolicy(0)).to.be.revertedWith("All weeks already minted");
    });

    it("each policy settles independently with binary payout", async function () {
      const ctx = await deploy();
      await ctx.hoodgap.connect(ctx.staker).stake(STAKE_100K);
      await ctx.hoodgap.connect(ctx.buyer).buySubscription(COVERAGE_10K, THRESHOLD_5, 4);

      const settlementWeek = await ctx.hoodgap.getCurrentSettlementWeek();
      await ctx.hoodgap.connect(ctx.owner).approveSettlement(settlementWeek, 10_000n, "test");

      // Advance to Monday and settle week 1 with 8% gap (binary payout)
      await advanceToMonday(ctx, PRICE_230);

      // Policy 0 is the week 1 policy
      const buyerBefore = await ctx.usdc.balanceOf(ctx.buyer.address);
      await ctx.hoodgap.settlePolicy(0);
      const buyerAfter = await ctx.usdc.balanceOf(ctx.buyer.address);

      // gap = |250-230|/250 = 800bp >= 500bp threshold → full coverage
      expect(buyerAfter - buyerBefore).to.equal(COVERAGE_10K);
    });

    it("can be called by anyone (permissionless)", async function () {
      const ctx = await deploy();
      await ctx.hoodgap.connect(ctx.staker).stake(STAKE_100K);
      await ctx.hoodgap.connect(ctx.buyer).buySubscription(COVERAGE_10K, THRESHOLD_5, 4);

      const ts = ctx.SATURDAY + WEEK_SECONDS;
      await time.setNextBlockTimestamp(Number(ts));
      await ctx.oracle.update(PRICE_250, ts);

      // Alice (not the subscriber) calls mintWeekPolicy
      await expect(ctx.hoodgap.connect(ctx.alice).mintWeekPolicy(0)).to.not.be.reverted;

      // NFT still minted to subscription owner (buyer)
      const policyId = 1; // second policy
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
