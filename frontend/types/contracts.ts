import type { Contract } from "ethers";

export interface PoolStats {
  totalStaked: bigint;
  totalCoverage: bigint;
  reserveBalance: bigint;
  utilization: bigint;
  policyCount: bigint;
}

export interface WithdrawalRequest {
  staker: string;
  amount: bigint;
  requestTime: bigint;
  processed: boolean;
}

export interface QueueStats {
  head: bigint;
  total: bigint;
  pending: bigint;
}

export interface SettleStatus {
  allowed: boolean;
  splitRatio: bigint;
  reason: string;
}

export interface BuyPolicyStatus {
  allowed: boolean;
  premium: bigint;
  reason: string;
}

export type HoodGapContract = Contract;
export type USDCContract = Contract;
