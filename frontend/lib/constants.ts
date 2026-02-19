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

export const MAX_POLICY_COVERAGE = 50_000;
export const MIN_THRESHOLD = 500;
export const MAX_THRESHOLD = 2000;
export const PLATFORM_FEE_BPS = 200;
export const RESERVE_CUT_BPS = 500;
export const FAILSAFE_DELAY = 48 * 3600;
export const MAX_QUEUE_PROCESS = 20;
export const USDC_DECIMALS = 6;

export const WEEK_SECONDS = 604_800;
export const WEEKEND_DURATION = 279_000;

export const THRESHOLD_OPTIONS = [5, 10, 15, 20] as const;
export const POLL_INTERVAL_MS = 15_000;
export const PREMIUM_DEBOUNCE_MS = 500;
