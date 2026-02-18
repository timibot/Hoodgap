export interface UserState {
  address: string;
  usdcBalance: bigint;
  stakedBalance: bigint;
  activePolicies: number[];
  pendingWithdrawals: number[];
}

export type ConnectionStatus =
  | "disconnected"
  | "connecting"
  | "connected"
  | "wrong-network";
