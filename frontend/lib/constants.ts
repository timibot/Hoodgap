import HoodGapArtifact from "@/abi/HoodGap.json";
const HoodGapABI = HoodGapArtifact.abi;
import ERC20ABI from "@/abi/ERC20.json";

export const HOODGAP_ADDRESS =
  process.env.NEXT_PUBLIC_HOODGAP_ADDRESS ?? "0x0000000000000000000000000000000000000000";
export const USDC_ADDRESS =
  process.env.NEXT_PUBLIC_USDC_ADDRESS ?? "0x0000000000000000000000000000000000000000";
export const ORACLE_ADDRESS =
  process.env.NEXT_PUBLIC_ORACLE_ADDRESS ?? "0x0000000000000000000000000000000000000000";

export const RPC_URL = process.env.NEXT_PUBLIC_RPC_URL ?? "https://rpc.testnet.chain.robinhood.com";
export const CHAIN_ID = Number(process.env.NEXT_PUBLIC_CHAIN_ID ?? "46630");

export const CHAIN_CONFIG = {
  31337: { name: "Hardhat Local", explorer: "" },
  46630: {
    name: "Robinhood Testnet",
    explorer: "https://explorer.testnet.chain.robinhood.com",
  },
  42042: {
    name: "Robinhood Mainnet",
    explorer: "https://explorer.robinhood.com",
  },
} as const;

// Full chain params for wallet_addEthereumChain
export const ROBINHOOD_TESTNET_PARAMS = {
  chainId: "0xB626", // 46630
  chainName: "Robinhood Testnet",
  nativeCurrency: { name: "Ethereum", symbol: "ETH", decimals: 18 },
  rpcUrls: ["https://rpc.testnet.chain.robinhood.com"],
  blockExplorerUrls: ["https://explorer.testnet.chain.robinhood.com"],
};

export { HoodGapABI, ERC20ABI };

// ─── Contract Constants ──────────────────────────────────────────
export const MAX_POLICY_COVERAGE = 50_000;
export const USDC_DECIMALS = 6;
export const FAILSAFE_DELAY = 48 * 3600;
export const MAX_QUEUE_PROCESS = 20;

// ─── Threshold Tiers ─────────────────────────────────────────────
export const THRESHOLD_5 = 500;  // -5% gap
export const THRESHOLD_10 = 1000; // -10% gap
export const THRESHOLD_OPTIONS = [
  { value: 500, label: "-5%", description: "Fires ~every 12 weeks" },
  { value: 1000, label: "-10%", description: "Fires ~every 5 years" },
] as const;

// ─── Tier Pricing (basis points of coverage per week) ────────────
export const TIER_5_RATE = 1080;   // 10.80% of coverage
export const TIER_10_RATE = 60;    // 0.60% of coverage

// ─── Premium Allocation ──────────────────────────────────────────
export const CLAIM_RESERVE_BPS = 7700;
export const STAKER_YIELD_BPS = 1800;
export const PROTOCOL_FEE_BPS = 300;
export const BLACK_SWAN_BPS = 200;

// ─── Subscription Plans ──────────────────────────────────────────
export const GAPS_PER_WEEK = 5;
export const PLAN_OPTIONS = [
  { weeks: 1, label: "Weekly", nfts: 5, discount: 0 },
  { weeks: 4, label: "4 Weeks", nfts: 20, discount: 400 },
  { weeks: 8, label: "8 Weeks", nfts: 40, discount: 1000 },
] as const;

// ─── Timing ──────────────────────────────────────────────────────
export const WEEK_SECONDS = 604_800;
export const POLL_INTERVAL_MS = 15_000;
export const PREMIUM_DEBOUNCE_MS = 500;
