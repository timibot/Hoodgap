# HoodGap Protocol

> **Your stocks don't stop moving just because the market closes.** HoodGap is gap insurance for the moments you can't trade — when prices shift between sessions and you're left watching.

[![Solidity](https://img.shields.io/badge/Solidity-0.8.20-blue)](https://soliditylang.org)
[![OpenZeppelin](https://img.shields.io/badge/OpenZeppelin-5.0-blueviolet)](https://openzeppelin.com/contracts)
[![Chainlink](https://img.shields.io/badge/Chainlink-Oracle-375BD2)](https://chain.link)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)
[![Built on Robinhood Chain](https://img.shields.io/badge/Robinhood%20Chain-Testnet-purple)](https://chain.robinhood.com)
[![Tests](https://img.shields.io/badge/Tests-Passing-brightgreen)](#testing)

---

## Table of Contents

- [The Problem](#the-problem)
- [How HoodGap Works](#how-hoodgap-works)
- [Quick Start](#quick-start)
- [Architecture](#architecture)
- [Smart Contract API](#smart-contract-api)
- [Premium Pricing Model](#premium-pricing-model)
- [Security](#security)
- [Testing](#testing)
- [Network Configuration](#network-configuration)
- [Roadmap](#roadmap)
- [Contributing](#contributing)
- [Disclaimer](#disclaimer)
- [License](#license)

---

## The Problem

You hold TSLA. The market closes at 4pm. Some earnings call happens, some tweet drops, some macro event hits — and by the time the bell rings again, your position has already moved 5%, 8%, maybe more. You couldn't sell. You couldn't hedge. You just had to sit there.

That's a **gap** — the price difference between one session's close and the next session's open. It happens every night, every weekend, every holiday. And regular investors on platforms like Robinhood have zero tools to manage it.

HoodGap fixes that.

| Role | What you do | What you get |
|------|-------------|--------------|
| **Buyer** | Pay a premium, pick your threshold | Full payout if the gap exceeds your threshold |
| **Staker** | Deposit USDC into the pool | Earn yield from every premium collected |
| **Guardian** | Approve weekly settlements | Keep the protocol running honestly |

---

## How HoodGap Works

```
Market closes  → Chainlink records the closing price
Markets closed → You buy gap insurance while you can't trade
Market opens   → Chainlink updates with the opening price
Settlement     → Gap ≥ your threshold? You get paid. Simple.
```

**Binary payout:** If the gap exceeds your chosen threshold (-5% or -10%), you receive your full coverage amount. If it doesn't, your premium goes to stakers. No partial payouts, no complicated math on your end.

---

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
npm run seed

# Terminal 4: Start frontend
cd frontend && npm run dev
```

### 4. Run the Full Demo (localhost)

```bash
npm run demo
```

Walks through the complete lifecycle:
1. Deploy & seed pool with $100k USDC
2. Buy a $500 gap insurance policy (5% threshold)
3. Fast-forward to next open with a simulated 8% gap
4. Settle the policy → full coverage payout
5. Staker withdraws remaining balance

### 5. Testnet Deployment

```bash
# Deploy to Robinhood Chain Testnet
npm run deploy:testnet

# Verify contracts on explorer
npm run verify:testnet
```

---

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
├── demo-split.js             # Split-ratio settlement demo
├── guardian-operations.js    # Guardian workflow helpers
├── simulate-weekend.js       # Weekend price simulation
├── gap-analysis.js           # Gap analysis tooling
└── refresh-oracle.js         # Manual oracle refresh utility

test/
├── unit/                     # 6 unit test suites
├── integration/              # 6 integration test suites
├── scenarios/                # 4 scenario-based test suites
└── helpers/                  # Shared test utilities

docs/
├── ARCHITECTURE.md           # System design & data structures
├── MATHEMATICAL_MODEL.md     # Premium formulas & calibration (900+ lines)
├── BUSINESS_LOGIC.md         # Decision trees for all flows
├── SECURITY.md               # Threat model & attack analysis
├── GUARDIAN_MANUAL.md        # Guardian operations guide
└── API.md                    # Contract function reference
```

---

## Smart Contract API

### Core Functions

| Function | Description |
|----------|-------------|
| `stake(amount)` | Deposit USDC into the insurance pool |
| `requestWithdrawal(amount)` | Queue a withdrawal (instant if liquidity available) |
| `buyPolicy(coverage, threshold)` | Purchase gap insurance |
| `settlePolicy(policyId)` | Settle a policy after the next market open |
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
|----------|---------|}
| `getPoolStats()` | totalStaked, totalCoverage, utilization, reserve, policyCount |
| `canSettle(week)` | allowed, splitRatio, reason |
| `canBuyPolicy(user, coverage, threshold)` | canBuy, reason, estimatedPremium |
| `getQueueStats()` | head, length, pending, dollarAhead, freeLiquidity |

---

## Premium Pricing Model

```
Premium = Base × Utilization × Volatility

Where:
  Base        = Coverage × Tier Rate (10.8% for -5%, 0.6% for -10%)
  Utilization = 1 + 0.5U + 0.5U²  (linear-quadratic blend)
  Volatility  = σ_current / σ_average
```

Premiums are bounded: **0.1% floor** to **95% ceiling** of coverage.

See [docs/MATHEMATICAL_MODEL.md](docs/MATHEMATICAL_MODEL.md) for derivations, worked examples, and calibration data.

---

## Security

We take this seriously. The protocol has multiple layers of defense, not because it looks good in a README, but because real money is at stake.

### Smart Contract Hardening

| Protection | Implementation |
|------------|----------------|
| **Reentrancy Guard** | All state-changing functions use OpenZeppelin's `ReentrancyGuard` |
| **Checks-Effects-Interactions** | State updated before any external call |
| **Integer Safety** | Solidity 0.8.20 built-in overflow/underflow protection |
| **Access Control** | `onlyOwner` via OpenZeppelin `Ownable` for all privileged ops |
| **Pausability** | Emergency `pause()` / `unpause()` to halt everything |

### Oracle Security

| Protection | Detail |
|------------|--------|
| **Staleness checks** | Purchase requires oracle updated within 24 hours |
| **Settlement timing** | Blocked until oracle provides data after market open |
| **Chainlink integration** | Battle-tested `AggregatorV3Interface` price feeds |

### Guardian Safeguards

The guardian has scoped powers with hard limits:

| ✅ Can | ❌ Cannot |
|--------|-----------|
| Pause / unpause | Withdraw staker funds |
| Approve settlements | Mint or transfer USDC |
| Queue volatility changes (24h timelock) | Modify the premium formula |
| Set holiday multipliers (24h timelock) | Change contract code or bypass timelocks |

> **48-hour failsafe:** If the guardian disappears, settlements auto-approve after 48 hours. The protocol never gets stuck.

### Attack Resistance

| Vector | Defense |
|--------|---------|
| **Flash Loans** | Policies require close→open time passage — can't profit in one tx |
| **Front-Running** | Deterministic pricing; front-runner pays the same premium |
| **Sybil** | Dynamic pricing applies identically regardless of address count |
| **Reentrancy** | `ReentrancyGuard` + USDC has no receive hooks |
| **Oracle Manipulation** | Multi-layer staleness checks + timing requirements |
| **DoS** | Queue processing is gas-bounded; policies settle individually |

### Emergency Procedures

| Scenario | Response |
|----------|----------|
| **Pool insolvency** | Reserve absorbs shortfall → reverts if insufficient until capital added |
| **Oracle failure** | Operations halt → guardian pauses → await recovery |
| **Guardian key compromise** | `transferOwnership()` to new address; 48h failsafe keeps settlements going |

### Recommendations

- Use a multisig (Gnosis Safe) for the guardian address
- Hardware wallet for key storage
- Monitor oracle health and pool utilization via the admin dashboard
- Get a third-party audit before mainnet

> Full threat model: [docs/SECURITY.md](docs/SECURITY.md)

---

## Testing

Comprehensive test suite — unit, integration, and scenario tests.

```bash
# Run all tests
npm test

# Run with gas reporting
REPORT_GAS=true npm test

# Run specific test suite
npx hardhat test test/unit/PremiumCalculation.test.js
```

### Test Structure

| Suite | Coverage |
|-------|----------|
| **Unit** (6 suites) | Premium calculation, gap math, staking, withdrawal queue, timing logic, access control |
| **Integration** (6 suites) | Full policy lifecycle, settlement flows, split ratios, multi-user scenarios |
| **Scenarios** (4 suites) | Edge cases, extreme utilization, market holidays, oracle failures |

---

## Network Configuration

| Network | Chain ID | RPC |
|---------|----------|-----|
| Hardhat Local | 31337 | `http://127.0.0.1:8545` |
| Robinhood Testnet | 46630 | `https://rpc.testnet.chain.robinhood.com` |

---

## Roadmap

### V1 (Current) — TSLA Single-Asset

Live on testnet. All core mechanics working: premium pricing, policy issuance, settlement, staking, guardian operations. Covers all 5 weekday gaps (Mon→Tue through Fri→Mon).

### V2 — Multi-Asset + Experience-Based Pricing

**Multi-stock support** via the Factory pattern — each equity gets its own independent pool:

```
HoodGapFactory (deploy once)
    │
    ├── factory.createPool("TSLA", tslaPriceFeed)  → Pool #1  ✅ Live
    ├── factory.createPool("AAPL", aaplPriceFeed)  → Pool #2  🔜
    ├── factory.createPool("AMZN", amznPriceFeed)  → Pool #3  🔜
    └── factory.createPool("NVDA", nvdaPriceFeed)  → Pool #4  🔜
```

Each pool is independent — its own oracle, liquidity, policies, and settlement cycle. No changes to `HoodGap.sol` needed. Same pattern as Uniswap (one contract per pair).

**Experience-based pricing** — the contract tracks actual payout history and feeds it back into premiums:

- On-chain `totalSettled` / `totalPaidOut` counters for a rolling loss ratio
- 12-week EMA smoothing — adapts to trends without overreacting to one bad week
- `lossMultiplier = max(1.0, EMA_lossRatio / target)` — premiums scale up when payouts run hot
- Replaces the manual `currentVolatility` parameter with data-driven pricing

### V3 — Future

- **Cross-pool staking** — deposit once, earn from multiple pools
- **On-chain volatility feeds** — implied volatility oracles
- **Governance** — decentralized guardian election via token voting
- **Directional products** — bull/bear gap bets
- **Yearly calibration** — annual on-chain snapshots to recalibrate base rates

---

## Contributing

We welcome contributions. Here's how:

1. Fork the repo
2. Create a branch: `git checkout -b feature/your-feature`
3. Commit: `git commit -m "feat: add your feature"`
4. Push: `git push origin feature/your-feature`
5. Open a Pull Request

Make sure:
- All existing tests pass (`npm test`)
- New features include tests
- Solidity follows `.solhint.json` and `.prettierrc`

---

## Disclaimer

> ⚠️ **This is experimental software on testnet.** It has not been audited. Do not use it with money you can't afford to lose. The authors are not liable for any losses.

---

## License

MIT — see [LICENSE](LICENSE) for details.
