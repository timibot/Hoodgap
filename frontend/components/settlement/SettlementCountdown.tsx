"use client";

import { useSettlementTimeline } from "@/hooks/useSettlement";
import { formatDateTime } from "@/lib/formatting";
import LoadingSpinner from "@/components/shared/LoadingSpinner";

export default function SettlementCountdown() {
  const timeline = useSettlementTimeline();
  if (timeline.loading) return <LoadingSpinner size="sm" />;

  return (
    <div className="border rounded-lg p-4 space-y-3">
      <div className="font-semibold text-sm">Settlement Window</div>
      <div className="grid grid-cols-2 gap-4">
        <div>
          <div className="text-xs text-muted">Friday Close</div>
          <div className="text-sm font-mono mt-0.5">{formatDateTime(timeline.fridayClose)}</div>
        </div>
        <div>
          <div className="text-xs text-muted">Monday Open</div>
          <div className="text-sm font-mono mt-0.5">{formatDateTime(timeline.mondayOpen)}</div>
        </div>
      </div>
      <div className="text-xs text-muted border-t pt-2">
        {timeline.displayLabel}
        {timeline.hoursUntilClose > 0 &&
          ` · ${timeline.daysUntilClose > 0 ? `${timeline.daysUntilClose}d` : `${timeline.hoursUntilClose}h`} until coverage`}
      </div>
    </div>
  );
}
