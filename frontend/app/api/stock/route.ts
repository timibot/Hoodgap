import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { getOverride } from "@/lib/priceOverrides";

export const dynamic = "force-dynamic";
export const revalidate = 0;

// Known shares outstanding for market cap fallback calculation
const SHARES_OUTSTANDING: Record<string, number> = {
  TSLA: 3.224e9,
};

export async function GET(request: NextRequest) {
  const ticker = request.nextUrl.searchParams.get("ticker") || "TSLA";

  // Check for admin override first
  const override = getOverride(ticker);

  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?interval=1d&range=2d`;
    const res = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0" },
    });

    if (!res.ok) {
      // If API fails but we have override, use override
      if (override) {
        return NextResponse.json({
          ticker: ticker.toUpperCase(),
          price: override.price ?? 0,
          prevClose: 0,
          change: override.change ?? 0,
          marketCap: override.marketCap ?? null,
          currency: "USD",
          overridden: true,
        });
      }
      return NextResponse.json({ error: `Yahoo Finance returned ${res.status}` }, { status: 502 });
    }

    const data = await res.json();
    const meta = data.chart?.result?.[0]?.meta;

    if (!meta) {
      return NextResponse.json({ error: "No data" }, { status: 404 });
    }

    const apiPrice = meta.regularMarketPrice ?? 0;
    const prevClose = meta.chartPreviousClose ?? meta.previousClose ?? apiPrice;
    const apiChange = prevClose > 0 ? ((apiPrice - prevClose) / prevClose) * 100 : 0;

    // Calculate market cap from shares outstanding if not in meta
    let apiMarketCap = meta.marketCap ?? null;
    if (!apiMarketCap && apiPrice > 0) {
      const shares = SHARES_OUTSTANDING[ticker.toUpperCase()];
      if (shares) apiMarketCap = Math.round(apiPrice * shares);
    }

    // Apply admin overrides (override takes priority)
    const finalPrice = override?.price ?? apiPrice;
    const finalChange = override?.change ?? apiChange;
    const finalMarketCap = override?.marketCap ?? apiMarketCap;

    return NextResponse.json({
      ticker: ticker.toUpperCase(),
      price: Math.round(finalPrice * 100) / 100,
      prevClose: Math.round(prevClose * 100) / 100,
      change: Math.round(finalChange * 100) / 100,
      marketCap: finalMarketCap,
      currency: meta.currency ?? "USD",
      overridden: !!override,
    });
  } catch (err: any) {
    // If fetch completely fails but we have override data, return it
    if (override) {
      return NextResponse.json({
        ticker: ticker.toUpperCase(),
        price: override.price ?? 0,
        prevClose: 0,
        change: override.change ?? 0,
        marketCap: override.marketCap ?? null,
        currency: "USD",
        overridden: true,
      });
    }
    console.error("Stock API error:", err);
    return NextResponse.json({ error: err.message || "Fetch failed" }, { status: 500 });
  }
}
