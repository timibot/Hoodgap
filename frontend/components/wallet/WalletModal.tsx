"use client";

import { useWeb3 } from "@/contexts/Web3Context";

// Known wallet providers and their metadata
const KNOWN_WALLETS = [
  { rdns: "io.metamask", name: "MetaMask", icon: "🦊" },
  { rdns: "com.okex.wallet", name: "OKX Wallet", icon: "⬡" },
  { rdns: "io.zerion.wallet", name: "Zerion", icon: "◆" },
  { rdns: "com.coinbase.wallet", name: "Coinbase Wallet", icon: "🔵" },
  { rdns: "io.rabby", name: "Rabby Wallet", icon: "🐇" },
  { rdns: "app.phantom", name: "Phantom", icon: "👻" },
];

interface DetectedWallet {
  name: string;
  icon: string;
  provider: any;
}

function detectWallets(): DetectedWallet[] {
  if (typeof window === "undefined") return [];

  const wallets: DetectedWallet[] = [];
  const seen = new Set<string>();

  // EIP-6963: standardized wallet discovery
  const eip6963Providers = (window as any).__eip6963Providers;
  if (Array.isArray(eip6963Providers)) {
    for (const p of eip6963Providers) {
      const info = p.info;
      if (info?.rdns && !seen.has(info.rdns)) {
        seen.add(info.rdns);
        const known = KNOWN_WALLETS.find((w) => w.rdns === info.rdns);
        wallets.push({
          name: known?.name || info.name || "Wallet",
          icon: known?.icon || "🌐",
          provider: p.provider,
        });
      }
    }
  }

  // Fallback: check window.ethereum.providers array (legacy multi-wallet)
  const providers = (window.ethereum as any)?.providers;
  if (Array.isArray(providers)) {
    for (const p of providers) {
      if (p.isMetaMask && !seen.has("io.metamask")) {
        seen.add("io.metamask");
        wallets.push({ name: "MetaMask", icon: "🦊", provider: p });
      }
      if ((p as any).isOkxWallet && !seen.has("com.okex.wallet")) {
        seen.add("com.okex.wallet");
        wallets.push({ name: "OKX Wallet", icon: "⬡", provider: p });
      }
      if ((p as any).isCoinbaseWallet && !seen.has("com.coinbase.wallet")) {
        seen.add("com.coinbase.wallet");
        wallets.push({ name: "Coinbase Wallet", icon: "🔵", provider: p });
      }
    }
  }

  // Fallback: single window.ethereum
  if (wallets.length === 0 && window.ethereum) {
    const name = window.ethereum.isMetaMask
      ? "MetaMask"
      : (window.ethereum as any).isOkxWallet
      ? "OKX Wallet"
      : "Browser Wallet";
    const icon = window.ethereum.isMetaMask
      ? "🦊"
      : (window.ethereum as any).isOkxWallet
      ? "⬡"
      : "🌐";
    wallets.push({ name, icon, provider: window.ethereum });
  }

  return wallets;
}

export default function WalletModal() {
  const { showWalletModal, setShowWalletModal, connectWithProvider } = useWeb3();

  if (!showWalletModal) return null;

  const wallets = detectWallets();

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm"
      onClick={() => setShowWalletModal(false)}
    >
      <div
        className="bg-white rounded-2xl shadow-xl w-full max-w-sm mx-4 overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b">
          <h2 className="text-lg font-bold">Connect Wallet</h2>
          <button
            onClick={() => setShowWalletModal(false)}
            className="text-muted hover:text-fg text-xl leading-none"
          >
            ✕
          </button>
        </div>

        {/* Wallet list */}
        <div className="p-4 space-y-2">
          {wallets.length === 0 ? (
            <div className="text-center py-8 space-y-3">
              <p className="text-muted text-sm">No wallet detected</p>
              <a
                href="https://metamask.io/download/"
                target="_blank"
                rel="noopener noreferrer"
                className="text-sm font-semibold underline hover:text-fg"
              >
                Install MetaMask →
              </a>
            </div>
          ) : (
            wallets.map((w) => (
              <button
                key={w.name}
                onClick={() => connectWithProvider(w.provider)}
                className="w-full flex items-center gap-4 px-4 py-3 rounded-xl hover:bg-surface-alt transition-colors text-left"
              >
                <span className="text-2xl w-10 text-center">{w.icon}</span>
                <span className="font-semibold text-sm">{w.name}</span>
              </button>
            ))
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-3 border-t text-center">
          <p className="text-xs text-muted">
            Connects to Robinhood Testnet automatically
          </p>
        </div>
      </div>
    </div>
  );
}
