"use client";

import { PLAN_OPTIONS, GAPS_PER_WEEK } from "@/lib/constants";

interface PlanSelectorProps {
  weeklyPremium: number | null;
  selectedWeeks: number;
  onPlanChange: (weeks: number) => void;
}

export default function PlanSelector({ weeklyPremium, selectedWeeks, onPlanChange }: PlanSelectorProps) {
  return (
    <div className="space-y-2">
      <label className="text-sm font-medium">Plan Duration</label>
      <div className="grid grid-cols-3 gap-2">
        {PLAN_OPTIONS.map((plan) => {
          const discountedWeekly = weeklyPremium !== null && plan.discount > 0
            ? weeklyPremium * (1 - plan.discount / 10000)
            : weeklyPremium;
          const totalPrice = discountedWeekly !== null ? discountedWeekly * plan.weeks : null;

          return (
            <button
              key={plan.weeks}
              onClick={() => onPlanChange(plan.weeks)}
              className={`p-3 rounded-lg border text-left transition-all ${
                selectedWeeks === plan.weeks
                  ? "border-[#c8e64a] bg-[#c8e64a]/10"
                  : "border-[hsl(0,0%,20%)] hover:border-[hsl(0,0%,30%)]"
              }`}
            >
              <div className="font-semibold text-sm">{plan.label}</div>
              <div className="text-xs text-muted">{plan.nfts} NFTs</div>
              {plan.discount > 0 && (
                <div className="text-xs font-bold text-[#c8e64a] mt-1">
                  {(plan.discount / 100).toFixed(0)}% off
                </div>
              )}
              {totalPrice !== null && (
                <div className="text-xs text-muted mt-1 font-mono">
                  ${totalPrice.toFixed(2)}
                </div>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
