"use strict";

/**
 * test/unit/SplitAdjustment.test.js
 *
 * Tests: calculateGap(), week math (getWeekNumber/getMonday/getFriday),
 *        split ratio effect on adjusted Friday price, updateWeekTiming().
 */

const { expect } = require("chai");
const { time }   = require("@nomicfoundation/hardhat-network-helpers");
const {
  deploy,
  REFERENCE_WEEK,
  WEEK_SECONDS,
  WEEKEND_DURATION,
  PRICE_250,
  PRICE_230,
  PRICE_252,
  getWeekNumber,
  getMonday,
  getFriday,
} = require("../helpers/setup");

describe("Unit: SplitAdjustment", function () {
  // ─── Week number math ────────────────────────────────────────────────────────
  describe("getWeekNumber", function () {
    it("returns 0 for REFERENCE_WEEK", async function () {
      const ctx = await deploy();
      expect(await ctx.hoodgap.getWeekNumber(REFERENCE_WEEK)).to.equal(0n);
    });

    it("returns 1 exactly one week after reference", async function () {
      const ctx = await deploy();
      expect(await ctx.hoodgap.getWeekNumber(REFERENCE_WEEK + WEEK_SECONDS)).to.equal(1n);
    });

    it("returns correct week for ctx.MONDAY", async function () {
      const ctx = await deploy();
      expect(await ctx.hoodgap.getWeekNumber(ctx.MONDAY)).to.equal(ctx.WEEK);
    });

    it("reverts for timestamps before REFERENCE_WEEK", async function () {
      const ctx = await deploy();
      await expect(ctx.hoodgap.getWeekNumber(REFERENCE_WEEK - 1n))
        .to.be.revertedWith("Before reference date");
    });
  });

  // ─── getMonday / getFriday ────────────────────────────────────────────────────
  describe("getMonday / getFriday", function () {
    it("getMonday(0) equals REFERENCE_WEEK", async function () {
      const ctx = await deploy();
      expect(await ctx.hoodgap.getMonday(0n)).to.equal(REFERENCE_WEEK);
    });

    it("getMonday(week) equals ctx.MONDAY", async function () {
      const ctx = await deploy();
      expect(await ctx.hoodgap.getMonday(ctx.WEEK)).to.equal(ctx.MONDAY);
    });

    it("getFriday(week) equals ctx.FRIDAY", async function () {
      const ctx = await deploy();
      expect(await ctx.hoodgap.getFriday(ctx.WEEK)).to.equal(ctx.FRIDAY);
    });

    it("Monday - Friday = WEEKEND_DURATION (279000 s)", async function () {
      const ctx    = await deploy();
      const monday = await ctx.hoodgap.getMonday(50n);
      const friday = await ctx.hoodgap.getFriday(50n);
      expect(monday - friday).to.equal(WEEKEND_DURATION);
    });
  });

  // ─── updateWeekTiming ────────────────────────────────────────────────────────
  describe("updateWeekTiming", function () {
    it("on Saturday sets fridayCloseTime and mondayOpenTime correctly", async function () {
      const ctx = await deploy();
      // The fixture already called updateWeekTiming() on Saturday.
      // On Saturday of targetWeek: getWeekNumber(SAT) = targetWeek - 1
      // fridayCloseTime = getFriday(targetWeek - 1)
      // mondayOpenTime = getMonday(targetWeek)
      const expectedFriday = getFriday(ctx.WEEK - 1n);
      const expectedMonday = getMonday(ctx.WEEK);

      await ctx.hoodgap.updateWeekTiming();
      expect(await ctx.hoodgap.fridayCloseTime()).to.equal(expectedFriday);
      expect(await ctx.hoodgap.mondayOpenTime()).to.equal(expectedMonday);
    });

    it("after Monday advances to next week timing", async function () {
      const ctx = await deploy();
      // Move past getMonday(targetWeek) = ctx.MONDAY
      await time.setNextBlockTimestamp(Number(ctx.MONDAY) + 3600);
      await ctx.hoodgap.updateWeekTiming();

      // On Monday of targetWeek: getWeekNumber(MONDAY) = targetWeek
      // fridayCloseTime = getFriday(targetWeek) = ctx.FRIDAY
      // mondayOpenTime = getMonday(targetWeek + 1) = MONDAY_NEXT
      expect(await ctx.hoodgap.fridayCloseTime()).to.equal(ctx.FRIDAY);
      expect(await ctx.hoodgap.mondayOpenTime()).to.equal(ctx.MONDAY_NEXT);
    });

    it("emits WeekTimingUpdated event", async function () {
      const ctx = await deploy();
      // On Saturday: currentWeek = targetWeek - 1
      const satWeek = ctx.WEEK - 1n;
      const expectedFriday = getFriday(satWeek);
      const expectedMonday = getMonday(satWeek + 1n);
      await expect(ctx.hoodgap.updateWeekTiming())
        .to.emit(ctx.hoodgap, "WeekTimingUpdated")
        .withArgs(satWeek, expectedFriday, expectedMonday);
    });

    it("is callable by anyone (not owner-only)", async function () {
      const ctx = await deploy();
      await expect(ctx.hoodgap.connect(ctx.alice).updateWeekTiming()).to.not.be.reverted;
    });
  });

  // ─── calculateGap ────────────────────────────────────────────────────────────
  describe("calculateGap", function () {
    it("returns 0 for equal prices", async function () {
      const ctx = await deploy();
      expect(await ctx.hoodgap.calculateGap(PRICE_250, PRICE_250)).to.equal(0n);
    });

    it("calculates 8% downward gap correctly (800 bp)", async function () {
      const ctx = await deploy();
      expect(await ctx.hoodgap.calculateGap(PRICE_230, PRICE_250)).to.equal(800n);
    });

    it("calculates upward gap correctly", async function () {
      const ctx = await deploy();
      expect(await ctx.hoodgap.calculateGap(PRICE_252, PRICE_250)).to.equal(80n);
    });

    it("reverts when either price is zero", async function () {
      const ctx = await deploy();
      await expect(ctx.hoodgap.calculateGap(0n, PRICE_250))
        .to.be.revertedWith("Prices must be positive");
      await expect(ctx.hoodgap.calculateGap(PRICE_250, 0n))
        .to.be.revertedWith("Prices must be positive");
    });
  });

  // ─── Split ratio effect ───────────────────────────────────────────────────────
  describe("Split ratio in settlement gap calculation", function () {
    it("2:1 split halves adjusted Friday price (splitRatio = 5000)", async function () {
      const ctx = await deploy();
      const fridayClose     = PRICE_250;
      const splitRatio      = 5_000n;
      const adjustedFriday  = (fridayClose * splitRatio) / 10_000n;
      const gap             = await ctx.hoodgap.calculateGap(PRICE_230, adjustedFriday);
      expect(gap).to.equal(8_400n);
    });

    it("3:1 split sets ratio to 3333 bp → adjustedFriday ≈ $83.33", async function () {
      const ctx = await deploy();
      const adjustedFriday  = (PRICE_250 * 3_333n) / 10_000n;
      const gap = await ctx.hoodgap.calculateGap(PRICE_230, adjustedFriday);
      expect(gap).to.be.gt(0n);
    });

    it("no split (ratio = 10000) keeps Friday price unchanged", async function () {
      const ctx = await deploy();
      const adjusted = (PRICE_250 * 10_000n) / 10_000n;
      expect(adjusted).to.equal(PRICE_250);
      const gap = await ctx.hoodgap.calculateGap(PRICE_230, adjusted);
      expect(gap).to.equal(800n);
    });
  });
});
