"use strict";

/**
 * test/unit/HolidayMultiplier.test.js
 *
 * Tests: queueHolidayMultiplier(), executeHolidayMultiplier(),
 *        cancelHolidayMultiplier() — timelock lifecycle, validation,
 *        access control, event emission.
 *
 * The existing TimeDecay.test.js covers how the holiday multiplier
 * affects getTimeDecayMultiplier(). This file tests the administrative
 * lifecycle of setting/cancelling holiday multipliers.
 */

const { expect } = require("chai");
const { time }   = require("@nomicfoundation/hardhat-network-helpers");
const {
  deploy,
  PRICE_250,
} = require("../helpers/setup");

describe("Unit: HolidayMultiplier", function () {
  // ─── queue: validation ───────────────────────────────────────────────────────
  it("queueHolidayMultiplier sets pending change with 24h executeAfter", async function () {
    const ctx = await deploy();
    const settlementWeek = await ctx.hoodgap.getCurrentSettlementWeek();

    await ctx.hoodgap.connect(ctx.owner).queueHolidayMultiplier(settlementWeek, 30_000n, "Thanksgiving");

    const pending = await ctx.hoodgap.pendingHolidayChanges(settlementWeek);
    expect(pending.value).to.equal(30_000n);
    expect(pending.exists).to.equal(true);

    // executeAfter should be ~24h from now
    const currentTs = BigInt(await time.latest());
    expect(pending.executeAfter).to.be.gte(currentTs + 24n * 3600n - 10n);
  });

  it("reverts when multiplier is below minimum (1.0x = 10000)", async function () {
    const ctx = await deploy();
    const week = await ctx.hoodgap.getCurrentSettlementWeek();

    await expect(ctx.hoodgap.connect(ctx.owner).queueHolidayMultiplier(week, 9_999n, "too low"))
      .to.be.revertedWith("Multiplier must be 1.0x-5.0x");
  });

  it("reverts when multiplier exceeds maximum (5.0x = 50000)", async function () {
    const ctx = await deploy();
    const week = await ctx.hoodgap.getCurrentSettlementWeek();

    await expect(ctx.hoodgap.connect(ctx.owner).queueHolidayMultiplier(week, 50_001n, "too high"))
      .to.be.revertedWith("Multiplier must be 1.0x-5.0x");
  });

  it("reverts when a change is already pending for same week", async function () {
    const ctx = await deploy();
    const week = await ctx.hoodgap.getCurrentSettlementWeek();

    await ctx.hoodgap.connect(ctx.owner).queueHolidayMultiplier(week, 20_000n, "first");

    await expect(ctx.hoodgap.connect(ctx.owner).queueHolidayMultiplier(week, 30_000n, "second"))
      .to.be.revertedWith("Change already pending for this week");
  });

  it("emits HolidayChangeQueued event", async function () {
    const ctx = await deploy();
    const week = await ctx.hoodgap.getCurrentSettlementWeek();

    await expect(ctx.hoodgap.connect(ctx.owner).queueHolidayMultiplier(week, 25_000n, "MLK Day"))
      .to.emit(ctx.hoodgap, "HolidayChangeQueued")
      .withArgs(week, 25_000n, (v) => typeof v === "bigint", "MLK Day");
  });

  // ─── queue: access control ──────────────────────────────────────────────────
  it("reverts when non-owner queues holiday multiplier", async function () {
    const ctx = await deploy();
    const week = await ctx.hoodgap.getCurrentSettlementWeek();

    await expect(ctx.hoodgap.connect(ctx.buyer).queueHolidayMultiplier(week, 20_000n, "hack"))
      .to.be.reverted;
  });

  // ─── execute: timelock ──────────────────────────────────────────────────────
  it("reverts when executing before 24h timelock expires", async function () {
    const ctx = await deploy();
    const week = await ctx.hoodgap.getCurrentSettlementWeek();

    await ctx.hoodgap.connect(ctx.owner).queueHolidayMultiplier(week, 20_000n, "test");

    // Try to execute immediately — should fail
    await expect(ctx.hoodgap.executeHolidayMultiplier(week))
      .to.be.revertedWith("Timelock: 24h has not elapsed");
  });

  it("succeeds after 24h has elapsed", async function () {
    const ctx = await deploy();
    const week = await ctx.hoodgap.getCurrentSettlementWeek();

    await ctx.hoodgap.connect(ctx.owner).queueHolidayMultiplier(week, 20_000n, "test");

    // Advance 24h + 1 second
    await time.increase(24 * 3600 + 1);
    await expect(ctx.hoodgap.executeHolidayMultiplier(week)).to.not.be.reverted;

    // Verify multiplier is set
    const multiplier = await ctx.hoodgap.holidayTimeMultipliers(week);
    expect(multiplier).to.equal(20_000n);
  });

  it("emits HolidayMultiplierSet event on execution", async function () {
    const ctx = await deploy();
    const week = await ctx.hoodgap.getCurrentSettlementWeek();

    await ctx.hoodgap.connect(ctx.owner).queueHolidayMultiplier(week, 35_000n, "Good Friday");
    await time.increase(24 * 3600 + 1);

    // Contract now properly caches description before deleting the struct
    await expect(ctx.hoodgap.executeHolidayMultiplier(week))
      .to.emit(ctx.hoodgap, "HolidayMultiplierSet")
      .withArgs(week, 35_000n, "Good Friday");
  });

  it("clears pending change after execution", async function () {
    const ctx = await deploy();
    const week = await ctx.hoodgap.getCurrentSettlementWeek();

    await ctx.hoodgap.connect(ctx.owner).queueHolidayMultiplier(week, 20_000n, "test");
    await time.increase(24 * 3600 + 1);
    await ctx.hoodgap.executeHolidayMultiplier(week);

    const pending = await ctx.hoodgap.pendingHolidayChanges(week);
    expect(pending.exists).to.equal(false);
  });

  it("reverts when no pending change exists for the week", async function () {
    const ctx = await deploy();
    const week = await ctx.hoodgap.getCurrentSettlementWeek();

    await expect(ctx.hoodgap.executeHolidayMultiplier(week))
      .to.be.revertedWith("No pending change for this week");
  });

  // ─── cancel ─────────────────────────────────────────────────────────────────
  it("cancelHolidayMultiplier removes pending change", async function () {
    const ctx = await deploy();
    const week = await ctx.hoodgap.getCurrentSettlementWeek();

    await ctx.hoodgap.connect(ctx.owner).queueHolidayMultiplier(week, 20_000n, "test");
    await ctx.hoodgap.cancelHolidayMultiplier(week);

    const pending = await ctx.hoodgap.pendingHolidayChanges(week);
    expect(pending.exists).to.equal(false);
  });

  it("emits HolidayChangeCancelled event", async function () {
    const ctx = await deploy();
    const week = await ctx.hoodgap.getCurrentSettlementWeek();

    await ctx.hoodgap.connect(ctx.owner).queueHolidayMultiplier(week, 20_000n, "test");
    await expect(ctx.hoodgap.cancelHolidayMultiplier(week))
      .to.emit(ctx.hoodgap, "HolidayChangeCancelled")
      .withArgs(week, (v) => typeof v === "bigint");
  });

  it("reverts cancel when no pending change exists", async function () {
    const ctx = await deploy();
    const week = await ctx.hoodgap.getCurrentSettlementWeek();

    await expect(ctx.hoodgap.cancelHolidayMultiplier(week))
      .to.be.revertedWith("No pending change to cancel");
  });

  it("allows new queue after cancel", async function () {
    const ctx = await deploy();
    const week = await ctx.hoodgap.getCurrentSettlementWeek();

    await ctx.hoodgap.connect(ctx.owner).queueHolidayMultiplier(week, 20_000n, "first");
    await ctx.hoodgap.cancelHolidayMultiplier(week);

    // Should succeed since pending was cleared
    await expect(ctx.hoodgap.connect(ctx.owner).queueHolidayMultiplier(week, 30_000n, "second"))
      .to.not.be.reverted;
  });

  // ─── different weeks can have different multipliers ─────────────────────────
  it("supports different multipliers for different weeks", async function () {
    const ctx = await deploy();
    const week = await ctx.hoodgap.getCurrentSettlementWeek();

    // Queue and execute for current week
    await ctx.hoodgap.connect(ctx.owner).queueHolidayMultiplier(week, 20_000n, "week1");
    await time.increase(24 * 3600 + 1);
    await ctx.hoodgap.executeHolidayMultiplier(week);

    // Queue and execute for next week
    const nextWeek = week + 1n;
    await ctx.hoodgap.connect(ctx.owner).queueHolidayMultiplier(nextWeek, 40_000n, "week2");
    await time.increase(24 * 3600 + 1);
    await ctx.hoodgap.executeHolidayMultiplier(nextWeek);

    expect(await ctx.hoodgap.holidayTimeMultipliers(week)).to.equal(20_000n);
    expect(await ctx.hoodgap.holidayTimeMultipliers(nextWeek)).to.equal(40_000n);
  });

  // ─── boundary values ───────────────────────────────────────────────────────
  it("accepts minimum multiplier 1.0x (10000)", async function () {
    const ctx = await deploy();
    const week = await ctx.hoodgap.getCurrentSettlementWeek();

    await expect(ctx.hoodgap.connect(ctx.owner).queueHolidayMultiplier(week, 10_000n, "min"))
      .to.not.be.reverted;
  });

  it("accepts maximum multiplier 5.0x (50000)", async function () {
    const ctx = await deploy();
    const week = await ctx.hoodgap.getCurrentSettlementWeek();

    await expect(ctx.hoodgap.connect(ctx.owner).queueHolidayMultiplier(week, 50_000n, "max"))
      .to.not.be.reverted;
  });
});
