# HoodGap Protocol

> **Weekend Gap Insurance for Stock Positions** — Protect your portfolio against overnight price movements when traditional markets are closed.

[![Solidity](https://img.shields.io/badge/Solidity-0.8.20-blue)](https://soliditylang.org)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)
[![Built on Robinhood Chain](https://img.shields.io/badge/Robinhood%20Chain-Testnet-purple)](https://chain.robinhood.com)

## What is HoodGap?

HoodGap is a decentralized insurance protocol that lets stock investors hedge against **weekend gap risk** — the price difference between Friday's close and Monday's open.

| Role | What you do | What you earn |
|------|-------------|---------------|
| **Policy Buyer** | Pay a premium to insure your position | Receive full coverage payout if the gap exceeds your threshold |
| **Staker** | Provide USDC liquidity to the pool | Earn 93% of all premiums collected |
| **Guardian** | Approve weekly settlements, manage splits | Ensures protocol operates correctly |

### How It Works

```
Friday 4pm    → Oracle records Tesla closing price
Weekend       → Users buy gap insurance policies  
Monday 9:30am → Oracle updates with opening price
Monday+       → Policies settle: gap ≥ threshold = payout
```

## Quick Start

### Prerequisites

- Node.js ≥ 18
- MetaMask or any Web3 wallet
- Hardhat

### 1. Install Dependencies

```bash
npm install
cd frontend && npm install && cd ..
```

### 2. Configure Environment

```bash
cp .env.example .env
# Edit .env with your private key and RPC URL
```

### 3. Local Development

```bash
# Terminal 1: Start local blockchain
npm run node

# Terminal 2: Deploy contracts
npm run deploy:local

# Terminal 3: Seed the pool with test liquidity
npx hardhat run scripts/seed-liquidity.js --network localhost

# Terminal 4: Start frontend
cd frontend && npm run dev
```

### 4. Run the Full Demo (localhost)

```bash
npx hardhat run scripts/demo-lifecycle.js --network localhost
```

This time-travel demo walks through the complete lifecycle:
1. Deploy & seed pool with $100k USDC
2. Buy a $500 gap insurance policy (5% threshold)
3. Fast-forward to Monday with a simulated 8% gap
4. Settle the policy → full coverage payout
5. Staker withdraws remaining balance

### 5. Testnet Deployment

```bash
# Deploy to Robinhood Chain Testnet
npm run deploy:testnet

# Verify contracts on explorer
npx hardhat run scripts/verify.js --network robinhoodTestnet
```

## Architecture

```
contracts/
├── HoodGap.sol              # Main protocol (ERC721 + insurance logic)
├── HoodGapMath.sol           # Pure math library (premium, gap, timing)
├── interfaces/               # Chainlink + ERC20 interfaces
└── mocks/                    # MockUSDC + MockChainlinkOracle

frontend/                     # Next.js 15 application
├── app/                      # Pages: home, buy, stake, portfolio, admin
├── components/               # Insurance, staking, settlement, shared UI
├── contexts/                 # Web3, Contract, User providers
├── hooks/                    # useContract, useStaker, usePremium
└── lib/                      # Constants, formatting, validation, errors

scripts/
├── deploy.js                 # Production deployment
├── verify.js                 # Explorer verification
├── seed-liquidity.js         # Seed pool with test USDC
├── demo-lifecycle.js         # Full lifecycle time-travel demo
├── guardian-operations.js    # Guardian workflow helpers
└── simulate-weekend.js       # Weekend price simulation

docs/
├── ARCHITECTURE.md           # System design & data structures
├── MATHEMATICAL_MODEL.md     # Premium formulas & calibration (900+ lines)
├── BUSINESS_LOGIC.md         # Decision trees for all flows
├── SECURITY.md               # Threat model & attack analysis
├── GUARDIAN_MANUAL.md         # Guardian operations guide
└── API.md                    # Contract function reference
```

## Smart Contract API

### Core Functions

| Function | Description |
|----------|-------------|
| `stake(amount)` | Deposit USDC into the insurance pool |
| `requestWithdrawal(amount)` | Queue a withdrawal (instant if liquidity available) |
| `buyPolicy(coverage, threshold)` | Purchase gap insurance |
| `settlePolicy(policyId)` | Settle a policy after Monday open |
| `calculatePremium(coverage)` | View estimated premium for given coverage |

### Guardian Functions

| Function | Description |
|----------|-------------|
| `approveSettlement(week, splitRatio, reason)` | Approve weekly settlement |
| `queueVolatilityChange(newVol, reason)` | Queue volatility update (24h timelock) |
| `queueHolidayMultiplier(week, multiplier, reason)` | Queue holiday override (24h timelock) |
| `pause() / unpause()` | Emergency protocol controls |

### View Functions

| Function | Returns |
|----------|---------|
| `getPoolStats()` | totalStaked, totalCoverage, utilization, reserve, policyCount |
| `canSettle(week)` | allowed, splitRatio, reason |
| `canBuyPolicy(user, coverage, threshold)` | canBuy, reason, estimatedPremium |
| `getQueueStats()` | head, length, pending, dollarAhead, freeLiquidity |

## Premium Pricing Model

```
Premium = Base × Utilization × Volatility × Time Decay

Where:
  Base        = Coverage × 10% (annual base rate)
  Utilization = 1 + U²  (quadratic curve)
  Volatility  = σ_current / σ_average
  Time Decay  = 1 + (1.5% × hours since Friday close)
```

Premiums are bounded: **1% floor** to **95% ceiling** of coverage.

See [docs/MATHEMATICAL_MODEL.md](docs/MATHEMATICAL_MODEL.md) for complete derivations, worked examples, and calibration data.

## Network Configuration

| Network | Chain ID | RPC |
|---------|----------|-----|
| Hardhat Local | 31337 | `http://127.0.0.1:8545` |
| Robinhood Testnet | 46630 | `https://rpc.testnet.chain.robinhood.com` |

## Testing

```bash
# Run all tests
npm test

# Run with gas reporting
REPORT_GAS=true npm test

# Run specific test suite
npx hardhat test test/unit/PremiumCalculation.test.js
```

## Security

- **ReentrancyGuard** on all state-changing functions
- **24-hour timelocks** on guardian parameter changes
- **48-hour failsafe** auto-approves settlement if guardian is unresponsive
- **Oracle staleness checks** (1h for policy purchase, 24h for premium calc)
- **Checks-Effects-Interactions** pattern throughout

See [docs/SECURITY.md](docs/SECURITY.md) for full threat model.

## Roadmap

### V1 (Current) — TSLA Single-Asset

The current deployment supports Tesla (TSLA) gap insurance with a single pool and oracle feed. All core mechanics are live: premium pricing, policy issuance, settlement, staking, and guardian operations.

### V2 — Multi-Asset Expansion

The architecture is designed for multi-stock support via the **Factory pattern** — each equity gets its own independent HoodGap pool:

```
HoodGapFactory (deploy once)
    │
    ├── factory.createPool("TSLA", tslaPriceFeed)  → Pool #1  ✅ Live
    ├── factory.createPool("AAPL", aaplPriceFeed)  → Pool #2  🔜
    ├── factory.createPool("AMZN", amznPriceFeed)  → Pool #3  🔜
    └── factory.createPool("NVDA", nvdaPriceFeed)  → Pool #4  🔜
```

Each stock pool is fully independent with its own:
- Chainlink price oracle
- USDC liquidity pool and stakers
- Policy NFTs and settlement cycle
- Guardian approvals

**No changes to `HoodGap.sol` are needed** — V2 simply deploys new instances per equity, following the same pattern used by protocols like Uniswap (one contract per pair).

### V3 — Future Enhancements

- **Cross-pool staking** — stake once, earn from multiple pools
- **Dynamic volatility feeds** — on-chain implied volatility oracles
- **Governance** — decentralized guardian election via token voting
- **Options-style products** — directional gap bets (bull/bear)

## License

MIT
