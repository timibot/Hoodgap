"use client";

import { useState, useEffect } from "react";

export interface SettlementTimeline {
  settlementWeek: number;
  targetClose: Date;
  targetOpen: Date;
  daysUntilClose: number;
  hoursUntilClose: number;
  isGapActive: boolean;
  displayLabel: string;
  closeLabel: string;
  openLabel: string;
  loading: boolean;
}

// Mirrors HoodGapMath.sol logic strictly
const REFERENCE_WEEK_TS = 1609770600;
const WEEK_SECONDS = 604800;
const DAY_SECONDS = 86400;
const MARKET_CLOSE_OFFSET = 75600; // 21:00 UTC
const MARKET_OPEN_OFFSET = 52200;  // 14:30 UTC

function getWeekNumber(timestamp: number): number {
  return Math.floor((timestamp - REFERENCE_WEEK_TS) / WEEK_SECONDS);
}

function getMonday(weekNumber: number): number {
  return REFERENCE_WEEK_TS + (weekNumber * WEEK_SECONDS);
}

function getMarketClose(weekNumber: number, dayIndex: number): number {
  const mondayMidnight = getMonday(weekNumber) - MARKET_OPEN_OFFSET;
  return mondayMidnight + dayIndex * DAY_SECONDS + MARKET_CLOSE_OFFSET;
}

function getNextMarketOpen(weekNumber: number, dayIndex: number): number {
  if (dayIndex < 4) {
    const mondayMidnight = getMonday(weekNumber) - MARKET_OPEN_OFFSET;
    return mondayMidnight + (dayIndex + 1) * DAY_SECONDS + MARKET_OPEN_OFFSET;
  } else {
    return getMonday(weekNumber + 1);
  }
}

export function useSettlementTimeline(): SettlementTimeline {
  const [timeline, setTimeline] = useState<SettlementTimeline>({
    settlementWeek: 0,
    targetClose: new Date(0),
    targetOpen: new Date(0),
    daysUntilClose: 0,
    hoursUntilClose: 0,
    isGapActive: false,
    displayLabel: "",
    closeLabel: "Close",
    openLabel: "Open",
    loading: true,
  });

  useEffect(() => {
    function calculate() {
      const now = Math.floor(Date.now() / 1000);
      const weekNumber = getWeekNumber(now);

      let targetCloseTs = 0;
      let targetOpenTs = 0;
      let dayName = "";
      let nextDayName = "";

      const days = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"];
      const nextDays = ["Tuesday", "Wednesday", "Thursday", "Friday", "Monday"];

      for (let i = 0; i <= 4; i++) {
        const gapOpen = getNextMarketOpen(weekNumber, i);
        if (now < gapOpen) {
          targetCloseTs = getMarketClose(weekNumber, i);
          targetOpenTs = gapOpen;
          dayName = days[i];
          nextDayName = nextDays[i];
          break;
        }
      }

      const targetClose = new Date(targetCloseTs * 1000);
      const targetOpen = new Date(targetOpenTs * 1000);

      const msUntilClose = targetClose.getTime() - Date.now();
      const isGapActive = msUntilClose <= 0;
      
      const daysUntilClose = Math.max(0, Math.ceil(msUntilClose / (1000 * 60 * 60 * 24)));
      const hoursUntilClose = Math.max(0, Math.ceil(msUntilClose / (1000 * 60 * 60)));

      // If gap is tomorrow, say "Tomorrow" instead of "Tuesday"
      const currentDayOpts: Intl.DateTimeFormatOptions = { weekday: 'long' };
      const currentDayName = new Date().toLocaleDateString("en-US", currentDayOpts);
      
      let closeLabel = `${dayName} Close`;
      let openLabel = `${nextDayName} Open`;
      
      if (dayName === currentDayName) {
         closeLabel = `Today Close`;
         openLabel = `Tomorrow Open`; 
         if (dayName === "Friday") {
            openLabel = `Monday Open`;
         }
      } else {
         const tomorrow = new Date(Date.now() + 86400000).toLocaleDateString("en-US", currentDayOpts);
         if (dayName === tomorrow) {
            closeLabel = `Tomorrow Close`;
            if (dayName === "Friday") openLabel = `Monday Open`;
            else openLabel = `${nextDayName} Open`;
         }
      }

      const dateOpts: Intl.DateTimeFormatOptions = { month: "short", day: "numeric" };
      const closeStr = targetClose.toLocaleDateString("en-US", dateOpts);
      const openStr = targetOpen.toLocaleDateString("en-US", dateOpts);

      const displayLabel = isGapActive 
        ? `Gap Active (${closeStr} – ${openStr})`
        : `Upcoming Gap (${closeStr} – ${openStr})`;

      setTimeline({
        settlementWeek: weekNumber,
        targetClose,
        targetOpen,
        daysUntilClose,
        hoursUntilClose,
        isGapActive,
        displayLabel,
        closeLabel,
        openLabel,
        loading: false,
      });
    }

    calculate();
    const interval = setInterval(calculate, 60_000);
    return () => clearInterval(interval);
  }, []);

  return timeline;
}
