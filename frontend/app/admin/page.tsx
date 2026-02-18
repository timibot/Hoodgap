"use client";

import { useState, useEffect, useCallback } from "react";
import { Contract } from "ethers";
import { useWeb3 } from "@/contexts/Web3Context";
import { useContract } from "@/hooks/useContract";
import { usePoolStats } from "@/hooks/useStaker";
import { ORACLE_ADDRESS } from "@/lib/constants";
import { formatDollars } from "@/lib/formatting";

const MOCK_ORACLE_ABI = [
  "function update(int256 _price, uint256 _updatedAt) external",
  "function price() view returns (int256)",
  "function updatedAt() view returns (uint256)",
];

const GAP_SCENARIOS = [
  { label: "No Gap (0%)", gap: 0 },
  { label: "Small (-3%)", gap: -3 },
  { label: "Threshold (-5%)", gap: -5 },
  { label: "Moderate (-8%)", gap: -8 },
  { label: "Large (-12%)", gap: -12 },
  { label: "Crash (-20%)", gap: -20 },
  { label: "Rally (+5%)", gap: 5 },
];

const ADMIN_PASSWORD = "HoOdGaP2026";
const AUTH_KEY = "hoodgap_admin_auth";

export default function AdminPage() {
  const { signer, status } = useWeb3();
  const { hoodgap } = useContract();
  const { stats, loading: statsLoading } = usePoolStats();

  // Password gate state
  const [authenticated, setAuthenticated] = useState(false);
  const [passwordInput, setPasswordInput] = useState("");
  const [passwordError, setPasswordError] = useState(false);

  // Check sessionStorage on mount
  useEffect(() => {
    if (typeof window !== "undefined" && sessionStorage.getItem(AUTH_KEY) === "true") {
      setAuthenticated(true);
    }
  }, []);

  function handlePasswordSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (passwordInput === ADMIN_PASSWORD) {
      setAuthenticated(true);
      setPasswordError(false);
      sessionStorage.setItem(AUTH_KEY, "true");
    } else {
      setPasswordError(true);
      setPasswordInput("");
    }
  }

  const [oraclePrice, setOraclePrice] = useState("");
  const [currentOraclePrice, setCurrentOraclePrice] = useState("—");
  const [oracleTimestamp, setOracleTimestamp] = useState("—");
  const [settlementWeek, setSettlementWeek] = useState("");
  const [splitRatio, setSplitRatio] = useState("10000");

  // Price override state
  const [overridePrice, setOverridePrice] = useState("");
  const [overrideChange, setOverrideChange] = useState("");
  const [overrideMarketCap, setOverrideMarketCap] = useState("");
  const [overrideActive, setOverrideActive] = useState(false);

  const [log, setLog] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  function addLog(msg: string) {
    setLog((prev) => [`[${new Date().toLocaleTimeString()}] ${msg}`, ...prev].slice(0, 50));
  }

  // Check if override is active
  useEffect(() => {
    fetch("/api/admin/override")
      .then((r) => r.json())
      .then((d) => {
        if (d.override) {
          setOverrideActive(true);
          if (d.override.price) setOverridePrice(d.override.price.toString());
          if (d.override.change) setOverrideChange(d.override.change.toString());
          if (d.override.marketCap) setOverrideMarketCap(d.override.marketCap.toString());
        }
      })
      .catch(() => {});
  }, []);

  // Fetch current oracle state
  useEffect(() => {
    if (status !== "connected" || !signer) return;
    async function fetchOracle() {
      try {
        const oracle = new Contract(ORACLE_ADDRESS, MOCK_ORACLE_ABI, signer);
        const price = await oracle.price();
        const updatedAt = await oracle.updatedAt();
        setCurrentOraclePrice(`$${(Number(price) / 1e8).toFixed(2)}`);
        setOracleTimestamp(new Date(Number(updatedAt) * 1000).toISOString());
      } catch {
        setCurrentOraclePrice("Error");
      }
    }
    fetchOracle();
    const interval = setInterval(fetchOracle, 10_000);
    return () => clearInterval(interval);
  }, [signer, status]);

  async function setOraclePriceManual() {
    if (!signer || !oraclePrice) return;
    setBusy(true);
    try {
      const oracle = new Contract(ORACLE_ADDRESS, MOCK_ORACLE_ABI, signer);
      const priceInt = BigInt(Math.round(parseFloat(oraclePrice) * 1e8));
      const block = await signer.provider?.getBlock("latest");
      const now = block?.timestamp ?? Math.floor(Date.now() / 1000);
      const tx = await oracle.update(priceInt, now);
      addLog(`Setting oracle to $${oraclePrice}...`);
      await tx.wait();
      addLog(`✅ Oracle updated to $${oraclePrice}`);
      setCurrentOraclePrice(`$${parseFloat(oraclePrice).toFixed(2)}`);
    } catch (err: any) {
      addLog(`❌ Failed: ${err.reason || err.message}`);
    }
    setBusy(false);
  }

  async function simulateGap(gapPercent: number) {
    if (!signer) return;
    setBusy(true);
    try {
      const oracle = new Contract(ORACLE_ADDRESS, MOCK_ORACLE_ABI, signer);
      const currentPrice = Number(await oracle.price()) / 1e8;
      const newPrice = currentPrice * (1 + gapPercent / 100);
      const priceInt = BigInt(Math.round(newPrice * 1e8));
      const block = await signer.provider?.getBlock("latest");
      const now = block?.timestamp ?? Math.floor(Date.now() / 1000);

      addLog(`Simulating ${gapPercent >= 0 ? "+" : ""}${gapPercent}% gap: $${currentPrice.toFixed(2)} → $${newPrice.toFixed(2)}`);
      const tx = await oracle.update(priceInt, now);
      await tx.wait();
      addLog(`✅ Oracle now $${newPrice.toFixed(2)}`);
      setCurrentOraclePrice(`$${newPrice.toFixed(2)}`);

      // Also set the display price override to match
      await applyOverride(newPrice, gapPercent);
    } catch (err: any) {
      addLog(`❌ Failed: ${err.reason || err.message}`);
    }
    setBusy(false);
  }

  async function applyOverride(price?: number, change?: number, marketCap?: number) {
    const body: any = { action: "set", ticker: "TSLA" };
    if (price !== undefined) body.price = price;
    if (change !== undefined) body.change = change;
    if (marketCap !== undefined) body.marketCap = marketCap;

    const res = await fetch("/api/admin/override", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (data.ok) {
      setOverrideActive(true);
      addLog(`✅ Display override applied`);
    }
  }

  async function applyDisplayOverride() {
    setBusy(true);
    try {
      const p = overridePrice ? parseFloat(overridePrice) : undefined;
      const c = overrideChange ? parseFloat(overrideChange) : undefined;
      const m = overrideMarketCap ? parseFloat(overrideMarketCap) : undefined;
      await applyOverride(p, c, m);
      addLog(`✅ Display prices overridden — Price: $${p || "API"}, Change: ${c ?? "API"}%, MCap: ${m ? `$${(m / 1e9).toFixed(0)}B` : "API"}`);
    } catch (err: any) {
      addLog(`❌ Override failed: ${err.message}`);
    }
    setBusy(false);
  }

  async function resetOverrides() {
    setBusy(true);
    try {
      await fetch("/api/admin/override", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "reset-all" }),
      });
      setOverrideActive(false);
      setOverridePrice("");
      setOverrideChange("");
      setOverrideMarketCap("");
      addLog("✅ All overrides cleared — reverting to live API data");
    } catch (err: any) {
      addLog(`❌ Reset failed: ${err.message}`);
    }
    setBusy(false);
  }

  async function approveSettlement() {
    if (!hoodgap || !settlementWeek) return;
    setBusy(true);
    try {
      const week = parseInt(settlementWeek);
      const ratio = parseInt(splitRatio);
      addLog(`Approving settlement for week ${week} (split: ${(ratio / 10000).toFixed(2)}x)...`);
      const tx = await hoodgap.approveSettlement(week, ratio, "Admin simulation");
      await tx.wait();
      addLog(`✅ Week ${week} settlement approved`);
    } catch (err: any) {
      addLog(`❌ Failed: ${err.reason || err.message}`);
    }
    setBusy(false);
  }

  async function getCurrentWeek() {
    if (!hoodgap) return;
    try {
      const week = await hoodgap.getCurrentSettlementWeek();
      setSettlementWeek(Number(week).toString());
      addLog(`Current settlement week: ${Number(week)}`);
    } catch (err: any) {
      addLog(`❌ Failed: ${err.reason || err.message}`);
    }
  }

  // Password gate
  if (!authenticated) {
    return (
      <div className="flex items-center justify-center py-24">
        <div className="w-full max-w-sm">
          <div className="border rounded-lg p-6 space-y-4">
            <div className="text-center">
              <div className="w-12 h-12 mx-auto mb-3 rounded-full bg-fg flex items-center justify-center">
                <span className="text-white text-lg">🔒</span>
              </div>
              <h1 className="text-lg font-bold">Admin Access</h1>
              <p className="text-sm text-muted mt-1">Enter password to continue</p>
            </div>
            <form onSubmit={handlePasswordSubmit} className="space-y-3">
              <input
                type="password"
                value={passwordInput}
                onChange={(e) => { setPasswordInput(e.target.value); setPasswordError(false); }}
                placeholder="Password"
                autoFocus
                className="w-full px-4 py-3 border rounded-lg text-sm focus:outline-none focus:border-fg transition-colors"
              />
              {passwordError && (
                <p className="text-xs text-red-500 font-medium">Incorrect password. Try again.</p>
              )}
              <button
                type="submit"
                disabled={!passwordInput}
                className="w-full py-3 bg-fg text-white font-semibold text-sm rounded-full hover:opacity-80 disabled:opacity-40 transition-opacity"
              >
                Unlock
              </button>
            </form>
          </div>
        </div>
      </div>
    );
  }

  if (status !== "connected") {
    return (
      <div className="text-center py-16">
        <p className="text-muted">Connect wallet to access admin panel.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold">Admin Panel</h1>
        <p className="text-sm text-muted">Simulate scenarios for testing and demonstration.</p>
      </div>

      {/* Pool Stats */}
      <div className="border rounded-lg p-4">
        <h2 className="text-sm font-semibold mb-3">Pool Status</h2>
        {statsLoading ? (
          <p className="text-sm text-muted">Loading...</p>
        ) : stats ? (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
            <div>
              <div className="text-xs text-muted">Total Staked</div>
              <div className="font-bold font-mono">{formatDollars(stats.totalStaked)}</div>
            </div>
            <div>
              <div className="text-xs text-muted">Total Coverage</div>
              <div className="font-bold font-mono">{formatDollars(stats.totalCoverage)}</div>
            </div>
            <div>
              <div className="text-xs text-muted">Utilization</div>
              <div className="font-bold font-mono">{stats.utilization.toFixed(1)}%</div>
            </div>
            <div>
              <div className="text-xs text-muted">Active Policies</div>
              <div className="font-bold font-mono">{stats.policyCount}</div>
            </div>
          </div>
        ) : (
          <p className="text-sm text-muted">No pool data</p>
        )}
      </div>

      {/* Display Price Override */}
      <div className={`border rounded-lg p-4 space-y-4 ${overrideActive ? "border-orange-300 bg-orange-50" : ""}`}>
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold">
            Display Price Override
            {overrideActive && (
              <span className="ml-2 text-xs font-normal text-orange-600 bg-orange-100 px-2 py-0.5 rounded-full">
                ACTIVE
              </span>
            )}
          </h2>
          {overrideActive && (
            <button
              onClick={resetOverrides}
              disabled={busy}
              className="px-3 py-1.5 text-xs font-semibold border border-red-300 text-red-600 rounded-lg hover:bg-red-50 transition-colors disabled:opacity-40"
            >
              ↩ Reset to Live API
            </button>
          )}
        </div>
        <p className="text-xs text-muted">
          Override the displayed price, % change, and market cap across the entire app.
          These overrides take priority over Yahoo Finance data.
        </p>
        <div className="grid grid-cols-3 gap-3">
          <div>
            <label className="text-xs text-muted">Price ($)</label>
            <input
              type="number"
              value={overridePrice}
              onChange={(e) => setOverridePrice(e.target.value)}
              placeholder="e.g. 380.50"
              className="w-full px-3 py-2 text-sm border rounded-lg focus:outline-none font-mono"
            />
          </div>
          <div>
            <label className="text-xs text-muted">24h Change (%)</label>
            <input
              type="number"
              value={overrideChange}
              onChange={(e) => setOverrideChange(e.target.value)}
              placeholder="e.g. -5.2"
              className="w-full px-3 py-2 text-sm border rounded-lg focus:outline-none font-mono"
            />
          </div>
          <div>
            <label className="text-xs text-muted">Market Cap ($)</label>
            <input
              type="number"
              value={overrideMarketCap}
              onChange={(e) => setOverrideMarketCap(e.target.value)}
              placeholder="e.g. 1300000000000"
              className="w-full px-3 py-2 text-sm border rounded-lg focus:outline-none font-mono"
            />
          </div>
        </div>
        <button
          onClick={applyDisplayOverride}
          disabled={busy || (!overridePrice && !overrideChange && !overrideMarketCap)}
          className="px-4 py-2 text-sm font-semibold bg-fg text-white rounded-lg hover:opacity-80 transition-opacity disabled:opacity-40"
        >
          Apply Display Override
        </button>
      </div>

      {/* Oracle Control */}
      <div className="border rounded-lg p-4 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold">On-Chain Oracle Control</h2>
          <button
            onClick={async () => {
              if (!signer) return;
              setBusy(true);
              try {
                addLog("Fetching live TSLA price...");
                const res = await fetch("/api/stock?ticker=TSLA");
                const data = await res.json();
                if (!data.price) throw new Error("No price from API");
                const livePrice = data.price;
                const oracle = new Contract(ORACLE_ADDRESS, MOCK_ORACLE_ABI, signer);
                const priceInt = BigInt(Math.round(livePrice * 1e8));
                const block = await signer.provider?.getBlock("latest");
                const now = block?.timestamp ?? Math.floor(Date.now() / 1000);
                const tx = await oracle.update(priceInt, now);
                await tx.wait();
                setCurrentOraclePrice(`$${livePrice.toFixed(2)}`);
                addLog(`✅ Oracle reset to live price: $${livePrice.toFixed(2)}`);
              } catch (err: any) {
                addLog(`❌ Reset failed: ${err.reason || err.message}`);
              }
              setBusy(false);
            }}
            disabled={busy}
            className="px-3 py-1.5 text-xs font-semibold border border-green-300 text-green-600 rounded-lg hover:bg-green-50 transition-colors disabled:opacity-40"
          >
            ↩ Reset to Live
          </button>
        </div>
        <div className="grid grid-cols-2 gap-4 text-sm">
          <div>
            <div className="text-xs text-muted">Current Oracle Price</div>
            <div className="font-bold font-mono text-lg">{currentOraclePrice}</div>
          </div>
          <div>
            <div className="text-xs text-muted">Last Updated</div>
            <div className="font-mono text-xs">{oracleTimestamp}</div>
          </div>
        </div>
        <div className="flex gap-2">
          <input
            type="number"
            value={oraclePrice}
            onChange={(e) => setOraclePrice(e.target.value)}
            placeholder="New price (e.g. 380.50)"
            className="flex-1 px-3 py-2 text-sm border rounded-lg focus:outline-none font-mono"
          />
          <button
            onClick={setOraclePriceManual}
            disabled={busy || !oraclePrice}
            className="px-4 py-2 text-sm font-semibold border rounded-lg hover:bg-fg hover:text-white transition-colors disabled:opacity-40"
          >
            Set Oracle
          </button>
        </div>
      </div>

      {/* Gap Simulator */}
      <div className="border rounded-lg p-4 space-y-3">
        <h2 className="text-sm font-semibold">Monday Opening Gap Simulator</h2>
        <p className="text-xs text-muted">
          Simulates a gap by updating both the on-chain oracle AND the displayed price.
        </p>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
          {GAP_SCENARIOS.map((s) => (
            <button
              key={s.label}
              onClick={() => simulateGap(s.gap)}
              disabled={busy}
              className={`py-2 px-3 text-xs font-semibold border rounded-lg transition-colors disabled:opacity-40 ${
                s.gap < -10
                  ? "border-red-300 text-red-600 hover:bg-red-50"
                  : s.gap < 0
                  ? "border-orange-300 text-orange-600 hover:bg-orange-50"
                  : s.gap === 0
                  ? "border-gray-300 text-gray-600 hover:bg-gray-50"
                  : "border-green-300 text-green-600 hover:bg-green-50"
              }`}
            >
              {s.label}
            </button>
          ))}
        </div>
      </div>

      {/* Settlement */}
      <div className="border rounded-lg p-4 space-y-4">
        <h2 className="text-sm font-semibold">Settlement Control</h2>
        <div className="flex gap-2 items-end">
          <div className="flex-1">
            <label className="text-xs text-muted">Settlement Week</label>
            <div className="flex gap-2">
              <input
                type="number"
                value={settlementWeek}
                onChange={(e) => setSettlementWeek(e.target.value)}
                placeholder="Week #"
                className="flex-1 px-3 py-2 text-sm border rounded-lg focus:outline-none font-mono"
              />
              <button
                onClick={getCurrentWeek}
                className="px-3 py-2 text-xs font-semibold border rounded-lg hover:bg-surface-alt"
              >
                Auto
              </button>
            </div>
          </div>
          <div className="w-32">
            <label className="text-xs text-muted">Split Ratio</label>
            <select
              value={splitRatio}
              onChange={(e) => setSplitRatio(e.target.value)}
              className="w-full px-3 py-2 text-sm border rounded-lg"
            >
              <option value="10000">1.0x (normal)</option>
              <option value="9500">0.95x</option>
              <option value="9000">0.90x</option>
              <option value="8000">0.80x (stock split)</option>
              <option value="20000">2.0x (reverse split)</option>
            </select>
          </div>
        </div>
        <button
          onClick={approveSettlement}
          disabled={busy || !settlementWeek}
          className="px-4 py-2 text-sm font-semibold bg-fg text-white rounded-lg hover:opacity-80 transition-opacity disabled:opacity-40"
        >
          Approve Settlement
        </button>
      </div>

      {/* Activity Log */}
      <div className="border rounded-lg p-4 space-y-2">
        <h2 className="text-sm font-semibold">Activity Log</h2>
        <div className="max-h-48 overflow-y-auto font-mono text-xs space-y-1">
          {log.length === 0 ? (
            <p className="text-muted">No activity yet. Use the controls above to simulate scenarios.</p>
          ) : (
            log.map((entry, i) => (
              <div key={i} className="text-muted">{entry}</div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
