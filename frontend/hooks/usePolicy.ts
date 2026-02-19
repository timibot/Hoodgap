"use client";

import { useState, useEffect, useCallback } from "react";
import { useContract } from "./useContract";
import { useWeb3 } from "@/contexts/Web3Context";
import { fromUSDC } from "@/lib/formatting";
import type { PolicyDisplay } from "@/types/policy";

export function usePolicy() {
  const { hoodgapReadOnly } = useContract();
  const { address, status } = useWeb3();

  const [policies, setPolicies] = useState<PolicyDisplay[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchPolicies = useCallback(async () => {
    if (!address || status !== "connected" || !hoodgapReadOnly) {
      setPolicies([]);
      setLoading(false);
      return;
    }

    try {
      const nextId = Number(await hoodgapReadOnly.nextPolicyId());
      const userPolicies: PolicyDisplay[] = [];

      for (let i = 0; i < nextId; i++) {
        try {
          const owner = await hoodgapReadOnly.ownerOf(i);
          if (owner.toLowerCase() !== address.toLowerCase()) continue;
        } catch {
          continue; // NFT doesn't exist or was burned
        }

        const p = await hoodgapReadOnly.policies(i);
          let policyStatus: PolicyDisplay["status"] = "active";
          if (p.settled && p.paidOut) policyStatus = "settled-paid";
          else if (p.settled) policyStatus = "settled-nopay";

          // Subscription info
          let subscriptionId: number | undefined;
          let subscriptionPosition: string | undefined;
          try {
            const subId = Number(await hoodgapReadOnly.policySubscriptionId(i));
            if (subId > 0 || (await hoodgapReadOnly.getSubscription(0)).totalWeeks > 0) {
              const sub = await hoodgapReadOnly.getSubscription(subId);
              if (sub.totalWeeks > 0) {
                subscriptionId = subId;
                const label = Number(sub.totalWeeks) === 4 ? "Monthly" : "Season";
                // Figure out which week within the subscription
                const weekNum = Number(p.settlementWeek) - Number(sub.startWeek) + 1;
                subscriptionPosition = `${label} ${weekNum}/${sub.totalWeeks}`;
              }
            }
          } catch {
            // Not part of a subscription
          }

          userPolicies.push({
            id: i,
            holder: p.holder,
            coverageUsd: fromUSDC(p.coverage),
            thresholdPercent: Number(p.threshold) / 100,
            premiumUsd: fromUSDC(p.premium),
            purchaseDate: new Date(Number(p.purchaseTime) * 1000),
            settlementWeek: Number(p.settlementWeek),
            settled: p.settled,
            paidOut: p.paidOut,
            status: policyStatus,
            subscriptionId,
            subscriptionPosition,
          });
      }

      setPolicies(userPolicies);
    } catch (err) {
      console.error("Failed to fetch policies:", err);
    } finally {
      setLoading(false);
    }
  }, [address, status, hoodgapReadOnly]);

  useEffect(() => {
    fetchPolicies();
  }, [fetchPolicies]);

  return { policies, loading, refresh: fetchPolicies };
}
