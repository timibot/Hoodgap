// SPDX-License-Identifier: MIT
pragma solidity 0.8.20;

/// @title HoodGapMath
/// @notice Pure math library for HoodGap all-gap insurance protocol
library HoodGapMath {
    /// @dev Jan 6, 2021 14:30 UTC (Monday 9:30am EST) — reference week start
    uint256 internal constant REFERENCE_WEEK = 1609940200;

    uint256 internal constant WEEK_SECONDS = 604800;
    uint256 internal constant DAY_SECONDS = 86400;

    /// @dev Market close = 21:00 UTC (4:00pm EST)
    uint256 internal constant MARKET_CLOSE_OFFSET = 75600; // 21 hours from midnight UTC

    /// @dev Market open = 14:30 UTC (9:30am EST)
    uint256 internal constant MARKET_OPEN_OFFSET = 52200; // 14.5 hours from midnight UTC

    /// @notice Convert Unix timestamp to canonical week number
    /// @dev Week 0 = Jan 6, 2021. Increments every 604800 seconds.
    function getWeekNumber(uint256 timestamp) internal pure returns (uint256) {
        require(timestamp >= REFERENCE_WEEK, "Before reference date");
        return (timestamp - REFERENCE_WEEK) / WEEK_SECONDS;
    }

    /// @notice Get Monday 9:30am EST (14:30 UTC) for a given week
    function getMonday(uint256 weekNumber) internal pure returns (uint256) {
        return REFERENCE_WEEK + (weekNumber * WEEK_SECONDS);
    }

    /// @notice Get Friday 4:00pm EST (21:00 UTC) for a given week
    function getFriday(uint256 weekNumber) internal pure returns (uint256) {
        // Friday is 4 days after Monday start, plus market close offset
        return
            REFERENCE_WEEK + (weekNumber * WEEK_SECONDS) + (4 * DAY_SECONDS) + MARKET_CLOSE_OFFSET - MARKET_OPEN_OFFSET;
    }

    /// @notice Get the market close timestamp for a specific day within a week
    /// @param weekNumber The canonical week number
    /// @param dayIndex 0=Monday, 1=Tuesday, 2=Wednesday, 3=Thursday, 4=Friday
    /// @return closeTime Unix timestamp for 4:00pm EST (21:00 UTC) on that day
    function getMarketClose(uint256 weekNumber, uint256 dayIndex) internal pure returns (uint256) {
        require(dayIndex <= 4, "dayIndex must be 0-4");
        uint256 mondayMidnight = REFERENCE_WEEK + (weekNumber * WEEK_SECONDS) - MARKET_OPEN_OFFSET;
        return mondayMidnight + (dayIndex * DAY_SECONDS) + MARKET_CLOSE_OFFSET;
    }

    /// @notice Get the next market open after a given close
    /// @param weekNumber The canonical week number
    /// @param dayIndex 0=Monday close -> Tuesday open, ... 4=Friday close -> next Monday open
    /// @return openTime Unix timestamp for the next market open (9:30am EST / 14:30 UTC)
    function getNextMarketOpen(uint256 weekNumber, uint256 dayIndex) internal pure returns (uint256) {
        require(dayIndex <= 4, "dayIndex must be 0-4");
        if (dayIndex < 4) {
            // Mon-Thu: next day open = close day + 1 at 9:30am EST
            uint256 mondayMidnight = REFERENCE_WEEK + (weekNumber * WEEK_SECONDS) - MARKET_OPEN_OFFSET;
            return mondayMidnight + ((dayIndex + 1) * DAY_SECONDS) + MARKET_OPEN_OFFSET;
        } else {
            // Friday: next Monday open
            return getMonday(weekNumber + 1);
        }
    }

    /// @notice Calculate percentage gap between two prices in basis points
    /// @param priceA First price (8 decimals)
    /// @param priceB Second price (8 decimals) - used as denominator
    /// @return gap Gap in basis points (10000 = 100%)
    function calculateGap(uint256 priceA, uint256 priceB) internal pure returns (uint256) {
        require(priceA > 0 && priceB > 0, "Prices must be positive");
        uint256 diff = priceA > priceB ? priceA - priceB : priceB - priceA;
        return (diff * 10000) / priceB;
    }

    /// @notice Utilization multiplier: 1 + 0.5U + 0.5U² (linear-quadratic blend)
    /// @dev Gentler ramp than pure quadratic — keeps premiums reasonable at moderate utilization
    /// @return multiplier In basis points (10000 = 1.0x)
    function getUtilizationMultiplier(
        uint256 totalCoverage,
        uint256 newCoverage,
        uint256 totalStaked
    ) internal pure returns (uint256) {
        if (totalStaked == 0) return 10000;

        uint256 utilization = ((totalCoverage + newCoverage) * 10000) / totalStaked;
        if (utilization > 9500) utilization = 9500;

        uint256 linearPart = utilization / 2; // 0.5U
        uint256 quadraticPart = (utilization * utilization) / 20000; // 0.5U²
        return 10000 + linearPart + quadraticPart;
    }

    /// @notice Volatility multiplier: σ_current / σ_average
    /// @return multiplier In basis points (10000 = 1.0x)
    function getVolatilityMultiplier(uint256 currentVolatility, uint256 avgVolatility) internal pure returns (uint256) {
        return (currentVolatility * 10000) / avgVolatility;
    }

    /// @notice Calculate binary payout: full coverage if gap >= threshold, else 0
    /// @param coverage Full coverage amount (USDC, 6 decimals)
    /// @param gap Actual gap in basis points
    /// @param threshold Policy threshold in basis points
    /// @return payout Amount to pay out (USDC, 6 decimals)
    function calculatePayout(uint256 coverage, uint256 gap, uint256 threshold) internal pure returns (uint256) {
        return gap >= threshold ? coverage : 0;
    }
}
