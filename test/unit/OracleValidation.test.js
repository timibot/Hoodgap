"use strict";

/**
 * test/unit/OracleValidation.test.js
 *
 * Tests: Oracle edge cases — zero price, negative price,
 *        staleness during settlement, oracle not updated after market open.
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
  PRICE_250,
  PRICE_230,
  THRESHOLD_5,
} = require("../helpers/setup");

describe("Unit: OracleValidation", function () {
  // ─── Zero/negative prices ────────────────────────────────────────────────────
  it("calculatePremium does not validate oracle price (view function)", async function () {
    const ctx = await deploy();
    await ctx.hoodgap.connect(ctx.staker).stake(STAKE_100K);

    const ts = BigInt(await time.latest()) + 1n;
    await time.setNextBlockTimestamp(Number(ts));
    await ctx.oracle.update(0n, ts);

    // calculatePremium only checks staleness, not price validity
    const premium = await ctx.hoodgap["calculatePremium(uint256,uint256)"](COVERAGE_10K, THRESHOLD_5);
    expect(premium).to.be.gte(0n);
  });

  // ─── buyPolicy rejects zero price ───────────────────────────────────────────
  it("buyPolicy reverts when oracle price is zero at purchase time", async function () {
    const ctx = await deploy();
    await ctx.hoodgap.connect(ctx.staker).stake(STAKE_100K);

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

    // Advance to next market open (day 4 = Friday→Monday gap)
    const openTs = ctx.getOpen(4);
    await time.setNextBlockTimestamp(Number(openTs));
    await ctx.oracle.update(0n, openTs);

    await expect(ctx.hoodgap.settlePolicy(policyId))
      .to.be.revertedWith("Invalid oracle price");
  });

  // ─── Settlement rejects negative oracle ─────────────────────────────────────
  it("settlePolicy reverts when oracle returns negative at settlement time", async function () {
    const ctx      = await deploy();
    const policyId = await stakeThenBuy(ctx);

    const openTs = ctx.getOpen(4);
    await time.setNextBlockTimestamp(Number(openTs));
    await ctx.oracle.update(-100_00_000_000n, openTs);

    await expect(ctx.hoodgap.settlePolicy(policyId))
      .to.be.revertedWith("Invalid oracle price");
  });

  // ─── Settlement rejects stale oracle ────────────────────────────────────────
  it("settlePolicy reverts when oracle timestamp is before market open", async function () {
    const ctx      = await deploy();
    const policyId = await stakeThenBuy(ctx);

    // Advance chain to market open but oracle timestamp is from before close
    const openTs     = ctx.getOpen(4);
    const staleTs    = ctx.getClose(4) - 100n; // before Friday close
    await time.setNextBlockTimestamp(Number(openTs));
    await ctx.oracle.update(PRICE_230, staleTs);

    await expect(ctx.hoodgap.settlePolicy(policyId))
      .to.be.revertedWith("Oracle not updated since market open");
  });

  // ─── buyPolicy rejects stale oracle ─────────────────────────────────────────
  it("buyPolicy reverts when oracle is older than 24 hours", async function () {
    const ctx = await deploy();
    await ctx.hoodgap.connect(ctx.staker).stake(STAKE_100K);

    // Advance time by 25 hours so oracle becomes stale
    await time.increase(25 * 3600);

    await expect(ctx.hoodgap.connect(ctx.buyer).buyPolicy(COVERAGE_10K, THRESHOLD_5))
      .to.be.revertedWith("Oracle price too stale");
  });

  // ─── Freshly updated oracle allows buyPolicy ────────────────────────────────
  it("buyPolicy succeeds after refreshing a stale oracle", async function () {
    const ctx = await deploy();
    await ctx.hoodgap.connect(ctx.staker).stake(STAKE_100K);

    // Make oracle stale
    await time.increase(25 * 3600);

    // Refresh oracle
    const ts = BigInt(await time.latest()) + 1n;
    await time.setNextBlockTimestamp(Number(ts));
    await ctx.oracle.update(PRICE_250, ts);

    await expect(ctx.hoodgap.connect(ctx.buyer).buyPolicy(COVERAGE_10K, THRESHOLD_5))
      .to.not.be.reverted;
  });
});
