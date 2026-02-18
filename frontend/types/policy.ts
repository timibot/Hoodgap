export interface Policy {
  holder: string;
  coverage: bigint;
  threshold: bigint;
  premium: bigint;
  purchaseTime: bigint;
  fridayClose: bigint;
  settlementWeek: bigint;
  settled: boolean;
  paidOut: boolean;
}

export interface PolicyDisplay {
  id: number;
  holder: string;
  coverageUsd: number;
  thresholdPercent: number;
  premiumUsd: number;
  purchaseDate: Date;
  settlementWeek: number;
  settled: boolean;
  paidOut: boolean;
  status: "active" | "settled-paid" | "settled-nopay" | "expired";
}
