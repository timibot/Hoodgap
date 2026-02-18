"use client";

import { useState, useCallback } from "react";
import { MaxUint256 } from "ethers";
import { useContract } from "./useContract";
import { useWeb3 } from "@/contexts/Web3Context";

export enum ApprovalMode {
  INFINITE = "infinite",
  BUFFERED = "buffered",
  EXACT = "exact",
}

interface ApprovalState {
  ensureApproval: (premium: bigint) => Promise<void>;
  approving: boolean;
  approvalMode: ApprovalMode;
  setApprovalMode: (mode: ApprovalMode) => void;
}

export function useApproval(): ApprovalState {
  const { address } = useWeb3();
  const { usdc, hoodgap } = useContract();
  const [approving, setApproving] = useState(false);

  const getMode = (): ApprovalMode => {
    if (typeof window === "undefined") return ApprovalMode.INFINITE;
    return (localStorage.getItem("hoodgap_approval_mode") as ApprovalMode) ||
      ApprovalMode.INFINITE;
  };

  const setApprovalMode = (mode: ApprovalMode) => {
    localStorage.setItem("hoodgap_approval_mode", mode);
  };

  const approvalMode = getMode();

  function calculateApprovalAmount(premium: bigint): bigint {
    switch (approvalMode) {
      case ApprovalMode.INFINITE:
        return MaxUint256;
      case ApprovalMode.BUFFERED:
        return (premium * 110n) / 100n;
      case ApprovalMode.EXACT:
        return premium;
      default:
        return MaxUint256;
    }
  }

  const ensureApproval = useCallback(
    async (premium: bigint) => {
      if (!address || !usdc || !hoodgap) {
        throw new Error("Wallet not connected");
      }

      const hoodgapAddress = await hoodgap.getAddress();
      const currentAllowance: bigint = await usdc.allowance(address, hoodgapAddress);

      if (currentAllowance >= premium) return;

      const approvalAmount = calculateApprovalAmount(premium);
      setApproving(true);

      try {
        const tx = await usdc.approve(hoodgapAddress, approvalAmount);
        await tx.wait();
      } catch (err) {
        console.error("USDC approval failed:", err);
        throw err;
      } finally {
        setApproving(false);
      }
    },
    [address, usdc, hoodgap, approvalMode]
  );

  return { ensureApproval, approving, approvalMode, setApprovalMode };
}
