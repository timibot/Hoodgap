"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { usePoolStats } from "@/hooks/useStaker";
import { useStockPrice } from "@/hooks/useStockPrice";
import { formatDollars } from "@/lib/formatting";

export default function HomePage() {
  const router = useRouter();
  const { stats, loading: statsLoading } = usePoolStats();
  const quote = useStockPrice("TSLA");

  const liquidity = stats ? formatDollars(stats.freeLiquidity) : "—";
  const isPositive = quote.change >= 0;
  const isLoading = quote.loading || statsLoading;

  return (
    <div>
      <div className="border rounded-lg overflow-hidden">
        {/* Desktop header row - hidden on mobile */}
        <div className="hidden md:grid grid-cols-[2fr_1fr_1fr_1fr_1fr_auto] gap-4 items-center px-6 py-3 border-b bg-white">
          <h2 className="text-lg font-bold">Stocks</h2>
          <span className="text-xs text-muted font-medium">Price</span>
          <span className="text-xs text-muted font-medium">24h Change</span>
          <span className="text-xs text-muted font-medium">Market Cap</span>
          <span className="text-xs text-muted font-medium">Pool Liquidity</span>
          <span className="w-[200px]" />
        </div>

        {/* Mobile header - shown only on mobile */}
        <div className="md:hidden px-4 py-3 border-b bg-white">
          <h2 className="text-lg font-bold">Stocks</h2>
        </div>

        {/* Loading skeleton */}
        {isLoading ? (
          <div className="px-4 sm:px-6 py-6">
            <div className="animate-pulse space-y-4">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-gray-200" />
                <div className="space-y-2 flex-1">
                  <div className="h-4 bg-gray-200 rounded w-24" />
                  <div className="h-3 bg-gray-100 rounded w-16" />
                </div>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div className="h-8 bg-gray-100 rounded" />
                <div className="h-8 bg-gray-100 rounded" />
                <div className="h-8 bg-gray-100 rounded" />
                <div className="h-8 bg-gray-100 rounded" />
              </div>
            </div>
          </div>
        ) : (
          <>
            {/* Desktop row */}
            <div
              onClick={() => router.push("/stock/tsla")}
              className="hidden md:grid grid-cols-[2fr_1fr_1fr_1fr_1fr_auto] gap-4 items-center px-6 py-4 hover:bg-surface-alt transition-colors cursor-pointer"
            >
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-black flex items-center justify-center shrink-0">
                  <span className="text-white text-lg font-bold">T</span>
                </div>
                <div>
                  <div className="font-semibold text-sm">
                    Tesla<span className="text-muted font-normal">/ TSLA</span>
                  </div>
                  <div className="text-xs text-muted uppercase">STOCK</div>
                </div>
              </div>

              <div className="font-bold font-mono">${quote.price.toFixed(2)}</div>
              <div className={`font-medium ${isPositive ? "text-positive" : "text-red-500"}`}>
                {isPositive ? "+" : ""}{quote.change.toFixed(2)}%
              </div>
              <div className="font-mono">{quote.marketCap}</div>
              <div className="font-mono">{liquidity}</div>

              <div className="flex items-center gap-2 w-[200px]">
                <Link
                  href="/buy"
                  onClick={(e) => e.stopPropagation()}
                  className="px-4 py-2 bg-fg text-white text-xs font-semibold rounded-full hover:opacity-80 transition-opacity"
                >
                  Buy Insurance
                </Link>
                <Link
                  href="/stake"
                  onClick={(e) => e.stopPropagation()}
                  className="px-4 py-2 border text-xs font-semibold rounded-full hover:bg-surface-alt transition-colors"
                >
                  Stake
                </Link>
              </div>
            </div>

            {/* Mobile card layout */}
            <div
              onClick={() => router.push("/stock/tsla")}
              className="md:hidden px-4 py-4 hover:bg-surface-alt transition-colors cursor-pointer space-y-4"
            >
              {/* Stock name row */}
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-black flex items-center justify-center shrink-0">
                  <span className="text-white text-lg font-bold">T</span>
                </div>
                <div className="flex-1">
                  <div className="font-semibold text-sm">
                    Tesla<span className="text-muted font-normal ml-1">/ TSLA</span>
                  </div>
                  <div className="text-xs text-muted uppercase">STOCK</div>
                </div>
                <div className="text-right">
                  <div className="font-bold font-mono">${quote.price.toFixed(2)}</div>
                  <div className={`text-xs font-medium ${isPositive ? "text-positive" : "text-red-500"}`}>
                    {isPositive ? "+" : ""}{quote.change.toFixed(2)}%
                  </div>
                </div>
              </div>

              {/* Stats grid */}
              <div className="grid grid-cols-2 gap-3">
                <div className="bg-surface-alt rounded-lg px-3 py-2">
                  <div className="text-[10px] text-muted uppercase tracking-wider">Market Cap</div>
                  <div className="font-mono text-sm font-medium mt-0.5">{quote.marketCap}</div>
                </div>
                <div className="bg-surface-alt rounded-lg px-3 py-2">
                  <div className="text-[10px] text-muted uppercase tracking-wider">Pool Liquidity</div>
                  <div className="font-mono text-sm font-medium mt-0.5">{liquidity}</div>
                </div>
              </div>

              {/* Action buttons */}
              <div className="flex gap-2">
                <Link
                  href="/buy"
                  onClick={(e) => e.stopPropagation()}
                  className="flex-1 py-2.5 bg-fg text-white text-xs font-semibold rounded-full text-center hover:opacity-80 transition-opacity"
                >
                  Buy Insurance
                </Link>
                <Link
                  href="/stake"
                  onClick={(e) => e.stopPropagation()}
                  className="flex-1 py-2.5 border text-xs font-semibold rounded-full text-center hover:bg-surface-alt transition-colors"
                >
                  Stake
                </Link>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
