"use client";

import {
  createContext,
  useContext,
  useMemo,
  type ReactNode,
} from "react";
import { JsonRpcProvider, Contract } from "ethers";
import type { Signer } from "ethers";
import { useWeb3 } from "./Web3Context";
import {
  HOODGAP_ADDRESS,
  USDC_ADDRESS,
  HoodGapABI,
  ERC20ABI,
  RPC_URL,
} from "@/lib/constants";

interface ContractState {
  hoodgap: Contract | null;
  usdc: Contract | null;
  hoodgapReadOnly: Contract;
  usdcReadOnly: Contract;
}

// Lazy singleton — created once on first access, not at module load
let _readProvider: JsonRpcProvider | null = null;
function getReadProvider() {
  if (!_readProvider) {
    _readProvider = new JsonRpcProvider(RPC_URL);
  }
  return _readProvider;
}

// SSR-safe stub: used when providers haven't mounted yet
const SSR_STUB: ContractState = {
  hoodgap: null,
  usdc: null,
  hoodgapReadOnly: null as any,
  usdcReadOnly: null as any,
};

const ContractContext = createContext<ContractState>(SSR_STUB);

export function useContracts() {
  return useContext(ContractContext);
}

export function ContractProvider({ children }: { children: ReactNode }) {
  const { signer, status } = useWeb3();

  const contracts = useMemo<ContractState>(() => {
    const readProvider = getReadProvider();
    const hoodgapReadOnly = new Contract(HOODGAP_ADDRESS, HoodGapABI, readProvider);
    const usdcReadOnly = new Contract(USDC_ADDRESS, ERC20ABI, readProvider);

    if (status === "connected" && signer) {
      return {
        hoodgap: new Contract(HOODGAP_ADDRESS, HoodGapABI, signer),
        usdc: new Contract(USDC_ADDRESS, ERC20ABI, signer),
        hoodgapReadOnly,
        usdcReadOnly,
      };
    }

    return { hoodgap: null, usdc: null, hoodgapReadOnly, usdcReadOnly };
  }, [signer, status]);

  return (
    <ContractContext.Provider value={contracts}>
      {children}
    </ContractContext.Provider>
  );
}
