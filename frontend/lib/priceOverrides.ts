// Server-side in-memory store for admin price overrides
// These persist across requests within the same Next.js server process

export interface PriceOverride {
  price?: number;
  change?: number;
  marketCap?: number;
  timestamp: number;
}

const overrides: Record<string, PriceOverride> = {};

export function setOverride(ticker: string, data: Partial<PriceOverride>) {
  overrides[ticker.toUpperCase()] = {
    ...overrides[ticker.toUpperCase()],
    ...data,
    timestamp: Date.now(),
  };
}

export function getOverride(ticker: string): PriceOverride | null {
  return overrides[ticker.toUpperCase()] ?? null;
}

export function clearOverride(ticker: string) {
  delete overrides[ticker.toUpperCase()];
}

export function clearAllOverrides() {
  Object.keys(overrides).forEach((k) => delete overrides[k]);
}
