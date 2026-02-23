"use client";

import { useState } from "react";
import { formatDollars, formatDate } from "@/lib/formatting";
import type { PolicyDisplay } from "@/types/policy";
import TransferModal from "./TransferModal";

const STATUS_LABELS = {
  active: "Active",
  "settled-paid": "Paid",
  "settled-nopay": "No Gap",
  expired: "Expired",
};

/** Convert canonical gapWeek (weeks since Jan 6 2021) to ISO week-of-year */
function toCalendarWeek(canonicalWeek: number): string {
  // Reference: Jan 6, 2021 14:30 UTC = week 0
  const REFERENCE_EPOCH = 1609940200;
  const WEEK_SECONDS = 604800;
  const timestamp = REFERENCE_EPOCH + canonicalWeek * WEEK_SECONDS;
  const date = new Date(timestamp * 1000);

  // ISO week number calculation
  const jan1 = new Date(date.getFullYear(), 0, 1);
  const dayOfYear = Math.floor((date.getTime() - jan1.getTime()) / 86400000) + 1;
  const weekNum = Math.ceil((dayOfYear + jan1.getDay()) / 7);
  return `Week ${weekNum}`;
}

export default function PolicyCard({ policy }: { policy: PolicyDisplay }) {
  const [showTransfer, setShowTransfer] = useState(false);

  return (
    <>
      <div className="border rounded-lg p-4 hover:border-border-dark transition-colors">
        <div className="flex items-start justify-between">
          <div>
            <div className="font-semibold flex items-center gap-2">
              Policy #{policy.id}
              {policy.subscriptionPosition && (
                <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-surface-alt text-muted border">
                  {policy.subscriptionPosition}
                </span>
              )}
            </div>
            <div className="text-xs text-muted">
              {toCalendarWeek(policy.settlementWeek)} · {formatDate(policy.purchaseDate)}
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

        {policy.status === "active" && (
          <button
            onClick={() => setShowTransfer(true)}
            className="mt-3 w-full text-xs py-1.5 border rounded hover:bg-surface-alt transition-colors text-muted hover:text-fg"
          >
            Transfer Policy
          </button>
        )}
      </div>

      {showTransfer && (
        <TransferModal
          policy={policy}
          onClose={() => setShowTransfer(false)}
        />
      )}
    </>
  );
}

