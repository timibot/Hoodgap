export function calculateRisk(position: number, thresholdPercent: number): number {
  return position * (thresholdPercent / 100);
}

export function premiumPercent(premium: number, position: number): number {
  if (position <= 0) return 0;
  return (premium / position) * 100;
}

export function estimateQueueWait(
  dollarAhead: number,
  avgSettlementVolume = 50_000
): { days: number; settlements: number } {
  const settlementCycleDays = 7;
  const settlements = Math.ceil(dollarAhead / avgSettlementVolume);
  const days = settlements * (settlementCycleDays / 2);
  return { days: Math.max(days, 0), settlements };
}

export function calculateQueueProgress(
  dollarAhead: number,
  ownAmount: number,
  freeLiquidity: number
): number {
  const totalNeeded = dollarAhead + ownAmount;
  if (totalNeeded <= 0) return 100;
  const completed = Math.min(freeLiquidity, dollarAhead);
  return Math.max(0, Math.min(100, (completed / totalNeeded) * 100));
}
