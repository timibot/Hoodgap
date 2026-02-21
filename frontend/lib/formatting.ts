import { formatUnits, parseUnits } from "ethers";
import { USDC_DECIMALS } from "./constants";

export function formatUSD(amount: bigint | number, decimals = 2): string {
  const value =
    typeof amount === "bigint"
      ? Number(formatUnits(amount, USDC_DECIMALS))
      : amount;
  return value.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

export function formatDollars(value: number): string {
  return `$${value.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
}

export function formatBPS(bps: bigint | number): string {
  const value = typeof bps === "bigint" ? Number(bps) : bps;
  return `${(value / 100).toFixed(2)}%`;
}

export function shortenAddress(address: string, chars = 4): string {
  return `${address.slice(0, chars + 2)}...${address.slice(-chars)}`;
}

export function formatDate(date: Date): string {
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export function formatDateTime(date: Date): string {
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  });
}

export function formatDuration(seconds: number): string {
  if (seconds <= 0) return "now";
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);

  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

export function toUSDC(amount: number): bigint {
  // Truncate to 6 decimal places to avoid JS floating-point artifacts
  // e.g. 10000.300000000001 → "10000.300000"
  const truncated = amount.toFixed(USDC_DECIMALS);
  return parseUnits(truncated, USDC_DECIMALS);
}

export function fromUSDC(amount: bigint): number {
  return Number(formatUnits(amount, USDC_DECIMALS));
}

export function toBPS(percent: number): number {
  return percent * 100;
}
