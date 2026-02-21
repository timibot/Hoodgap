"use strict";

/**
 * test/unit/SplitAdjustment.test.js
 *
 * Tests: calculateGap(), week math (getWeekNumber/getMonday/getFriday),
 *        split ratio effect on adjusted close price, market timing helpers.
 */

const { expect } = require("chai");
const { time }   = require("@nomicfoundation/hardhat-network-helpers");
const {
  deploy,
  REFERENCE_WEEK,
  WEEK_SECONDS,
  PRICE_250,
  PRICE_230,
  PRICE_252,
  getWeekNumber,
  getMonday,
  getFriday,
  getMarketClose,
  getNextMarketOpen,
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

    it("returns correct week for fixture time", async function () {
      const ctx = await deploy();
      expect(await ctx.hoodgap.getWeekNumber(ctx.PIN_TIME)).to.equal(ctx.WEEK);
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

    it("getMonday returns the Monday 9:30am EST for a given week", async function () {
      const ctx = await deploy();
      const monday = await ctx.hoodgap.getMonday(ctx.WEEK);
      expect(monday).to.equal(getMonday(ctx.WEEK));
    });

    it("getFriday returns the Friday close for a given week", async function () {
      const ctx = await deploy();
      const friday = await ctx.hoodgap.getFriday(ctx.WEEK);
      expect(friday).to.equal(getFriday(ctx.WEEK));
    });
  });

  // ─── Market close / open helpers ──────────────────────────────────────────────
  describe("getMarketClose / getNextMarketOpen", function () {
    it("getMarketClose returns correct timestamp for Monday (day 0)", async function () {
      const ctx = await deploy();
      const contractClose = await ctx.hoodgap.getMarketClose(ctx.WEEK, 0n);
      expect(contractClose).to.equal(getMarketClose(ctx.WEEK, 0n));
    });

    it("getMarketClose returns correct timestamp for Friday (day 4)", async function () {
      const ctx = await deploy();
      const contractClose = await ctx.hoodgap.getMarketClose(ctx.WEEK, 4n);
      expect(contractClose).to.equal(getMarketClose(ctx.WEEK, 4n));
    });

    it("getNextMarketOpen for Monday returns Tuesday open", async function () {
      const ctx = await deploy();
      const open = await ctx.hoodgap.getNextMarketOpen(ctx.WEEK, 0n);
      expect(open).to.equal(getNextMarketOpen(ctx.WEEK, 0n));
    });

    it("getNextMarketOpen for Friday returns next Monday open", async function () {
      const ctx = await deploy();
      const open = await ctx.hoodgap.getNextMarketOpen(ctx.WEEK, 4n);
      // Friday gap opens at next week's Monday
      expect(open).to.equal(getMonday(ctx.WEEK + 1n));
    });

    it("close time is always before next open time", async function () {
      const ctx = await deploy();
      for (let day = 0; day < 5; day++) {
        const close = await ctx.hoodgap.getMarketClose(ctx.WEEK, day);
        const open  = await ctx.hoodgap.getNextMarketOpen(ctx.WEEK, day);
        expect(open).to.be.gt(close);
      }
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
    it("2:1 split halves adjusted close price (splitRatio = 5000)", async function () {
      const ctx = await deploy();
      const closePrice     = PRICE_250;
      const splitRatio     = 5_000n;
      const adjustedClose  = (closePrice * splitRatio) / 10_000n;
      const gap            = await ctx.hoodgap.calculateGap(PRICE_230, adjustedClose);
      expect(gap).to.equal(8_400n);
    });

    it("3:1 split sets ratio to 3333 bp → adjustedClose ≈ $83.33", async function () {
      const ctx = await deploy();
      const adjustedClose = (PRICE_250 * 3_333n) / 10_000n;
      const gap = await ctx.hoodgap.calculateGap(PRICE_230, adjustedClose);
      expect(gap).to.be.gt(0n);
    });

    it("no split (ratio = 10000) keeps close price unchanged", async function () {
      const ctx = await deploy();
      const adjusted = (PRICE_250 * 10_000n) / 10_000n;
      expect(adjusted).to.equal(PRICE_250);
      const gap = await ctx.hoodgap.calculateGap(PRICE_230, adjusted);
      expect(gap).to.equal(800n);
    });
  });
});
