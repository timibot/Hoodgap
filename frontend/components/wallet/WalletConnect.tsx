"use client";

import { useState, useEffect } from "react";
import { useWeb3 } from "@/contexts/Web3Context";
import { shortenAddress } from "@/lib/formatting";

export default function WalletConnect() {
  const { address, status, connect, disconnect } = useWeb3();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted) {
    return (
      <div className="px-4 py-2 text-sm font-semibold rounded-full border opacity-50">
        ···
      </div>
    );
  }

  if (status === "connected" && address) {
    return (
      <div className="flex items-center gap-2">
        <div className="flex items-center gap-2 px-3 py-1.5 rounded-full border text-sm">
          <span className="w-2 h-2 rounded-full bg-green-500" />
          <span className="font-mono font-medium">{shortenAddress(address)}</span>
        </div>
        <button
          onClick={disconnect}
          className="text-xs text-muted hover:text-fg transition-colors"
          title="Disconnect"
        >
          ✕
        </button>
      </div>
    );
  }

  return (
    <button
      onClick={connect}
      className="px-4 py-2 bg-fg text-white text-sm font-semibold rounded-full hover:opacity-80 transition-opacity"
    >
      {status === "connecting" ? "Connecting..." : "Connect Wallet"}
    </button>
  );
}
