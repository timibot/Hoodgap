"use client";

import { usePremium } from "@/hooks/usePremium";
import { formatDollars } from "@/lib/formatting";
import LoadingSpinner from "@/components/shared/LoadingSpinner";

export default function PremiumQuote({ coverageUsd }: { coverageUsd: number }) {
  const { loading, amount, error } = usePremium(coverageUsd);
  if (coverageUsd <= 0) return null;

  return (
    <div className="space-y-1">
      <div className="text-xs text-muted uppercase tracking-wider">Premium</div>
      {loading ? (
        <LoadingSpinner size="sm" />
      ) : error ? (
        <div className="text-sm text-negative">{error}</div>
      ) : amount !== null ? (
        <>
          <div className="text-2xl font-bold font-mono">${amount.toFixed(2)}</div>
          <div className="text-xs text-muted">for {formatDollars(coverageUsd)} coverage</div>
        </>
      ) : null}
    </div>
  );
}
