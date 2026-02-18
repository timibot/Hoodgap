"use client";

import StakerStats from "@/components/staking/StakerStats";
import SettlementCountdown from "@/components/settlement/SettlementCountdown";
import { usePoolStats } from "@/hooks/useStaker";
import { formatDollars } from "@/lib/formatting";

export default function DashboardPage() {
  const { stats } = usePoolStats();

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-xl font-bold">Dashboard</h1>
        <p className="text-sm text-muted mt-1">Pool analytics</p>
      </div>

      <StakerStats />
      <SettlementCountdown />

      {stats && (
        <div className="space-y-3">
          <h2 className="text-sm font-semibold text-muted uppercase tracking-wider">
            Utilization
          </h2>
          <div className="h-2 bg-surface-alt rounded-full overflow-hidden">
            <div
              className="h-full bg-fg rounded-full transition-all duration-500"
              style={{ width: `${Math.min(stats.utilization, 100)}%` }}
            />
          </div>
          <div className="flex justify-between text-xs text-muted">
            <span>0%</span>
            <span className="font-mono font-semibold text-fg">{stats.utilization.toFixed(1)}%</span>
            <span>100%</span>
          </div>
          <div className="grid grid-cols-2 gap-3 pt-2">
            <div className="border rounded-lg p-3">
              <div className="text-xs text-muted">Locked</div>
              <div className="font-bold font-mono">{formatDollars(stats.totalCoverage)}</div>
            </div>
            <div className="border rounded-lg p-3">
              <div className="text-xs text-muted">Available</div>
              <div className="font-bold font-mono">{formatDollars(stats.freeLiquidity)}</div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
