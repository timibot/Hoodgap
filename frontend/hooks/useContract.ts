"use client";

import { useContracts } from "@/contexts/ContractContext";
import { useWeb3 } from "@/contexts/Web3Context";

export function useContract() {
  const { hoodgap, usdc, hoodgapReadOnly, usdcReadOnly } = useContracts();
  const { status } = useWeb3();

  return {
    hoodgap,
    usdc,
    hoodgapReadOnly,
    usdcReadOnly,
    isReady: status === "connected" && !!hoodgap && !!usdc,
  };
}
