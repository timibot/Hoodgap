"use client";

import { useState, useRef } from "react";
import { useWeb3 } from "@/contexts/Web3Context";
import { useContract } from "@/hooks/useContract";
import { useApproval } from "@/hooks/useApproval";
import { usePremium, refreshOracle } from "@/hooks/usePremium";
import { calculateRisk, premiumPercent } from "@/lib/calculations";
import { formatDollars, toUSDC } from "@/lib/formatting";
import { validateCoverage, validatePosition } from "@/lib/validation";
import { THRESHOLD_OPTIONS, PLAN_OPTIONS, GAPS_PER_WEEK } from "@/lib/constants";
import { showToast, updateToast } from "@/components/shared/TransactionToast";
import { parseTransactionError } from "@/lib/errors";
import LoadingSpinner from "@/components/shared/LoadingSpinner";
import PlanSelector from "@/components/insurance/PlanSelector";
import InfoTooltip from "@/components/shared/InfoTooltip";

interface RiskWizardProps {
  onSuccess?: (policyId: number) => void;
}

export default function RiskWizard({ onSuccess }: RiskWizardProps) {
  const [position, setPosition] = useState<number | "">("");
  const [thresholdBps, setThresholdBps] = useState(500); // default: -5%
  const [customCoverageMode, setCustomCoverageMode] = useState(false);
  const [customCoverage, setCustomCoverage] = useState(500);
  const [purchasing, setPurchasing] = useState(false);
  const [planWeeks, setPlanWeeks] = useState(1);

  // Ref used to blur all inputs before purchase
  const formRef = useRef<HTMLDivElement>(null);

  const numPosition = typeof position === "number" ? position : 0;
  const thresholdPct = thresholdBps / 100;
  const calculatedRisk = calculateRisk(numPosition, thresholdPct);
  const effectiveCoverage = customCoverageMode ? customCoverage : calculatedRisk;

  const { status, signer } = useWeb3();
  const { hoodgap, isReady } = useContract();
  const { ensureApproval, approving, approvalMode } = useApproval();
  const premium = usePremium(effectiveCoverage, thresholdBps);

  // Plan discount
  const selectedPlan = PLAN_OPTIONS.find(p => p.weeks === planWeeks) || PLAN_OPTIONS[0];
  const discountBps = selectedPlan.discount;
  const discountPct = discountBps / 100;
  const discountedPremium = premium.amount !== null && discountBps > 0
    ? premium.amount * (1 - discountBps / 10000)
    : premium.amount;
  const totalPremium = discountedPremium !== null ? discountedPremium * planWeeks : null;
  const totalPremiumWei = premium.amountWei && planWeeks > 1
    ? (premium.amountWei - (premium.amountWei * BigInt(discountBps)) / 10000n) * BigInt(planWeeks)
    : premium.amountWei;
  const totalNfts = planWeeks * GAPS_PER_WEEK;

  const positionValid = validatePosition(numPosition);
  const coverageValid = validateCoverage(effectiveCoverage);
  const canPurchase = isReady && !purchasing && !approving && premium.amount !== null && !premium.loading && positionValid.valid && coverageValid.valid;

  async function handlePurchase() {
    if (!canPurchase || !hoodgap || !premium.amountWei) return;

    // Blur all inputs so final values are committed
    if (document.activeElement instanceof HTMLElement) {
      document.activeElement.blur();
    }
    // Small delay to let React process blur-triggered state changes
    await new Promise(r => setTimeout(r, 50));

    setPurchasing(true);
    const toastId = showToast({
      type: "pending",
      title: "Purchasing Policy",
      message: "Refreshing oracle...",
    });

    try {
      // Refresh oracle once (not on every keystroke)
      await refreshOracle(signer);

      const approvalAmount = planWeeks === 1 ? premium.amountWei! : totalPremiumWei!;
      updateToast(toastId, { message: "Requesting USDC approval..." });
      await ensureApproval(approvalAmount);

      updateToast(toastId, { message: "Confirm in wallet..." });

      const coverageWei = toUSDC(effectiveCoverage);

      let tx;
      if (planWeeks === 1) {
        // Weekly = single buyPolicy (covers current week, Fri→Mon gap)
        tx = await hoodgap["buyPolicy(uint256,uint256)"](coverageWei, BigInt(thresholdBps));
      } else {
        tx = await hoodgap.buySubscription(coverageWei, BigInt(thresholdBps), BigInt(planWeeks));
      }
      updateToast(toastId, { message: "Confirming...", txHash: tx.hash });

      const receipt = await tx.wait();
      const iface = hoodgap.interface;
      const parsed = receipt.logs
        .map((l: any) => { try { return iface.parseLog(l); } catch { return null; } })
        .find((e: any) => e && (e.name === "PolicyPurchased" || e.name === "SubscriptionCreated"));

      if (planWeeks === 1) {
        const policyId = parsed ? Number(parsed.args?.policyId) : -1;
        updateToast(toastId, {
          type: "success",
          title: "Policy purchased",
          message: `#${policyId} — ${formatDollars(effectiveCoverage)} coverage`,
          txHash: tx.hash,
        });
        onSuccess?.(policyId);
      } else {
        const subId = parsed ? Number(parsed.args?.subId) : -1;
        updateToast(toastId, {
          type: "success",
          title: `${selectedPlan.label} plan purchased`,
          message: `Subscription #${subId} — ${totalNfts} gap NFTs, ${formatDollars(effectiveCoverage)} coverage each`,
          txHash: tx.hash,
        });
        onSuccess?.(subId);
      }
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
    <div className="space-y-5" ref={formRef}>
      {/* Threshold Tier Selector */}
      <div className="space-y-2">
        <label className="text-sm font-medium">
          Gap Threshold
          <InfoTooltip title="What is Gap Threshold?">
            This is the minimum price drop between sessions that triggers your insurance payout.
            A -5% threshold means you get paid if a stock drops 5% or more between market close and next open.
            Lower thresholds pay out more often but cost more in premium.
          </InfoTooltip>
        </label>
        <div className="grid grid-cols-2 gap-3">
          {THRESHOLD_OPTIONS.map((t) => (
            <button
              key={t.value}
              onClick={() => setThresholdBps(t.value)}
              className={`p-3 rounded-lg border text-left transition-all ${
                thresholdBps === t.value
                  ? "border-[#c8e64a] bg-[#c8e64a]/10"
                  : "border-[hsl(0,0%,20%)] hover:border-[hsl(0,0%,30%)]"
              }`}
            >
              <div className="font-bold text-lg">{t.label}</div>
              <div className="text-xs text-muted">{t.description}</div>
            </button>
          ))}
        </div>
      </div>

      {/* Plan Selector */}
      <PlanSelector
        weeklyPremium={premium.amount}
        selectedWeeks={planWeeks}
        onPlanChange={setPlanWeeks}
      />

      {/* Position */}
      <div className="space-y-2">
        <label className="text-sm font-medium">
          Position Value
          <InfoTooltip title="What is Position Value?">
            The total dollar value of the stock position you want to protect.
            For example, if you hold 100 shares of TSLA at $400, your position value is $40,000.
            We use this to calculate how much coverage you need.
          </InfoTooltip>
        </label>
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

      {/* Risk */}
      <div className="border-t border-b py-4 space-y-1">
        <div className="text-xs text-muted uppercase tracking-wider">
          Gap Risk
          <InfoTooltip title="Gap Risk">
            This is your maximum potential loss from a price gap between sessions — the amount you'd lose
            if the stock drops by your selected threshold between market close and next morning's open.
            This becomes your recommended coverage amount.
          </InfoTooltip>
        </div>
        <div className="text-2xl font-bold font-mono">
          {formatDollars(calculatedRisk)}
        </div>
        <div className="text-xs text-muted">
          -{thresholdPct}% of {formatDollars(numPosition)}
        </div>
      </div>

      {/* Binary Payout Info */}
      {numPosition > 0 && (
        <div className="p-3 bg-surface-alt rounded-lg space-y-1.5">
          <div className="text-xs font-semibold flex items-center gap-1.5">
            <span className="w-4 h-4 rounded-full bg-[#c8e64a]/30 flex items-center justify-center text-[8px] font-bold text-[#8aad2e]">✓</span>
            Binary Payout · {totalNfts} Gap NFTs
          </div>
          <div className="text-xs text-muted leading-relaxed">
            If any gap ≥ <span className="font-semibold text-fg">{thresholdPct}%</span>, you receive{" "}
            <span className="font-semibold text-fg">100%</span> of coverage for that gap. Each of your {totalNfts} NFTs settles independently.
          </div>
        </div>
      )}

      {/* Premium */}
      <div className="space-y-1">
        <div className="text-xs text-muted uppercase tracking-wider">
          Premium
          <InfoTooltip title="How Premium Works">
            The premium is what you pay to get coverage. It's calculated as a percentage of your coverage amount
            based on the threshold tier you selected. The premium pays for one week of gap protection
            (5 trading nights = 5 NFTs). If no gap event hits your threshold, the premium is not refunded.
          </InfoTooltip>
        </div>
        {premium.loading ? (
          <LoadingSpinner size="sm" text="Calculating..." />
        ) : premium.error ? (
          <div className="text-sm text-negative">{premium.error}</div>
        ) : premium.amount !== null ? (
          <>
            <div className="text-2xl font-bold font-mono">
              {planWeeks === 1 ? (
                <>${premium.amount.toFixed(2)}</>
              ) : (
                <>${totalPremium!.toFixed(2)} <span className="text-sm font-normal text-muted">total</span></>
              )}
            </div>
            <div className="text-xs text-muted">
              {planWeeks === 1 ? (
                <>{premiumPercent(premium.amount, effectiveCoverage).toFixed(2)}% of coverage · {totalNfts} gap NFTs</>
              ) : (
                <>${discountedPremium!.toFixed(2)}/week × {planWeeks} weeks · {discountPct}% off · {totalNfts} NFTs</>
              )}
            </div>
            {premium.isEstimate && (
              <div className="text-xs text-yellow-500 mt-1">
                ⚠ Estimated — connect wallet for exact quote
              </div>
            )}
          </>
        ) : null}
      </div>

      {/* Purchase */}
      <button onClick={handlePurchase} disabled={!canPurchase} className="btn-primary">
        {status !== "connected"
          ? "Connect Wallet"
          : purchasing || approving
          ? approving ? "Approving..." : "Purchasing..."
          : planWeeks === 1 ? "Buy Weekly Coverage"
          : `Buy ${selectedPlan.label} Plan`}
      </button>

      {/* Advanced: Custom coverage */}
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
