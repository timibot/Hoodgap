"use client";

import { formatDollars, formatDate } from "@/lib/formatting";
import type { PolicyDisplay } from "@/types/policy";

const STATUS_LABELS = {
  active: "Active",
  "settled-paid": "Paid",
  "settled-nopay": "No Gap",
  expired: "Expired",
};

export default function PolicyCard({ policy }: { policy: PolicyDisplay }) {
  return (
    <div className="border rounded-lg p-4 hover:border-border-dark transition-colors">
      <div className="flex items-start justify-between">
        <div>
          <div className="font-semibold">Policy #{policy.id}</div>
          <div className="text-xs text-muted">
            Week {policy.settlementWeek} · {formatDate(policy.purchaseDate)}
          </div>
        </div>
        <span className={`text-xs font-semibold ${
          policy.status === "active" ? "text-positive" : "text-muted"
        }`}>
          {STATUS_LABELS[policy.status]}
        </span>
      </div>

      <div className="grid grid-cols-3 gap-4 mt-3 pt-3 border-t">
        <div>
          <div className="text-xs text-muted">Coverage</div>
          <div className="font-bold font-mono">{formatDollars(policy.coverageUsd)}</div>
        </div>
        <div>
          <div className="text-xs text-muted">Threshold</div>
          <div className="font-bold font-mono">-{policy.thresholdPercent}%</div>
        </div>
        <div>
          <div className="text-xs text-muted">Premium</div>
          <div className="font-bold font-mono">${policy.premiumUsd.toFixed(2)}</div>
        </div>
      </div>
    </div>
  );
}
