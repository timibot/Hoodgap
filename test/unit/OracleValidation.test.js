"use strict";

/**
 * test/unit/OracleValidation.test.js
 *
 * Tests: Oracle edge cases — zero price, negative price,
 *        staleness during settlement, oracle not updated after Monday.
 *
 * Complements PremiumCalculation.test.js (which covers basic staleness)
 * and BuySettle.test.js (which covers settlement gate checks).
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
  PRICE_250,
  PRICE_230,
  THRESHOLD_5,
} = require("../helpers/setup");

describe("Unit: OracleValidation", function () {
  // ─── Zero/negative prices ────────────────────────────────────────────────────
  // Note: calculatePremium() only checks oracle staleness, NOT price validity.
  // Price validity (answer > 0) is enforced in buyPolicy() and settlePolicy().
  // These tests verify that buyPolicy catches invalid prices even though
  // calculatePremium would not revert.

  it("calculatePremium does not validate oracle price (view function)", async function () {
    const ctx = await deploy();
    await ctx.hoodgap.connect(ctx.staker).stake(STAKE_100K);

    // Set oracle to zero price — calculatePremium is a view function
    // that only checks staleness, not price validity
    const ts = BigInt(await time.latest()) + 1n;
    await time.setNextBlockTimestamp(Number(ts));
    await ctx.oracle.update(0n, ts);

    // calculatePremium will NOT revert — it doesn't check answer > 0
    // The price check happens only in buyPolicy/settlePolicy
    const premium = await ctx.hoodgap.calculatePremium(COVERAGE_10K);
    expect(premium).to.be.gte(0n);
  });

  // ─── buyPolicy rejects zero price ───────────────────────────────────────────
  it("buyPolicy reverts when oracle price is zero at purchase time", async function () {
    const ctx = await deploy();
    await ctx.hoodgap.connect(ctx.staker).stake(STAKE_100K);

    // First calculate premium with valid oracle (to approve enough USDC)
    // Then corrupt oracle before buying
    const ts = BigInt(await time.latest()) + 1n;
    await time.setNextBlockTimestamp(Number(ts));
    await ctx.oracle.update(0n, ts);

    await expect(ctx.hoodgap.connect(ctx.buyer).buyPolicy(COVERAGE_10K, THRESHOLD_5))
      .to.be.reverted;
  });

  // ─── buyPolicy rejects negative price ───────────────────────────────────────
  it("buyPolicy reverts when oracle price is negative at purchase time", async function () {
    const ctx = await deploy();
    await ctx.hoodgap.connect(ctx.staker).stake(STAKE_100K);

    const ts = BigInt(await time.latest()) + 1n;
    await time.setNextBlockTimestamp(Number(ts));
    await ctx.oracle.update(-50_00_000_000n, ts);

    await expect(ctx.hoodgap.connect(ctx.buyer).buyPolicy(COVERAGE_10K, THRESHOLD_5))
      .to.be.reverted;
  });

  // ─── Settlement rejects zero oracle ─────────────────────────────────────────
  it("settlePolicy reverts when oracle returns zero at settlement time", async function () {
    const ctx      = await deploy();
    const policyId = await stakeThenBuy(ctx);
    const settlementWeek = await ctx.hoodgap.getCurrentSettlementWeek();
    await ctx.hoodgap.connect(ctx.owner).approveSettlement(settlementWeek, 10_000n, "test");

    // Advance to Monday with zero price
    await time.setNextBlockTimestamp(Number(ctx.MONDAY));
    await ctx.oracle.update(0n, ctx.MONDAY);

    await expect(ctx.hoodgap.settlePolicy(policyId))
      .to.be.revertedWith("Invalid oracle price");
  });

  // ─── Settlement rejects negative oracle ─────────────────────────────────────
  it("settlePolicy reverts when oracle returns negative at settlement time", async function () {
    const ctx      = await deploy();
    const policyId = await stakeThenBuy(ctx);
    const settlementWeek = await ctx.hoodgap.getCurrentSettlementWeek();
    await ctx.hoodgap.connect(ctx.owner).approveSettlement(settlementWeek, 10_000n, "test");

    // Advance to Monday with negative price
    await time.setNextBlockTimestamp(Number(ctx.MONDAY));
    await ctx.oracle.update(-100_00_000_000n, ctx.MONDAY);

    await expect(ctx.hoodgap.settlePolicy(policyId))
      .to.be.revertedWith("Invalid oracle price");
  });

  // ─── Settlement rejects stale oracle (updated before Monday) ────────────────
  it("settlePolicy reverts when oracle timestamp is before Monday open", async function () {
    const ctx      = await deploy();
    const policyId = await stakeThenBuy(ctx);
    const settlementWeek = await ctx.hoodgap.getCurrentSettlementWeek();
    await ctx.hoodgap.connect(ctx.owner).approveSettlement(settlementWeek, 10_000n, "test");

    // Advance chain to Monday but oracle timestamp is Saturday (before Monday)
    const saturdayTs = ctx.MONDAY - 172_800n; // 2 days before Monday
    await time.setNextBlockTimestamp(Number(ctx.MONDAY));
    await ctx.oracle.update(PRICE_230, saturdayTs);

    await expect(ctx.hoodgap.settlePolicy(policyId))
      .to.be.revertedWith("Oracle not updated since Monday open");
  });

  // ─── buyPolicy rejects stale oracle ─────────────────────────────────────────
  it("buyPolicy reverts when oracle is older than 1 hour", async function () {
    const ctx = await deploy();
    await ctx.hoodgap.connect(ctx.staker).stake(STAKE_100K);

    // Advance time by 2 hours from latest oracle update
    await time.increase(2 * 3600);

    await expect(ctx.hoodgap.connect(ctx.buyer).buyPolicy(COVERAGE_10K, THRESHOLD_5))
      .to.be.revertedWith("Oracle price too stale");
  });

  // ─── Freshly updated oracle allows buyPolicy ────────────────────────────────
  it("buyPolicy succeeds after refreshing a stale oracle", async function () {
    const ctx = await deploy();
    await ctx.hoodgap.connect(ctx.staker).stake(STAKE_100K);

    // Make oracle stale
    await time.increase(2 * 3600);

    // Refresh oracle
    const ts = BigInt(await time.latest()) + 1n;
    await time.setNextBlockTimestamp(Number(ts));
    await ctx.oracle.update(PRICE_250, ts);

    await expect(ctx.hoodgap.connect(ctx.buyer).buyPolicy(COVERAGE_10K, THRESHOLD_5))
      .to.not.be.reverted;
  });
});
