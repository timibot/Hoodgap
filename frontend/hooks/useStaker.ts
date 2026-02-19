"use client";

import { useState, useEffect, useCallback } from "react";
import { useContract } from "./useContract";
import { useWeb3 } from "@/contexts/Web3Context";
import { fromUSDC } from "@/lib/formatting";
import { estimateQueueWait, calculateQueueProgress } from "@/lib/calculations";
import { POLL_INTERVAL_MS } from "@/lib/constants";
import type { PoolStats } from "@/types/contracts";

export interface PoolStatsDisplay {
  totalStaked: number;
  totalCoverage: number;
  reserveBalance: number;
  utilization: number;
  policyCount: number;
  freeLiquidity: number;
}

export function usePoolStats(): {
  stats: PoolStatsDisplay | null;
  loading: boolean;
} {
  const { hoodgapReadOnly } = useContract();
  const [stats, setStats] = useState<PoolStatsDisplay | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchStats = useCallback(async () => {
    if (!hoodgapReadOnly) return;
    try {
      const raw = await hoodgapReadOnly.getPoolStats();
      const totalStaked = fromUSDC(raw[0]);
      const totalCoverage = fromUSDC(raw[1]);

      setStats({
        totalStaked,
        totalCoverage,
        reserveBalance: fromUSDC(raw[2]),
        utilization: totalStaked > 0 ? (totalCoverage / totalStaked) * 100 : 0,
        policyCount: Number(raw[4]),
        freeLiquidity: Math.max(0, totalStaked - totalCoverage),
      });
    } catch (err) {
      console.error("Failed to fetch pool stats:", err);
    } finally {
      setLoading(false);
    }
  }, [hoodgapReadOnly]);

  // Regular polling
  useEffect(() => {
    if (!hoodgapReadOnly) return;
    let cancelled = false;

    fetchStats();
    const interval = setInterval(fetchStats, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [hoodgapReadOnly, fetchStats]);

  // Real-time: listen for contract events to trigger instant refresh
  useEffect(() => {
    if (!hoodgapReadOnly) return;

    const events = ["Staked", "PolicyPurchased", "WithdrawalQueued", "SettlementApproved"];
    const handler = () => {
      // Small delay to let the chain state settle
      setTimeout(fetchStats, 1000);
    };

    events.forEach((event) => {
      try {
        hoodgapReadOnly.on(event, handler);
      } catch {
        // Event may not exist in ABI — skip silently
      }
    });

    return () => {
      events.forEach((event) => {
        try {
          hoodgapReadOnly.off(event, handler);
        } catch {}
      });
    };
  }, [hoodgapReadOnly, fetchStats]);

  return { stats, loading };
}

export interface QueueStatusDisplay {
  requestId: number;
  amount: number;
  position: number;
  requestTime: Date;
  dollarAhead: number;
  freeLiquidity: number;
  shortfall: number;
  estimatedWaitDays: number;
  estimatedSettlements: number;
  progressPercent: number;
  processed: boolean;
}

export function useQueueStatus(requestId: number): {
  status: QueueStatusDisplay | null;
  loading: boolean;
} {
  const { hoodgapReadOnly } = useContract();
  const [status, setStatus] = useState<QueueStatusDisplay | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!hoodgapReadOnly || requestId < 0) {
      setLoading(false);
      return;
    }

    let cancelled = false;

    async function fetchStatus() {
      try {
        const request = await hoodgapReadOnly.withdrawalQueue(requestId);
        if (cancelled) return;

        if (request.processed) {
          setStatus((prev) =>
            prev ? { ...prev, processed: true, progressPercent: 100 } : null
          );
          setLoading(false);
          return;
        }

        const queueHead = Number(await hoodgapReadOnly.queueHead());

        let position = 0;
        let dollarAhead = 0;

        for (let i = queueHead; i < requestId; i++) {
          const req = await hoodgapReadOnly.withdrawalQueue(i);
          if (!req.processed) {
            position++;
            dollarAhead += fromUSDC(req.amount);
          }
        }

        const poolStats = await hoodgapReadOnly.getPoolStats();
        const totalStaked = fromUSDC(poolStats[0]);
        const totalCoverage = fromUSDC(poolStats[1]);
        const freeLiquidity = Math.max(0, totalStaked - totalCoverage);

        const amount = fromUSDC(request.amount);
        const shortfall = Math.max(0, dollarAhead + amount - freeLiquidity);
        const { days, settlements } = estimateQueueWait(shortfall);
        const progressPercent = calculateQueueProgress(dollarAhead, amount, freeLiquidity);

        if (!cancelled) {
          setStatus({
            requestId,
            amount,
            position: position + 1,
            requestTime: new Date(Number(request.requestTime) * 1000),
            dollarAhead,
            freeLiquidity,
            shortfall,
            estimatedWaitDays: days,
            estimatedSettlements: settlements,
            progressPercent,
            processed: false,
          });
        }
      } catch (err) {
        console.error("Failed to fetch queue status:", err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    fetchStatus();
    const interval = setInterval(fetchStatus, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [hoodgapReadOnly, requestId]);

  return { status, loading };
}
