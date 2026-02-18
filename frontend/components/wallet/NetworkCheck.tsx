"use client";

import { useWeb3 } from "@/contexts/Web3Context";
import { CHAIN_ID, CHAIN_CONFIG, ROBINHOOD_TESTNET_PARAMS } from "@/lib/constants";

export default function NetworkCheck() {
  const { status, chainId } = useWeb3();

  if (status !== "wrong-network") return null;

  const expected = CHAIN_CONFIG[CHAIN_ID as keyof typeof CHAIN_CONFIG];

  async function switchNetwork() {
    if (!window.ethereum) return;
    try {
      await window.ethereum.request({
        method: "wallet_switchEthereumChain",
        params: [{ chainId: `0x${CHAIN_ID.toString(16)}` }],
      });
    } catch (err: any) {
      // 4902 = chain not added to wallet yet
      if (err.code === 4902) {
        try {
          await window.ethereum.request({
            method: "wallet_addEthereumChain",
            params: [ROBINHOOD_TESTNET_PARAMS],
          });
        } catch (addErr) {
          console.error("Failed to add network:", addErr);
        }
      } else {
        console.error("Failed to switch network:", err);
      }
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-white/95">
      <div className="max-w-sm mx-4 text-center space-y-4">
        <h2 className="text-lg font-bold">Wrong Network</h2>
        <p className="text-sm text-muted">
          Please switch to{" "}
          <strong className="text-fg">{expected?.name || `Chain ${CHAIN_ID}`}</strong>{" "}
          to continue.
        </p>
        <p className="text-xs text-muted">Currently on chain {chainId}</p>
        <button onClick={switchNetwork} className="btn-primary max-w-xs mx-auto">
          Switch to {expected?.name || "Testnet"}
        </button>
      </div>
    </div>
  );
}
