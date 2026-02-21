"use strict";

/**
 * test/unit/TransferFee.test.js
 *
 * Tests: _update() override transfer fee, payout→ownerOf() fix.
 * Updated for all-gap model: uses daily gap settlement instead of weekend.
 */

const { expect } = require("chai");
const { ethers } = require("hardhat");
const {
  deploy, stakeThenBuy, advanceToOpen,
  STAKE_100K, COVERAGE_10K,
  PRICE_250, PRICE_230,
  THRESHOLD_5,
  USDC,
} = require("../helpers/setup");
const { time } = require("@nomicfoundation/hardhat-network-helpers");

describe("Unit: TransferFee", function () {

  describe("transfer fee collection", function () {

    it("charges 5% of premium on NFT transfer", async function () {
      const ctx = await deploy();
      const policyId = await stakeThenBuy(ctx);

      const policy = await ctx.hoodgap.policies(policyId);
      const expectedFee = (policy.premium * 500n) / 10000n;

      const reserveBefore = await ctx.hoodgap.reserveBalance();

      // buyer approves USDC for fee
      const hgAddr = await ctx.hoodgap.getAddress();
      await ctx.usdc.connect(ctx.buyer).approve(hgAddr, ethers.MaxUint256);

      // Transfer NFT from buyer to alice
      await ctx.hoodgap.connect(ctx.buyer).transferFrom(ctx.buyer.address, ctx.alice.address, policyId);

      const reserveAfter = await ctx.hoodgap.reserveBalance();
      expect(reserveAfter - reserveBefore).to.equal(expectedFee);
    });

    it("emits PolicyTransferred event with correct fee", async function () {
      const ctx = await deploy();
      const policyId = await stakeThenBuy(ctx);

      const policy = await ctx.hoodgap.policies(policyId);
      const expectedFee = (policy.premium * 500n) / 10000n;

      await expect(
        ctx.hoodgap.connect(ctx.buyer).transferFrom(ctx.buyer.address, ctx.alice.address, policyId)
      ).to.emit(ctx.hoodgap, "PolicyTransferred")
        .withArgs(policyId, ctx.buyer.address, ctx.alice.address, expectedFee);
    });

    it("does NOT charge fee on mint", async function () {
      const ctx = await deploy();
      const reserveBefore = await ctx.hoodgap.reserveBalance();

      await ctx.hoodgap.connect(ctx.staker).stake(STAKE_100K);
      await ctx.hoodgap.connect(ctx.buyer).buyPolicy(COVERAGE_10K, THRESHOLD_5);

      // Reserve should only increase by the claim reserve cut from the premium (77%)
      const policy = await ctx.hoodgap.policies(0);
      const premium = policy.premium;
      const reserveCut = (premium * 7700n) / 10000n;

      const reserveAfter = await ctx.hoodgap.reserveBalance();
      expect(reserveAfter - reserveBefore).to.equal(reserveCut);
    });

    it("reverts transfer if sender hasn't approved USDC for fee", async function () {
      const ctx = await deploy();
      const policyId = await stakeThenBuy(ctx);

      // Revoke USDC approval
      const hgAddr = await ctx.hoodgap.getAddress();
      await ctx.usdc.connect(ctx.buyer).approve(hgAddr, 0n);

      await expect(
        ctx.hoodgap.connect(ctx.buyer).transferFrom(ctx.buyer.address, ctx.alice.address, policyId)
      ).to.be.reverted;
    });
  });

  describe("payout follows NFT ownership", function () {

    it("payout goes to current ownerOf, not original holder", async function () {
      const ctx = await deploy();
      const policyId = await stakeThenBuy(ctx);

      // Transfer to alice
      await ctx.hoodgap.connect(ctx.buyer).transferFrom(ctx.buyer.address, ctx.alice.address, policyId);
      expect(await ctx.hoodgap.ownerOf(policyId)).to.equal(ctx.alice.address);

      // Advance to market open for day 0 (Monday gap → Tuesday open) with gap price
      await advanceToOpen(ctx, 4, PRICE_230);

      const aliceBefore = await ctx.usdc.balanceOf(ctx.alice.address);
      const buyerBefore = await ctx.usdc.balanceOf(ctx.buyer.address);

      await ctx.hoodgap.settlePolicy(policyId);

      const aliceAfter = await ctx.usdc.balanceOf(ctx.alice.address);
      const buyerAfter = await ctx.usdc.balanceOf(ctx.buyer.address);

      // Alice should receive payout, buyer should get nothing
      expect(aliceAfter).to.be.gt(aliceBefore);
      expect(buyerAfter).to.equal(buyerBefore);
    });
  });
});
