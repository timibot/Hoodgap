"use client";

import { useState } from "react";
import { useWeb3 } from "@/contexts/Web3Context";
import { useUser } from "@/contexts/UserContext";
import { Contract } from "ethers";
import { USDC_ADDRESS } from "@/lib/constants";

const MOCK_USDC_ABI = [
  "function mint(address to, uint256 amount) external",
];

const MINT_AMOUNT = 10_000_000_000n; // 10,000 USDC (6 decimals)

export default function FaucetButton() {
  const { address, status, signer } = useWeb3();
  const { usdcBalance, refresh } = useUser();
  const [minting, setMinting] = useState(false);
  const [success, setSuccess] = useState(false);

  if (status !== "connected" || !address) return null;
  if (usdcBalance > 100_000_000n) return null;

  async function addTokenToWallet() {
    if (!window.ethereum) return;
    try {
      await window.ethereum.request({
        method: "wallet_watchAsset",
        params: {
          type: "ERC20",
          options: {
            address: USDC_ADDRESS,
            symbol: "USDC",
            decimals: 6,
          },
        },
      });
    } catch {
      // user rejected — fine
    }
  }

  async function handleMint() {
    if (!signer) return;
    setMinting(true);
    setSuccess(false);
    try {
      const mockUsdc = new Contract(USDC_ADDRESS, MOCK_USDC_ABI, signer);
      const tx = await mockUsdc.mint(address, MINT_AMOUNT);
      await tx.wait();
      setSuccess(true);
      await refresh();
      // Prompt wallet to track the token
      await addTokenToWallet();
      setTimeout(() => setSuccess(false), 3000);
    } catch (err: any) {
      console.error("Faucet mint failed:", err);
      alert(err.reason || err.message || "Mint failed");
    } finally {
      setMinting(false);
    }
  }

  return (
    <button
      onClick={handleMint}
      disabled={minting}
      className="px-4 py-2 text-sm font-semibold rounded-full border border-dashed border-muted hover:border-fg hover:bg-surface-alt transition-colors disabled:opacity-50 w-full"
    >
      {minting ? "Minting..." : success ? "✓ 10,000 USDC added" : "🚰 Get Test USDC"}
    </button>
  );
}
