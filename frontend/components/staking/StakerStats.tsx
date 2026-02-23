"use client";

import { usePoolStats } from "@/hooks/useStaker";
import { formatDollars } from "@/lib/formatting";
import LoadingSpinner from "@/components/shared/LoadingSpinner";

export default function StakerStats() {
  const { stats, loading } = usePoolStats();

  if (loading) return <LoadingSpinner text="Loading..." />;
  if (!stats) return null;

  const items = [
    { label: "Total Staked", value: formatDollars(stats.totalStaked) },
    { label: "Total Coverage", value: formatDollars(stats.totalCoverage) },
    { label: "Free Liquidity", value: formatDollars(stats.freeLiquidity) },
    { label: "Utilization", value: `${stats.utilization.toFixed(2)}%` },
    { label: "Reserve", value: formatDollars(stats.reserveBalance) },
    { label: "Policies", value: stats.policyCount.toString() },
  ];

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
      {items.map((item) => (
        <div key={item.label} className="border rounded-lg p-3">
          <div className="text-xs text-muted">{item.label}</div>
          <div className="font-bold font-mono mt-0.5">{item.value}</div>
        </div>
      ))}
    </div>
  );
}
