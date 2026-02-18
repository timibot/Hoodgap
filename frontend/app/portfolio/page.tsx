"use client";

import { useState } from "react";
import { usePolicy } from "@/hooks/usePolicy";
import PolicyCard from "@/components/insurance/PolicyCard";
import ClaimButton from "@/components/settlement/ClaimButton";
import LoadingSpinner from "@/components/shared/LoadingSpinner";
import { useWeb3 } from "@/contexts/Web3Context";
import { useUser } from "@/contexts/UserContext";
import { formatDollars, fromUSDC } from "@/lib/formatting";
import Link from "next/link";

type Tab = "all" | "insurance" | "staking";

export default function PortfolioPage() {
  const { status, connect } = useWeb3();
  const { policies, loading, refresh } = usePolicy();
  const { ethBalance, usdcBalance, stakedBalance } = useUser();
  const [tab, setTab] = useState<Tab>("all");

  if (status !== "connected") {
    return (
      <div className="text-center py-16 space-y-3">
        <p className="text-muted">Connect wallet to view portfolio.</p>
        <button onClick={connect} className="btn-primary max-w-xs mx-auto">
          Connect Wallet
        </button>
      </div>
    );
  }

  if (loading) return <div className="py-16"><LoadingSpinner text="Loading..." /></div>;

  const activePolicies = policies.filter((p) => p.status === "active");
  const settledPolicies = policies.filter((p) => p.status !== "active");
  const hasStake = stakedBalance > 0n;
  const hasInsurance = policies.length > 0;

  const ethUsd = fromUSDC(ethBalance / 1000000000000n); // rough ETH→USDC (not precise)
  const usdcUsd = fromUSDC(usdcBalance);
  const stakedUsd = fromUSDC(stakedBalance);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold">Portfolio</h1>
          <p className="text-sm text-muted">
            {policies.length} {policies.length === 1 ? "policy" : "policies"}
            {hasStake ? ` · $${stakedUsd.toFixed(2)} staked` : ""}
          </p>
        </div>
        <button onClick={refresh} className="text-xs text-muted hover:text-fg underline">
          Refresh
        </button>
      </div>

      {/* Balance Overview */}
      <div className="grid grid-cols-3 gap-4">
        <div className="border rounded-lg p-4">
          <div className="text-xs text-muted mb-1">Wallet (USDC)</div>
          <div className="text-lg font-bold font-mono">{formatDollars(usdcUsd)}</div>
        </div>
        <div className="border rounded-lg p-4">
          <div className="text-xs text-muted mb-1">Staked</div>
          <div className="text-lg font-bold font-mono">{formatDollars(stakedUsd)}</div>
        </div>
        <div className="border rounded-lg p-4">
          <div className="text-xs text-muted mb-1">Active Coverage</div>
          <div className="text-lg font-bold font-mono">
            {activePolicies.length > 0
              ? formatDollars(activePolicies.reduce((sum, p) => sum + p.coverageUsd, 0))
              : "$0.00"}
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b">
        {(["all", "insurance", "staking"] as Tab[]).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
              tab === t
                ? "border-fg text-fg"
                : "border-transparent text-muted hover:text-fg"
            }`}
          >
            {t === "all" ? "All" : t === "insurance" ? "Insurance" : "Staking"}
          </button>
        ))}
      </div>

      {/* Content */}
      {(tab === "all" || tab === "staking") && (
        <div className="space-y-3">
          {hasStake ? (
            <>
              <h2 className="text-sm font-semibold text-muted uppercase tracking-wider">
                Staking Position
              </h2>
              <div className="border rounded-lg p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="font-semibold">USDC Liquidity Pool</div>
                    <div className="text-xs text-muted">Earning premiums from insurance buyers</div>
                  </div>
                  <div className="text-right">
                    <div className="text-lg font-bold font-mono">{formatDollars(stakedUsd)}</div>
                    <div className="text-xs text-muted">staked</div>
                  </div>
                </div>
                <div className="flex gap-2">
                  <Link href="/stake" className="text-xs font-semibold underline hover:text-fg text-muted">
                    Manage Stake →
                  </Link>
                </div>
              </div>
            </>
          ) : tab === "staking" ? (
            <div className="text-center py-12 space-y-3">
              <p className="text-muted">No staking positions.</p>
              <Link href="/stake" className="btn-primary max-w-xs mx-auto block">
                Start Staking
              </Link>
            </div>
          ) : null}
        </div>
      )}

      {(tab === "all" || tab === "insurance") && (
        <div className="space-y-3">
          {hasInsurance ? (
            <>
              {activePolicies.length > 0 && (
                <div className="space-y-3">
                  <h2 className="text-sm font-semibold text-muted uppercase tracking-wider">
                    Active Insurance
                  </h2>
                  {activePolicies.map((p) => (
                    <div key={p.id} className="space-y-2">
                      <PolicyCard policy={p} />
                      <ClaimButton policyId={p.id} />
                    </div>
                  ))}
                </div>
              )}
              {settledPolicies.length > 0 && (
                <div className="space-y-3">
                  <h2 className="text-sm font-semibold text-muted uppercase tracking-wider">
                    History
                  </h2>
                  {settledPolicies.map((p) => (
                    <PolicyCard key={p.id} policy={p} />
                  ))}
                </div>
              )}
            </>
          ) : tab === "insurance" ? (
            <div className="text-center py-12 space-y-3">
              <p className="text-muted">No insurance policies.</p>
              <Link href="/buy" className="btn-primary max-w-xs mx-auto block">
                Buy Insurance
              </Link>
            </div>
          ) : !hasStake ? (
            <div className="text-center py-12 space-y-3">
              <p className="text-muted">No positions yet.</p>
              <div className="flex gap-3 justify-center">
                <Link href="/buy" className="btn-primary">Buy Insurance</Link>
                <Link href="/stake" className="btn-secondary">Stake USDC</Link>
              </div>
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}
