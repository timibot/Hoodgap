"use client";

import { useState } from "react";

export type PlanType = "weekly" | "monthly" | "season";

interface PlanSelectorProps {
  weeklyPremium: number | null;
  onPlanChange: (plan: PlanType) => void;
  selectedPlan: PlanType;
}

const PLANS: { type: PlanType; label: string; weeks: number; discount: number; description: string }[] = [
  { type: "weekly", label: "Weekly", weeks: 1, discount: 0, description: "1 week · No discount" },
  { type: "monthly", label: "Monthly", weeks: 4, discount: 5, description: "4 weeks · Save 5%" },
  { type: "season", label: "Season Pass", weeks: 8, discount: 10, description: "8 weeks · Save 10%" },
];

export function getPlanWeeks(plan: PlanType): number {
  return PLANS.find(p => p.type === plan)?.weeks ?? 1;
}

export function getPlanDiscount(plan: PlanType): number {
  return PLANS.find(p => p.type === plan)?.discount ?? 0;
}

export default function PlanSelector({ weeklyPremium, onPlanChange, selectedPlan }: PlanSelectorProps) {
  return (
    <div className="space-y-2">
      <label className="text-xs text-muted uppercase tracking-wider">Plan</label>
      <div className="grid grid-cols-3 gap-2">
        {PLANS.map((plan) => {
          const isSelected = selectedPlan === plan.type;
          const perWeek = weeklyPremium && plan.discount > 0
            ? weeklyPremium * (1 - plan.discount / 100)
            : weeklyPremium;
          const total = perWeek ? perWeek * plan.weeks : null;

          return (
            <button
              key={plan.type}
              onClick={() => onPlanChange(plan.type)}
              className={`p-3 rounded-lg border text-left transition-all ${
                isSelected
                  ? "border-fg bg-surface-alt ring-1 ring-fg/20"
                  : "border-border hover:border-border-dark"
              }`}
            >
              <div className="text-sm font-semibold">{plan.label}</div>
              <div className="text-xs text-muted mt-0.5">{plan.description}</div>
              {total !== null && plan.weeks > 1 && (
                <div className="text-xs text-positive font-mono mt-1.5">
                  ${total.toFixed(2)} total
                </div>
              )}
            </button>
          );
        })}
      </div>
      {selectedPlan !== "weekly" && (
        <div className="text-xs text-muted flex items-center gap-1.5">
          <span className="w-3 h-3 rounded-full bg-positive/20 flex items-center justify-center text-[8px] text-positive">✓</span>
          New policy minted each week with real market close price
        </div>
      )}
    </div>
  );
}
