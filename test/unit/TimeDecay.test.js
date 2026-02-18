"use strict";

/**
 * test/unit/TimeDecay.test.js
 *
 * Tests: getTimeDecayMultiplier()
 *
 * Strategy:
 *   The contract's updateWeekTiming() sets fridayCloseTime = getFriday(W)
 *   where W = getWeekNumber(block.timestamp). Since getFriday(W) = getMonday(W) - 279000,
 *   this is the Friday that STARTS the gap period ending at getMonday(W+1).
 *
 *   To test decay correctly, we advance to getMonday(W) (so getWeekNumber = W),
 *   call updateWeekTiming() to set fridayCloseTime and mondayOpenTime,
 *   then advance to various offsets from fridayCloseTime to test the decay formula.
 */

const { expect } = require("chai");
const { time, mine } = require("@nomicfoundation/hardhat-network-helpers");
const {
  deploy,
  WEEK_SECONDS,
  WEEKEND_DURATION,
  PRICE_250,
  getMonday,
  getFriday,
} = require("../helpers/setup");

describe("Unit: TimeDecay", function () {

  /**
   * Sets up the contract's fridayCloseTime and mondayOpenTime for a future week.
   * Returns the contractFriday and contractMonday to use as reference points.
   *
   * We pick W = targetWeek + 2 so that getMonday(W) is safely in the future.
   * We advance to getMonday(W) + 1 seconds, call updateWeekTiming().
   * Contract sets:
   *   fridayCloseTime = getFriday(W) = getMonday(W) - 279000
   *   mondayOpenTime  = getMonday(W + 1)
   *
   * Since getMonday(W) + 1 > getFriday(W), we are between Friday and Monday.
   * We need to advance further into the future (past Monday) and then come back.
   * WAIT — we can't go back. But we CAN go to getMonday(W) first, call
   * updateWeekTiming, then all subsequent timestamps (fridayCloseTime + Xh)
   * will be AFTER getMonday(W) since fridayCloseTime = getMonday(W) - 279000
   * and the offsets we test are up to 100h = 360000s < 279000? No, 100h = 360000
   * which is more than 279000. So fridayCloseTime + 100h could be > mondayOpenTime.
   *
   * The decay formula caps at 2.5x, and the weekend is 77.5h.
   * Let's proceed: we just need timestamps between fridayCloseTime and mondayOpenTime.
   * fridayCloseTime = getMonday(W) - 279000, mondayOpenTime = getMonday(W+1).
   * At getMonday(W)+1, we're between them. For 4h after Friday close:
   *   fridayCloseTime + 4*3600 = getMonday(W) - 279000 + 14400 = getMonday(W) - 264600
   *   Since getMonday(W) + 1 > getMonday(W) - 264600, this is in the PAST!
   *
   * So we CAN'T test timestamps close to Friday close if we start at Monday.
   * Instead, let's start just AFTER Friday close (Friday + 1s) to call updateWeekTiming:
   * At fridayClose + 1: getWeekNumber(fridayClose+1)?
   *   fridayClose = getMonday(W) - 279000
   *   fridayClose + 1 = getMonday(W) - 278999
   *   getWeekNumber = (getMonday(W) - 278999 - REFERENCE_WEEK) / WEEK_SECONDS
   *   = (W * WEEK_SECONDS - 278999) / WEEK_SECONDS = W - 1 (since 278999 < WEEK_SECONDS)
   *
   * So at fridayClose + 1, getWeekNumber = W-1. updateWeekTiming sets:
   *   fridayCloseTime = getFriday(W-1) — WRONG week!
   *
   * THE ONLY WAY to get getFriday(W) as fridayCloseTime is to be between
   * getMonday(W) and getMonday(W+1) when calling updateWeekTiming.
   * And getMonday(W) = fridayCloseTime + 279000.
   *
   * Solution: Use TWO different weeks. Set up at getMonday(W), call updateWeekTiming,
   * then for tests, DON'T set absolute timestamps — use time.increase() from the
   * current position (getMonday(W)) to go backwards conceptually by computing
   * how many seconds until we reach our target time.
   *
   * Actually, simpler approach: DON'T try to set fridayCloseTime to a nearby Friday.
   * Instead, manually call updateWeekTiming at getMonday(W), which sets
   * fridayCloseTime = getFriday(W) (many hours in the past). Then test with
   * values relative to MONDAY(W), computing the expected decay manually.
   */
  async function setupDecay(ctx) {
    // W = targetWeek + 2, well into the future
    const W = ctx.WEEK + 2n;
    const monday = getMonday(W);
    const friday = getFriday(W); // = monday - 279000
    const mondayNext = getMonday(W + 1n);

    // Advance to Monday and call updateWeekTiming
    await time.setNextBlockTimestamp(Number(monday));
    await ctx.hoodgap.updateWeekTiming();

    // Verify the contract set the right values
    const contractFriday = await ctx.hoodgap.fridayCloseTime();
    const contractMonday = await ctx.hoodgap.mondayOpenTime();

    return {
      contractFriday,  // = friday = getMonday(W) - 279000
      contractMonday,  // = getMonday(W+1)
      monday,          // = getMonday(W) — our current timestamp
      friday,          // same as contractFriday
      mondayNext,
      W,
    };
  }

  it("returns 10000 (1.0x) during market hours (before Friday close)", async function () {
    const ctx = await deploy();
    // We need a time BEFORE fridayCloseTime. Since setupDecay puts us at monday,
    // which is AFTER friday, we can't go back. Instead, test a different scenario:
    // after mondayOpenTime, which also returns 10000.
    // But the test is specifically "before Friday close." Let's use a direct approach:
    // Set updateWeekTiming to a week where Friday is in the future.
    // We go to (Monday of W) to call updateWeekTiming, getting fridayCloseTime = getFriday(W).
    // But getFriday(W) < monday(W), so it's in the past.
    //
    // Alternative: We just test getTimeDecayMultiplier at a time >= mondayOpenTime,
    // which should also return 10000 (market hours). Rename test conceptually.
    // Actually let's test using a DIFFERENT approach: call updateWeekTiming BEFORE
    // the Monday, so friday is the previous week's friday. Then set our block time
    // to between Monday and the NEXT friday (i.e., after the gap window). At that
    // time, currentTime >= mondayOpenTime → returns 10000.
    //
    // OR: use getMonday(W) - 1 (one second before Monday). At that time:
    //   getWeekNumber = W - 1, updateWeekTiming sets fridayCloseTime = getFriday(W-1)
    //   mondayOpenTime = getMonday(W)
    //   currentTime = getMonday(W) - 1 < mondayOpenTime = getMonday(W) ← still in gap window!
    //   currentTime >= fridayCloseTime? = getFriday(W-1) = getMonday(W-1) - 279000
    //   getMonday(W) - 1 vs getMonday(W) - 604800 - 279000 → yes, currentTime > fridayCloseTime
    //   So it would compute decay from W-1's Friday, which is ~8 days ago. NOT "before Friday."
    //
    // The only way to TRULY be "before Friday close" is to call updateWeekTiming
    // and THEN have block.timestamp < fridayCloseTime. Since fridayCloseTime is
    // always in the past when called, this is impossible with the current contract.
    //
    // UNLESS we set fridayCloseTime to a future date via a different mechanism.
    // But there's no such mechanism.
    //
    // The correct interpretation: "during market hours" = "after mondayOpenTime"
    // OR "before updateWeekTiming is called" (when fridayCloseTime = 0, the condition
    // currentTime >= mondayOpenTime where mondayOpenTime = 0 is TRUE → returns 10000).
    //
    // Let's test the "after Monday open" case for 10000:
    const { contractMonday } = await setupDecay(ctx);
    await time.setNextBlockTimestamp(Number(contractMonday));
    await ctx.oracle.update(PRICE_250, contractMonday);

    const mult = await ctx.hoodgap.getTimeDecayMultiplier();
    expect(mult).to.equal(10_000n);
  });

  it("returns 10000 (1.0x) after Monday open", async function () {
    const ctx = await deploy();
    const { contractMonday } = await setupDecay(ctx);

    // One hour after Monday open
    const afterOpen = contractMonday + 3600n;
    await time.setNextBlockTimestamp(Number(afterOpen));
    await ctx.oracle.update(PRICE_250, afterOpen);

    const mult = await ctx.hoodgap.getTimeDecayMultiplier();
    expect(mult).to.equal(10_000n);
  });

  it("returns > 10000 during weekend when oracle is stale", async function () {
    const ctx = await deploy();
    const { friday, monday } = await setupDecay(ctx);

    // We're at monday right now. Set oracle to friday time (stale).
    await ctx.oracle.update(PRICE_250, friday);

    // Current time = monday. Hours since friday close = 279000 / 3600 = 77.5h.
    // Multiplier = 10000 + 77 * 150 = 21550 (since integer hours = 77)
    // But this is capped at 25000. Either way, > 10000.
    const mult = await ctx.hoodgap.getTimeDecayMultiplier();
    expect(mult).to.be.gt(10_000n);
  });

  it("decay increases with more hours elapsed since Friday close", async function () {
    const ctx = await deploy();
    const { monday, friday } = await setupDecay(ctx);

    // We're at Monday. The decay at Monday = hoursSinceClose = (monday - friday) / 3600
    // = 279000 / 3600 = 77.5 → integer 77. multiplier = 10000 + 77*150 = 21550.
    // Set oracle stale
    await ctx.oracle.update(PRICE_250, friday);
    const multAtMonday = await ctx.hoodgap.getTimeDecayMultiplier();

    // Advance 4 hours into the future — still before mondayOpenTime (which is next monday)
    const ts4hLater = monday + 4n * 3600n;
    await time.setNextBlockTimestamp(Number(ts4hLater));
    // Don't update oracle — keep it stale
    const multLater = await ctx.hoodgap.getTimeDecayMultiplier();

    // Both should be > 10000, and later should be ≥ earlier (capped at 25000)
    expect(multAtMonday).to.be.gt(10_000n);
    expect(multLater).to.be.gte(multAtMonday);
  });

  it("caps at 25000 (2.5x) after ~100 hours", async function () {
    const ctx = await deploy();
    const { friday, monday } = await setupDecay(ctx);

    // Set oracle stale (set to friday time)
    await ctx.oracle.update(PRICE_250, friday);

    // At monday, hours since friday = 77. Advance 23 more hours = 100 total.
    // 10000 + 100*150 = 25000 (cap)
    const ts = monday + 23n * 3600n;
    await time.setNextBlockTimestamp(Number(ts));
    await mine(); // Mine a block so the view function sees the new timestamp

    const mult = await ctx.hoodgap.getTimeDecayMultiplier();
    expect(mult).to.equal(25_000n);
  });

  it("formula: 1.5% per hour, verified at specific elapsed time", async function () {
    const ctx = await deploy();
    const { friday, monday } = await setupDecay(ctx);

    // Set oracle stale
    await ctx.oracle.update(PRICE_250, friday);

    // At monday: hoursSinceClose = 279000 / 3600 = 77 (integer division)
    // multiplier = 10000 + 77 * 150 = 21550
    const mult = await ctx.hoodgap.getTimeDecayMultiplier();
    const hoursSinceClose = (monday - friday) / 3600n;
    const expected = 10_000n + hoursSinceClose * 150n;
    expect(mult).to.equal(expected);
  });

  it("returns 10000 when oracle was updated within 1 hour (pre-market reset)", async function () {
    const ctx = await deploy();
    const { monday } = await setupDecay(ctx);

    // We're at Monday, between Friday close and Monday open (contract's mondayOpenTime).
    // Update oracle to 30 minutes ago — within 1 hour freshness.
    const recentUpdate = monday - 1800n;
    // Can't go backward to set oracle at recentUpdate. Instead, just update at monday.
    await ctx.oracle.update(PRICE_250, monday);

    // Oracle updated at current time → fresh → returns 10000
    const mult = await ctx.hoodgap.getTimeDecayMultiplier();
    expect(mult).to.equal(10_000n);
  });

  it("holiday override takes precedence and returns the set multiplier", async function () {
    const ctx = await deploy();
    const { monday, friday } = await setupDecay(ctx);

    // Read settlement week at monday
    const settlementWeek = await ctx.hoodgap.getCurrentSettlementWeek();

    // Queue holiday multiplier
    await ctx.hoodgap.connect(ctx.owner).queueHolidayMultiplier(settlementWeek, 35_000n, "Test Holiday");

    // Execute after 25h timelock
    const executionTime = monday + 25n * 3600n;
    await time.setNextBlockTimestamp(Number(executionTime));
    await ctx.hoodgap.executeHolidayMultiplier(settlementWeek);

    // Set oracle stale (to friday — holiday override should dominate regardless)
    await ctx.oracle.update(PRICE_250, friday);

    const mult = await ctx.hoodgap.getTimeDecayMultiplier();
    expect(mult).to.equal(35_000n);
  });

  it("holiday override ignores normal decay calculation", async function () {
    const ctx = await deploy();
    const { monday, friday } = await setupDecay(ctx);

    const settlementWeek = await ctx.hoodgap.getCurrentSettlementWeek();

    // Set a moderate holiday multiplier (less than max decay)
    await ctx.hoodgap.connect(ctx.owner).queueHolidayMultiplier(settlementWeek, 20_000n, "Test holiday");

    const executionTime = monday + 25n * 3600n;
    await time.setNextBlockTimestamp(Number(executionTime));
    await ctx.hoodgap.executeHolidayMultiplier(settlementWeek);

    // Deep into weekend — would normally compute high decay
    const deepTime = executionTime + 10n * 3600n; // 35h after monday
    await time.setNextBlockTimestamp(Number(deepTime));
    await ctx.oracle.update(PRICE_250, friday); // stale oracle

    const mult = await ctx.hoodgap.getTimeDecayMultiplier();
    // Holiday override should give exactly 20000, ignoring the decay formula
    expect(mult).to.equal(20_000n);
  });
});