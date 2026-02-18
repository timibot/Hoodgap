"use client";

import { useState, useEffect } from "react";

export interface SettlementTimeline {
  settlementWeek: number;
  fridayClose: Date;
  mondayOpen: Date;
  daysUntilClose: number;
  hoursUntilClose: number;
  isThisWeek: boolean;
  displayLabel: string;
  loading: boolean;
}

// Mirrors HoodGapMath.sol constants
const REFERENCE_WEEK = 1609770600;
const WEEK_SECONDS = 604800;
const WEEKEND_DURATION = 279000;

function getWeekNumber(timestamp: number): number {
  return Math.floor((timestamp - REFERENCE_WEEK) / WEEK_SECONDS);
}

function getMonday(weekNumber: number): number {
  return REFERENCE_WEEK + weekNumber * WEEK_SECONDS;
}

function getFriday(weekNumber: number): number {
  return getMonday(weekNumber) - WEEKEND_DURATION;
}

export function useSettlementTimeline(): SettlementTimeline {
  const [timeline, setTimeline] = useState<SettlementTimeline>({
    settlementWeek: 0,
    fridayClose: new Date(0),
    mondayOpen: new Date(0),
    daysUntilClose: 0,
    hoursUntilClose: 0,
    isThisWeek: false,
    displayLabel: "",
    loading: true,
  });

  useEffect(() => {
    function calculate() {
      const now = Math.floor(Date.now() / 1000);
      const currentWeek = getWeekNumber(now);
      const mondayThisWeek = getMonday(currentWeek);

      // Past Monday open → policies cover next weekend
      const isThisWeek = now < mondayThisWeek;
      const settlementWeek = isThisWeek ? currentWeek : currentWeek + 1;

      const fridayCloseTs = getFriday(settlementWeek);
      const mondayOpenTs = getMonday(settlementWeek);

      const fridayClose = new Date(fridayCloseTs * 1000);
      const mondayOpen = new Date(mondayOpenTs * 1000);

      const msUntilClose = fridayClose.getTime() - Date.now();
      const daysUntilClose = Math.max(0, Math.ceil(msUntilClose / (1000 * 60 * 60 * 24)));
      const hoursUntilClose = Math.max(0, Math.ceil(msUntilClose / (1000 * 60 * 60)));

      const dateOpts: Intl.DateTimeFormatOptions = { month: "short", day: "numeric" };
      const fridayStr = fridayClose.toLocaleDateString("en-US", dateOpts);
      const mondayStr = mondayOpen.toLocaleDateString("en-US", dateOpts);

      const displayLabel = isThisWeek
        ? `This Weekend (${fridayStr} – ${mondayStr})`
        : `Next Weekend (${fridayStr} – ${mondayStr})`;

      setTimeline({
        settlementWeek,
        fridayClose,
        mondayOpen,
        daysUntilClose,
        hoursUntilClose,
        isThisWeek,
        displayLabel,
        loading: false,
      });
    }

    calculate();
    const interval = setInterval(calculate, 60_000);
    return () => clearInterval(interval);
  }, []);

  return timeline;
}
