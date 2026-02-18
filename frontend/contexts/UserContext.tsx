"use client";

import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  type ReactNode,
} from "react";
import { useWeb3 } from "./Web3Context";
import { useContracts } from "./ContractContext";
import { POLL_INTERVAL_MS } from "@/lib/constants";

interface UserData {
  ethBalance: bigint;
  usdcBalance: bigint;
  stakedBalance: bigint;
  loading: boolean;
  refresh: () => Promise<void>;
}

const UserContext = createContext<UserData>({
  ethBalance: 0n,
  usdcBalance: 0n,
  stakedBalance: 0n,
  loading: true,
  refresh: async () => {},
});

export function useUser() {
  return useContext(UserContext);
}

export function UserProvider({ children }: { children: ReactNode }) {
  const { address, status, provider } = useWeb3();
  const { hoodgapReadOnly, usdcReadOnly } = useContracts();

  const [ethBalance, setEthBalance] = useState(0n);
  const [usdcBalance, setUsdcBalance] = useState(0n);
  const [stakedBalance, setStakedBalance] = useState(0n);
  const [loading, setLoading] = useState(true);

  const fetchUserData = useCallback(async () => {
    if (!address || status !== "connected") {
      setEthBalance(0n);
      setUsdcBalance(0n);
      setStakedBalance(0n);
      setLoading(false);
      return;
    }

    try {
      const promises: Promise<any>[] = [];

      // ETH balance from provider
      if (provider) {
        promises.push(provider.getBalance(address));
      } else {
        promises.push(Promise.resolve(0n));
      }

      // USDC balance (skip if contracts not loaded yet)
      if (usdcReadOnly) {
        promises.push(usdcReadOnly.balanceOf(address));
      } else {
        promises.push(Promise.resolve(0n));
      }

      // Staked balance
      if (hoodgapReadOnly) {
        promises.push(hoodgapReadOnly.stakerBalances(address));
      } else {
        promises.push(Promise.resolve(0n));
      }

      const [eth, usdc, staked] = await Promise.all(promises);
      setEthBalance(eth);
      setUsdcBalance(usdc);
      setStakedBalance(staked);
    } catch (err) {
      console.error("Failed to fetch user data:", err);
    } finally {
      setLoading(false);
    }
  }, [address, status, provider, usdcReadOnly, hoodgapReadOnly]);

  useEffect(() => {
    fetchUserData();
    const interval = setInterval(fetchUserData, POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [fetchUserData]);

  return (
    <UserContext.Provider
      value={{ ethBalance, usdcBalance, stakedBalance, loading, refresh: fetchUserData }}
    >
      {children}
    </UserContext.Provider>
  );
}
