"use client";

import { useState, useEffect } from "react";
import { useContract } from "./useContract";
import { useWeb3 } from "@/contexts/Web3Context";
import { toUSDC, fromUSDC } from "@/lib/formatting";
import { PREMIUM_DEBOUNCE_MS, ORACLE_ADDRESS } from "@/lib/constants";
import { Contract } from "ethers";

const MOCK_ORACLE_ABI = [
  "function update(int256 _price, uint256 _updatedAt) external",
  "function price() view returns (int256)",
];

interface PremiumQuote {
  loading: boolean;
  amount: number | null;
  amountWei: bigint | null;
  error: string | null;
}

// Client-side fallback premium: basePremium = coverage * 10% / 52 weeks
// 3-year avg: ~10% gap probability per weekend (~1 in 9 Mondays)
function estimatePremiumLocally(coverageUsd: number): number {
  const weeklyRate = 0.10 / 52;
  const basePremium = coverageUsd * weeklyRate;
  const minPremium = coverageUsd * 0.0025; // 0.25% floor (matches contract)
  return Math.max(basePremium, minPremium);
}

export function usePremium(coverageUsd: number): PremiumQuote {
  const { hoodgapReadOnly } = useContract();
  const { signer } = useWeb3();

  const [quote, setQuote] = useState<PremiumQuote>({
    loading: false,
    amount: null,
    amountWei: null,
    error: null,
  });

  useEffect(() => {
    if (coverageUsd <= 0 || !hoodgapReadOnly) {
      setQuote({ loading: false, amount: null, amountWei: null, error: null });
      return;
    }

    setQuote((prev) => ({ ...prev, loading: true }));

    const timer = setTimeout(async () => {
      try {
        const coverageWei = toUSDC(coverageUsd);

        // Try refreshing the oracle first (keeps it non-stale)
        if (signer && ORACLE_ADDRESS !== "0x0000000000000000000000000000000000000000") {
          try {
            const oracle = new Contract(ORACLE_ADDRESS, MOCK_ORACLE_ABI, signer);
            const currentPrice = await oracle.price();
            const block = await signer.provider?.getBlock("latest");
            const now = block?.timestamp ?? Math.floor(Date.now() / 1000);
            const tx = await oracle.update(currentPrice, now);
            await tx.wait();
          } catch {
            // Oracle refresh failed — try the premium call anyway
          }
        }

        const premiumWei: bigint = await hoodgapReadOnly.calculatePremium(coverageWei);
        const premium = fromUSDC(premiumWei);

        setQuote({ loading: false, amount: premium, amountWei: premiumWei, error: null });
      } catch (err: any) {
        // Fallback: client-side estimate
        const estimate = estimatePremiumLocally(coverageUsd);
        const estimateWei = toUSDC(estimate);

        setQuote({
          loading: false,
          amount: estimate,
          amountWei: estimateWei,
          error: null, // Don't show error — show the estimate instead
        });
      }
    }, PREMIUM_DEBOUNCE_MS);

    return () => clearTimeout(timer);
  }, [coverageUsd, hoodgapReadOnly, signer]);

  return quote;
}
