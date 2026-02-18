"use client";

import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  type ReactNode,
} from "react";
import { BrowserProvider } from "ethers";
import type { Signer } from "ethers";
import { CHAIN_ID, ROBINHOOD_TESTNET_PARAMS } from "@/lib/constants";
import type { ConnectionStatus } from "@/types/user";

// ---------- Types ----------

interface Web3State {
  provider: BrowserProvider | null;
  signer: Signer | null;
  address: string | null;
  chainId: number | null;
  status: ConnectionStatus;
  connect: () => void;
  disconnect: () => void;
  showWalletModal: boolean;
  setShowWalletModal: (v: boolean) => void;
  connectWithProvider: (ethProvider: any) => Promise<void>;
}

const DEFAULTS: Web3State = {
  provider: null,
  signer: null,
  address: null,
  chainId: null,
  status: "disconnected",
  connect: () => {},
  disconnect: () => {},
  showWalletModal: false,
  setShowWalletModal: () => {},
  connectWithProvider: async () => {},
};

const Web3Context = createContext<Web3State>(DEFAULTS);

export function useWeb3() {
  return useContext(Web3Context);
}

// ---------- Provider ----------

export function Web3Provider({ children }: { children: ReactNode }) {
  const [provider, setProvider] = useState<BrowserProvider | null>(null);
  const [signer, setSigner] = useState<Signer | null>(null);
  const [address, setAddress] = useState<string | null>(null);
  const [chainId, setChainId] = useState<number | null>(null);
  const [status, setStatus] = useState<ConnectionStatus>("disconnected");
  const [showWalletModal, setShowWalletModal] = useState(false);

  // Core: connect given an EIP-1193 provider (from any wallet)
  const connectWithProvider = useCallback(async (ethProvider: any) => {
    setStatus("connecting");
    try {
      const browserProvider = new BrowserProvider(ethProvider);
      await browserProvider.send("eth_requestAccounts", []);

      // Try switching to Robinhood testnet
      try {
        await ethProvider.request({
          method: "wallet_switchEthereumChain",
          params: [{ chainId: `0x${CHAIN_ID.toString(16)}` }],
        });
      } catch (switchErr: any) {
        // 4902 = chain not added yet
        if (switchErr.code === 4902) {
          await ethProvider.request({
            method: "wallet_addEthereumChain",
            params: [ROBINHOOD_TESTNET_PARAMS],
          });
        }
      }

      // Re-create provider after chain switch
      const freshProvider = new BrowserProvider(ethProvider);
      const network = await freshProvider.getNetwork();
      const currentChainId = Number(network.chainId);
      const walletSigner = await freshProvider.getSigner();
      const walletAddress = await walletSigner.getAddress();

      setProvider(freshProvider);
      setSigner(walletSigner);
      setAddress(walletAddress);
      setChainId(currentChainId);
      setStatus(currentChainId === CHAIN_ID ? "connected" : "wrong-network");
      setShowWalletModal(false);

      // Listen for account & chain changes
      ethProvider.on?.("accountsChanged", (accounts: string[]) => {
        if (accounts.length === 0) {
          resetState();
        } else {
          setAddress(accounts[0]);
        }
      });

      ethProvider.on?.("chainChanged", (newChainId: string) => {
        const id = parseInt(newChainId, 16);
        setChainId(id);
        setStatus(id === CHAIN_ID ? "connected" : "wrong-network");
      });
    } catch (err) {
      console.error("Wallet connection failed:", err);
      setStatus("disconnected");
    }
  }, []);

  function resetState() {
    setProvider(null);
    setSigner(null);
    setAddress(null);
    setChainId(null);
    setStatus("disconnected");
  }

  // Opens the wallet modal
  const connect = useCallback(() => {
    setShowWalletModal(true);
  }, []);

  const disconnect = useCallback(() => {
    resetState();
  }, []);

  // Auto-reconnect if wallet was previously connected
  useEffect(() => {
    if (typeof window === "undefined" || !window.ethereum) return;

    window.ethereum
      .request({ method: "eth_accounts" })
      .then((accounts: string[]) => {
        if (accounts.length > 0) {
          connectWithProvider(window.ethereum);
        }
      })
      .catch(() => {});
  }, [connectWithProvider]);

  return (
    <Web3Context.Provider
      value={{
        provider,
        signer,
        address,
        chainId,
        status,
        connect,
        disconnect,
        showWalletModal,
        setShowWalletModal,
        connectWithProvider,
      }}
    >
      {children}
    </Web3Context.Provider>
  );
}

declare global {
  interface Window {
    ethereum?: any;
  }
}
