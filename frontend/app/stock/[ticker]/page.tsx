"use client";

import { useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import dynamic from "next/dynamic";
import { useWeb3 } from "@/contexts/Web3Context";
import { useUser } from "@/contexts/UserContext";
import { usePoolStats } from "@/hooks/useStaker";
import { useStockPrice } from "@/hooks/useStockPrice";
import { formatDollars, fromUSDC } from "@/lib/formatting";
import FaucetButton from "@/components/wallet/FaucetButton";

const TradingViewChart = dynamic(
  () => import("@/components/shared/TradingViewChart"),
  { ssr: false, loading: () => <div style={{ height: 220 }} className="border rounded-lg animate-pulse bg-surface-alt" /> }
);

const STOCKS: Record<string, { name: string; ticker: string; symbol: string }> = {
  tsla: {
    name: "Tesla",
    ticker: "TSLA",
    symbol: "NASDAQ:TSLA",
  },
};

const PRESET_AMOUNTS = [500, 1000, 1500, 2000];

type Mode = "insure" | "stake";

export default function StockPage() {
  const params = useParams();
  const router = useRouter();
  const ticker = (params.ticker as string)?.toLowerCase();
  const stock = STOCKS[ticker];

  const { status, connect } = useWeb3();
  const { usdcBalance } = useUser();
  const { stats } = usePoolStats();
  const quote = useStockPrice(stock?.ticker || "TSLA");

  const [amount, setAmount] = useState("");
  const [mode, setMode] = useState<Mode>("insure");

  if (!stock) {
    return (
      <div className="text-center py-20 space-y-4">
        <h2 className="text-xl font-bold">Stock not found</h2>
        <p className="text-sm text-muted">This stock is not available yet.</p>
        <Link href="/" className="text-sm underline hover:text-fg text-muted">
          Back to stocks
        </Link>
      </div>
    );
  }

  const balanceUsd = fromUSDC(usdcBalance);
  const liquidity = stats ? formatDollars(stats.freeLiquidity) : "—";
  const isPositive = quote.change >= 0;

  return (
    <div className="space-y-6">
      {/* Stock Header */}
      <div className="border rounded-lg p-5">
        {/* Desktop header */}
        <div className="hidden sm:flex items-center justify-between">
          <div className="flex items-center gap-3">
            <button onClick={() => router.push("/")} className="text-muted hover:text-fg text-sm">←</button>
            <div className="w-10 h-10 rounded-full bg-black flex items-center justify-center">
              <span className="text-white text-lg font-bold">{stock.ticker[0]}</span>
            </div>
            <div>
              <div className="font-semibold">
                {stock.name}<span className="text-muted font-normal">/ {stock.ticker}</span>
              </div>
              <div className="text-xs text-muted uppercase">STOCK</div>
            </div>
          </div>
          <div className="flex items-center gap-8">
            <div className="text-right">
              <div className="text-xl font-bold font-mono">
                {quote.loading ? "..." : `$${quote.price.toFixed(2)}`}
              </div>
              <span className={`text-sm font-medium ${isPositive ? "text-positive" : "text-red-500"}`}>
                {quote.loading ? "..." : `${isPositive ? "+" : ""}${quote.change.toFixed(2)}%`}
              </span>
            </div>
            <div className="text-right">
              <div className="text-xs text-muted">Market Cap</div>
              <div className="font-semibold font-mono">{quote.loading ? "..." : quote.marketCap}</div>
            </div>
            <div className="text-right">
              <div className="text-xs text-muted">Pool Liquidity</div>
              <div className="font-semibold font-mono">{liquidity}</div>
            </div>
          </div>
        </div>

        {/* Mobile header */}
        <div className="sm:hidden space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <button onClick={() => router.push("/")} className="text-muted hover:text-fg text-sm">←</button>
              <div className="w-9 h-9 rounded-full bg-black flex items-center justify-center">
                <span className="text-white font-bold">{stock.ticker[0]}</span>
              </div>
              <div>
                <div className="font-semibold text-sm">
                  {stock.name}<span className="text-muted font-normal ml-1">/ {stock.ticker}</span>
                </div>
                <div className="text-[10px] text-muted uppercase">STOCK</div>
              </div>
            </div>
            <div className="text-right">
              <div className="text-lg font-bold font-mono">
                {quote.loading ? "..." : `$${quote.price.toFixed(2)}`}
              </div>
              <span className={`text-xs font-medium ${isPositive ? "text-positive" : "text-red-500"}`}>
                {quote.loading ? "..." : `${isPositive ? "+" : ""}${quote.change.toFixed(2)}%`}
              </span>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="bg-surface-alt rounded-lg px-3 py-2">
              <div className="text-[10px] text-muted uppercase tracking-wider">Market Cap</div>
              <div className="font-mono text-sm font-medium mt-0.5">{quote.loading ? "..." : quote.marketCap}</div>
            </div>
            <div className="bg-surface-alt rounded-lg px-3 py-2">
              <div className="text-[10px] text-muted uppercase tracking-wider">Pool Liquidity</div>
              <div className="font-mono text-sm font-medium mt-0.5">{liquidity}</div>
            </div>
          </div>
        </div>
      </div>

      {/* Main Content: Chart + Sidebar */}
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_280px] gap-6 items-start">
        {/* Chart */}
        <div>
          <TradingViewChart symbol={stock.symbol} height={220} />
        </div>

        {/* Sidebar */}
        <div className="space-y-4">
          {/* Mode Tabs */}
          <div className="flex border rounded-lg overflow-hidden">
            <button
              onClick={() => setMode("insure")}
              className={`flex-1 py-2 text-xs font-semibold transition-colors ${
                mode === "insure"
                  ? "bg-fg text-white"
                  : "bg-white text-muted hover:text-fg"
              }`}
            >
              Buy Insurance
            </button>
            <button
              onClick={() => setMode("stake")}
              className={`flex-1 py-2 text-xs font-semibold transition-colors ${
                mode === "stake"
                  ? "bg-fg text-white"
                  : "bg-white text-muted hover:text-fg"
              }`}
            >
              Stake
            </button>
          </div>

          {/* Order Box */}
          <div className="border rounded-lg p-4 space-y-4">
            <div className="flex items-center justify-between">
              <span className="text-sm font-semibold">
                {mode === "insure" ? "Coverage" : "Liquidity Provision"}
              </span>
              <span className="text-xs text-muted">Bal: {formatDollars(balanceUsd)}</span>
            </div>

            <div className="flex border rounded-lg overflow-hidden">
              <span className="px-3 py-2 text-xs text-muted bg-surface-alt border-r">Amount</span>
              <input
                type="number"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder={mode === "insure" ? "Amount to insure" : "Amount to stake"}
                className="flex-1 px-3 py-2 text-sm font-mono focus:outline-none"
              />
              <span className="px-3 py-2 text-xs text-muted bg-surface-alt border-l">USDC</span>
            </div>

            <div className="grid grid-cols-4 gap-2">
              {PRESET_AMOUNTS.map((preset) => (
                <button
                  key={preset}
                  onClick={() => setAmount(preset.toString())}
                  className={`py-1.5 text-xs font-medium border rounded-lg transition-colors ${
                    amount === preset.toString()
                      ? "border-fg bg-fg text-white"
                      : "border-border text-muted hover:border-border-dark hover:text-fg"
                  }`}
                >
                  {preset.toLocaleString()}
                </button>
              ))}
            </div>
          </div>

          {/* CTA */}
          <div className="space-y-2">
            {status === "connected" ? (
              <Link
                href={mode === "insure" ? "/buy" : "/stake"}
                className="btn-primary block text-center"
              >
                {mode === "insure" ? "Buy Insurance" : "Stake USDC"}
              </Link>
            ) : (
              <button onClick={connect} className="btn-primary block w-full">
                Connect wallet
              </button>
            )}
            <FaucetButton />
          </div>
        </div>
      </div>
    </div>
  );
}
