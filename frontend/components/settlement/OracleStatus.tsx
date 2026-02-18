"use client";

import { useState, useEffect } from "react";
import { useContract } from "@/hooks/useContract";
import { POLL_INTERVAL_MS } from "@/lib/constants";

export default function OracleStatus() {
  const { hoodgapReadOnly } = useContract();
  const [multiplier, setMultiplier] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!hoodgapReadOnly) return;
    async function fetch() {
      try {
        const m = Number(await hoodgapReadOnly.getTimeDecayMultiplier());
        setMultiplier(m);
      } catch {}
      finally { setLoading(false); }
    }
    fetch();
    const interval = setInterval(fetch, POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [hoodgapReadOnly]);

  if (loading) return null;
  const isFresh = multiplier !== null && multiplier <= 10_000;

  return (
    <div className="text-xs text-muted">
      Oracle: {isFresh ? "Fresh" : "Stale"}
    </div>
  );
}
