// SPDX-License-Identifier: MIT
pragma solidity 0.8.20;

/// @title HoodGapMath
/// @notice Pure math library for HoodGap protocol
library HoodGapMath {
    /// @dev Jan 4, 2021 14:30 UTC (Monday 9:30am EST)
    uint256 internal constant REFERENCE_WEEK = 1609770600;

    /// @dev Fri 4:00pm EST → Mon 9:30am EST = 279000 seconds
    uint256 internal constant WEEKEND_DURATION = 279000;

    uint256 internal constant WEEK_SECONDS = 604800;

    /// @notice Convert Unix timestamp to canonical week number
    /// @dev Week 0 = Jan 4, 2021. Increments every 604800 seconds.
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
        return getMonday(weekNumber) - WEEKEND_DURATION;
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

    /// @notice Time decay multiplier: 1 + (1.5% × hours since Friday close)
    /// @dev Returns 10000 (1.0x) during market hours or if oracle is fresh
    /// @return multiplier In basis points, capped at 25000 (2.5x)
    function getTimeDecayMultiplier(
        uint256 fridayCloseTime,
        uint256 mondayOpenTime,
        uint256 oracleUpdatedAt,
        uint256 currentTime,
        uint256 holidayOverride
    ) internal pure returns (uint256) {
        if (holidayOverride > 0) return holidayOverride;

        if (currentTime < fridayCloseTime || currentTime >= mondayOpenTime) {
            return 10000;
        }

        if (currentTime - oracleUpdatedAt < 1 hours) return 10000;

        uint256 hoursSinceClose = (currentTime - fridayCloseTime) / 1 hours;
        uint256 multiplier = 10000 + (hoursSinceClose * 150);

        return multiplier > 25000 ? 25000 : multiplier;
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
