"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useContract } from "./useContract";
import { useWeb3 } from "@/contexts/Web3Context";
import { toUSDC, fromUSDC } from "@/lib/formatting";
import {
  PREMIUM_DEBOUNCE_MS, ORACLE_ADDRESS,
  TIER_5_RATE, TIER_10_RATE, THRESHOLD_5, THRESHOLD_10,
} from "@/lib/constants";
import { Contract } from "ethers";

const MOCK_ORACLE_ABI = [
  "function update(int256 _price, uint256 _updatedAt) external",
  "function price() view returns (int256)",
];

export interface PremiumQuote {
  loading: boolean;
  amount: number | null;
  amountWei: bigint | null;
  error: string | null;
  isEstimate: boolean; // true if using client-side fallback
}

/** Client-side premium estimate using tier-based rates */
function estimatePremiumLocally(coverageUsd: number, threshold: number): number {
  const rate = threshold === THRESHOLD_10 ? TIER_10_RATE : TIER_5_RATE;
  const basePremium = (coverageUsd * rate) / 10000;
  const minPremium = coverageUsd / 1000; // 0.1% floor
  return Math.max(basePremium, minPremium);
}

export function usePremium(coverageUsd: number, threshold: number = THRESHOLD_5): PremiumQuote {
  const { hoodgapReadOnly } = useContract();
  const { signer } = useWeb3();
  const requestIdRef = useRef(0); // prevent stale responses from overwriting fresh ones

  const [quote, setQuote] = useState<PremiumQuote>({
    loading: false,
    amount: null,
    amountWei: null,
    error: null,
    isEstimate: false,
  });

  useEffect(() => {
    if (coverageUsd <= 0 || !hoodgapReadOnly) {
      setQuote({ loading: false, amount: null, amountWei: null, error: null, isEstimate: false });
      return;
    }

    setQuote((prev) => ({ ...prev, loading: true, error: null }));

    // Increment request id so stale responses are discarded
    const thisRequest = ++requestIdRef.current;

    const timer = setTimeout(async () => {
      try {
        const coverageWei = toUSDC(coverageUsd);

        // Use the 2-arg calculatePremium with threshold (view call, no gas)
        const premiumWei: bigint = await hoodgapReadOnly[
          "calculatePremium(uint256,uint256)"
        ](coverageWei, BigInt(threshold));
        const premium = fromUSDC(premiumWei);

        // Only update if this is still the latest request
        if (thisRequest === requestIdRef.current) {
          setQuote({ loading: false, amount: premium, amountWei: premiumWei, error: null, isEstimate: false });
        }
      } catch (err: any) {
        // Only update if this is still the latest request
        if (thisRequest !== requestIdRef.current) return;

        // Show fallback estimate but mark it clearly
        const estimate = estimatePremiumLocally(coverageUsd, threshold);
        const estimateWei = toUSDC(estimate);

        setQuote({
          loading: false,
          amount: estimate,
          amountWei: estimateWei,
          error: null,
          isEstimate: true,
        });
      }
    }, PREMIUM_DEBOUNCE_MS);

    return () => clearTimeout(timer);
  }, [coverageUsd, threshold, hoodgapReadOnly]);

  return quote;
}

/**
 * Refresh the mock oracle timestamp (call once before buying, not on every keystroke).
 * Returns true if successful.
 */
export async function refreshOracle(signer: any): Promise<boolean> {
  if (!signer || ORACLE_ADDRESS === "0x0000000000000000000000000000000000000000") {
    return false;
  }
  try {
    const oracle = new Contract(ORACLE_ADDRESS, MOCK_ORACLE_ABI, signer);
    const currentPrice = await oracle.price();
    const block = await signer.provider?.getBlock("latest");
    const now = block?.timestamp ?? Math.floor(Date.now() / 1000);
    const tx = await oracle.update(currentPrice, now);
    await tx.wait();
    return true;
  } catch {
    return false;
  }
}
