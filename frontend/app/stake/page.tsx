"use client";

import { useState } from "react";
import StakeForm from "@/components/staking/StakeForm";
import WithdrawForm from "@/components/staking/WithdrawForm";
import StakerStats from "@/components/staking/StakerStats";
import FaucetButton from "@/components/wallet/FaucetButton";
import { useUser } from "@/contexts/UserContext";
import { formatDollars, fromUSDC } from "@/lib/formatting";

export default function StakePage() {
  const [tab, setTab] = useState<"stake" | "withdraw">("stake");
  const { stakedBalance } = useUser();

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold">Stake</h1>
          <p className="text-sm text-muted mt-1">
            Provide liquidity and earn premiums.
          </p>
        </div>
        <FaucetButton />
      </div>

      <div className="border-b pb-4">
        <div className="text-xs text-muted uppercase tracking-wider">Your Stake</div>
        <div className="text-2xl font-bold font-mono mt-1">
          {formatDollars(fromUSDC(stakedBalance))}
        </div>
      </div>

      <StakerStats />

      {/* Tabs */}
      <div className="flex border-b">
        <button
          onClick={() => setTab("stake")}
          className={`pb-2 px-4 text-sm font-medium border-b-2 transition-colors ${
            tab === "stake"
              ? "border-fg text-fg"
              : "border-transparent text-muted hover:text-fg"
          }`}
        >
          Stake
        </button>
        <button
          onClick={() => setTab("withdraw")}
          className={`pb-2 px-4 text-sm font-medium border-b-2 transition-colors ${
            tab === "withdraw"
              ? "border-fg text-fg"
              : "border-transparent text-muted hover:text-fg"
          }`}
        >
          Withdraw
        </button>
      </div>

      {tab === "stake" ? <StakeForm /> : <WithdrawForm />}
    </div>
  );
}
