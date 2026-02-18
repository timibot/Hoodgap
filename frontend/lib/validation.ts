import { MAX_POLICY_COVERAGE, MIN_THRESHOLD, MAX_THRESHOLD } from "./constants";

export interface ValidationResult {
  valid: boolean;
  error?: string;
}

export function validateCoverage(amount: number): ValidationResult {
  if (isNaN(amount) || amount <= 0) {
    return { valid: false, error: "Coverage must be greater than $0" };
  }
  if (amount > MAX_POLICY_COVERAGE) {
    return {
      valid: false,
      error: `Coverage cannot exceed $${MAX_POLICY_COVERAGE.toLocaleString()}`,
    };
  }
  return { valid: true };
}

export function validateThreshold(percent: number): ValidationResult {
  const bps = percent * 100;
  if (bps < MIN_THRESHOLD) {
    return { valid: false, error: `Minimum threshold is ${MIN_THRESHOLD / 100}%` };
  }
  if (bps > MAX_THRESHOLD) {
    return { valid: false, error: `Maximum threshold is ${MAX_THRESHOLD / 100}%` };
  }
  return { valid: true };
}

export function validatePosition(amount: number): ValidationResult {
  if (isNaN(amount) || amount <= 0) {
    return { valid: false, error: "Position must be greater than $0" };
  }
  if (amount > 10_000_000) {
    return { valid: false, error: "Position seems unreasonably large" };
  }
  return { valid: true };
}

export function validateStakeAmount(amount: number, balance: number): ValidationResult {
  if (isNaN(amount) || amount <= 0) {
    return { valid: false, error: "Amount must be greater than $0" };
  }
  if (amount > balance) {
    return { valid: false, error: "Insufficient USDC balance" };
  }
  return { valid: true };
}

export function validateWithdrawAmount(amount: number, stakedBalance: number): ValidationResult {
  if (isNaN(amount) || amount <= 0) {
    return { valid: false, error: "Amount must be greater than $0" };
  }
  if (amount > stakedBalance) {
    return { valid: false, error: "Cannot withdraw more than staked balance" };
  }
  return { valid: true };
}
