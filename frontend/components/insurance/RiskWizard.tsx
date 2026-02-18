"use client";

import { useState } from "react";
import { useWeb3 } from "@/contexts/Web3Context";
import { useContract } from "@/hooks/useContract";
import { useApproval } from "@/hooks/useApproval";
import { useSettlementTimeline } from "@/hooks/useSettlement";
import { usePremium } from "@/hooks/usePremium";
import { calculateRisk, premiumPercent } from "@/lib/calculations";
import { formatDollars, toUSDC, fromUSDC, toBPS } from "@/lib/formatting";
import { validateCoverage, validatePosition } from "@/lib/validation";
import { THRESHOLD_OPTIONS, MAX_POLICY_COVERAGE } from "@/lib/constants";
import { showToast, updateToast } from "@/components/shared/TransactionToast";
import { parseTransactionError } from "@/lib/errors";
import LoadingSpinner from "@/components/shared/LoadingSpinner";

interface RiskWizardProps {
  onSuccess?: (policyId: number) => void;
}

export default function RiskWizard({ onSuccess }: RiskWizardProps) {
  const [position, setPosition] = useState<number | "">(""  );
  const [threshold, setThreshold] = useState(5);
  const [customCoverageMode, setCustomCoverageMode] = useState(false);
  const [customCoverage, setCustomCoverage] = useState(500);
  const [confirmNextWeek, setConfirmNextWeek] = useState(false);
  const [purchasing, setPurchasing] = useState(false);

  const numPosition = typeof position === "number" ? position : 0;
  const calculatedRisk = calculateRisk(numPosition, threshold);
  const effectiveCoverage = customCoverageMode ? customCoverage : calculatedRisk;

  const { status } = useWeb3();
  const { hoodgap, isReady } = useContract();
  const { ensureApproval, approving, approvalMode } = useApproval();
  const timeline = useSettlementTimeline();
  const premium = usePremium(effectiveCoverage);

  const positionValid = validatePosition(numPosition);
  const coverageValid = validateCoverage(effectiveCoverage);
  const canPurchase =
    isReady &&
    !purchasing &&
    !approving &&
    premium.amount !== null &&
    positionValid.valid &&
    coverageValid.valid &&
    (timeline.isThisWeek || confirmNextWeek);

  async function handlePurchase() {
    if (!canPurchase || !hoodgap || !premium.amountWei) return;

    setPurchasing(true);
    const toastId = showToast({
      type: "pending",
      title: "Purchasing Policy",
      message: "Requesting USDC approval...",
    });

    try {
      await ensureApproval(premium.amountWei);
      updateToast(toastId, { message: "Fetching fresh quote..." });

      const coverageWei = toUSDC(effectiveCoverage);
      const freshPremiumWei: bigint = await hoodgap.calculatePremium(coverageWei);
      const freshPremium = fromUSDC(freshPremiumWei);

      if (premium.amount && freshPremium - premium.amount > 5) {
        const confirmed = window.confirm(
          `Premium increased by $${(freshPremium - premium.amount).toFixed(2)}. Continue?`
        );
        if (!confirmed) {
          updateToast(toastId, { type: "error", title: "Cancelled", message: "Premium changed" });
          setPurchasing(false);
          return;
        }
      }

      updateToast(toastId, { message: "Confirm in wallet..." });
      const tx = await hoodgap.buyPolicy(coverageWei, toBPS(threshold));
      updateToast(toastId, { message: "Confirming...", txHash: tx.hash });

      const receipt = await tx.wait();
      const event = receipt.logs.find((log: any) => log.fragment?.name === "PolicyPurchased");
      const policyId = event ? Number(event.args?.policyId) : -1;

      updateToast(toastId, {
        type: "success",
        title: "Policy purchased",
        message: `#${policyId} — ${formatDollars(effectiveCoverage)} coverage`,
        txHash: tx.hash,
      });

      onSuccess?.(policyId);
    } catch (err: any) {
      updateToast(toastId, {
        type: "error",
        title: "Failed",
        message: parseTransactionError(err),
      });
    } finally {
      setPurchasing(false);
    }
  }

  return (
    <div className="space-y-5">
      {/* Timeline */}
      {!timeline.loading && (
        <div className={`p-4 border rounded-lg text-sm ${timeline.isThisWeek ? "" : "bg-surface-alt"}`}>
          <div className="font-semibold">
            {timeline.isThisWeek ? "Coverage: This Weekend" : "Coverage: Next Weekend"}
          </div>
          <div className="text-muted text-xs mt-1">{timeline.displayLabel}</div>
        </div>
      )}

      {/* Position */}
      <div className="space-y-2">
        <label className="text-sm font-medium">Position Value</label>
        <div className="relative">
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted text-sm">$</span>
          <input
            type="number"
            value={position}
            onChange={(e) => {
              const val = e.target.value;
              setPosition(val === "" ? "" : Number(val));
            }}
            className="input-field pl-7"
            placeholder="Enter your position value"
          />
        </div>
        {!positionValid.valid && (
          <p className="text-xs text-negative">{positionValid.error}</p>
        )}
      </div>

      {/* Threshold */}
      <div className="space-y-2">
        <label className="text-sm font-medium">Gap Threshold</label>
        <div className="grid grid-cols-4 gap-2">
          {THRESHOLD_OPTIONS.map((t) => (
            <button
              key={t}
              onClick={() => setThreshold(t)}
              className={threshold === t ? "pill-active" : "pill-inactive"}
            >
              -{t}%
            </button>
          ))}
        </div>
      </div>

      {/* Risk */}
      <div className="border-t border-b py-4 space-y-1">
        <div className="text-xs text-muted uppercase tracking-wider">Weekend Risk</div>
        <div className="text-2xl font-bold font-mono">
          {formatDollars(calculatedRisk)}
        </div>
        <div className="text-xs text-muted">
          -{threshold}% of {formatDollars(numPosition)}
        </div>
      </div>

      {/* Premium */}
      <div className="space-y-1">
        <div className="text-xs text-muted uppercase tracking-wider">Premium</div>
        {premium.loading ? (
          <LoadingSpinner size="sm" text="Calculating..." />
        ) : premium.error ? (
          <div className="text-sm text-negative">{premium.error}</div>
        ) : premium.amount !== null ? (
          <>
            <div className="text-2xl font-bold font-mono">
              ${premium.amount.toFixed(2)}
            </div>
            <div className="text-xs text-muted">
              {premiumPercent(premium.amount, effectiveCoverage).toFixed(2)}% of coverage (10% base rate · utilization adjusted)
            </div>
          </>
        ) : null}
      </div>

      {/* Next-week confirmation */}
      {!timeline.loading && !timeline.isThisWeek && (
        <label className="flex items-start gap-3 p-3 border rounded-lg cursor-pointer hover:bg-surface-alt transition-colors">
          <input
            type="checkbox"
            checked={confirmNextWeek}
            onChange={(e) => setConfirmNextWeek(e.target.checked)}
            className="mt-0.5 accent-fg"
          />
          <div className="text-sm">
            <span className="font-semibold">I understand this covers next weekend</span>
            <br />
            <span className="text-muted text-xs">{timeline.daysUntilClose} days away</span>
          </div>
        </label>
      )}

      {/* Purchase */}
      <button onClick={handlePurchase} disabled={!canPurchase} className="btn-primary">
        {status !== "connected"
          ? "Connect Wallet"
          : purchasing || approving
          ? approving ? "Approving..." : "Purchasing..."
          : "Buy Insurance"}
      </button>

      {/* Advanced */}
      <details className="text-sm">
        <summary className="cursor-pointer text-muted hover:text-fg transition-colors">
          Custom coverage amount
        </summary>
        <div className="mt-3 space-y-2 pl-1">
          <label className="flex items-center gap-2 text-muted text-xs">
            <input
              type="checkbox"
              checked={customCoverageMode}
              onChange={(e) => setCustomCoverageMode(e.target.checked)}
              className="accent-fg"
            />
            Override recommended coverage
          </label>
          {customCoverageMode && (
            <>
              <input
                type="number"
                value={customCoverage}
                onChange={(e) => setCustomCoverage(Number(e.target.value))}
                className="input-field"
              />
              {!coverageValid.valid && (
                <p className="text-xs text-negative">{coverageValid.error}</p>
              )}
            </>
          )}
        </div>
      </details>

      <div className="text-xs text-center text-muted">
        {approvalMode} approval · <a href="/settings" className="underline hover:text-fg">Settings</a>
      </div>
    </div>
  );
}
