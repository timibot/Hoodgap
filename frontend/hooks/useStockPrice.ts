"use client";

import { useState, useEffect } from "react";
import { POLL_INTERVAL_MS } from "@/lib/constants";

export interface StockQuote {
  price: number;
  change: number;        // percentage, e.g. +1.5
  marketCap: string;     // formatted, e.g. "$1.2T"
  prevClose: number;
  loading: boolean;
}

const CACHE: Record<string, { data: StockQuote; ts: number }> = {};
const CACHE_TTL = 30_000; // 30s

function formatMarketCap(value: number): string {
  if (value >= 1e12) return `$${(value / 1e12).toFixed(1)}T`;
  if (value >= 1e9) return `$${(value / 1e9).toFixed(1)}B`;
  if (value >= 1e6) return `$${(value / 1e6).toFixed(0)}M`;
  return `$${value.toLocaleString()}`;
}

async function fetchQuote(ticker: string): Promise<StockQuote> {
  const cached = CACHE[ticker];
  if (cached && Date.now() - cached.ts < CACHE_TTL) return cached.data;

  try {
    const url = `/api/stock?ticker=${ticker}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const quote: StockQuote = {
      price: data.price ?? 0,
      change: data.change ?? 0,
      marketCap: data.marketCap ? formatMarketCap(data.marketCap) : "—",
      prevClose: data.prevClose ?? 0,
      loading: false,
    };
    CACHE[ticker] = { data: quote, ts: Date.now() };
    return quote;
  } catch (err) {
    console.error("Stock quote fetch failed:", err);
    return {
      price: 0,
      change: 0,
      marketCap: "—",
      prevClose: 0,
      loading: false,
    };
  }
}

export function useStockPrice(ticker: string): StockQuote {
  const [quote, setQuote] = useState<StockQuote>({
    price: 0,
    change: 0,
    marketCap: "—",
    prevClose: 0,
    loading: true,
  });

  useEffect(() => {
    let cancelled = false;

    async function load() {
      const q = await fetchQuote(ticker);
      if (!cancelled) setQuote(q);
    }

    load();
    const interval = setInterval(load, POLL_INTERVAL_MS * 4); // ~60s
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [ticker]);

  return quote;
}
