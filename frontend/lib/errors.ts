/**
 * Parse blockchain/wallet errors into user-friendly messages.
 */
export function parseTransactionError(err: any): string {
  const raw: string = err?.reason || err?.message || "Transaction failed";

  // User rejected in wallet
  if (raw.includes("user rejected") || raw.includes("ACTION_REJECTED") || err?.code === "ACTION_REJECTED") {
    return "Transaction cancelled by user";
  }

  // Gas estimation failures
  if (raw.includes("cannot estimate gas") || raw.includes("UNPREDICTABLE_GAS_LIMIT")) {
    return "Transaction would fail — check your balance and inputs";
  }

  // Insufficient funds
  if (raw.includes("insufficient funds") || raw.includes("INSUFFICIENT_FUNDS")) {
    return "Not enough ETH for gas fees";
  }

  // Common contract revert reasons
  const revertMap: Record<string, string> = {
    "Amount must be > 0": "Enter an amount greater than zero",
    "Insufficient staker balance": "You don't have enough staked to withdraw this amount",
    "USDC transfer failed": "USDC transfer failed — check your balance and approval",
    "Invalid coverage amount": "Coverage must be between $1 and $50,000",
    "Contract is paused": "The protocol is currently paused for maintenance",
    "Oracle price is stale": "Price feed is outdated — try again shortly",
    "Insufficient USDC balance": "You don't have enough USDC",
  };

  for (const [key, friendly] of Object.entries(revertMap)) {
    if (raw.includes(key)) return friendly;
  }

  // Truncate very long error messages
  if (raw.length > 120) {
    return raw.slice(0, 117) + "...";
  }

  return raw;
}
