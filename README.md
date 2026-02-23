# HoodGap Protocol

> **Overnight Gap Insurance for Stock Positions** — Protect your portfolio against overnight price gaps when markets are closed.

[![Solidity](https://img.shields.io/badge/Solidity-0.8.20-blue)](https://soliditylang.org)
[![OpenZeppelin](https://img.shields.io/badge/OpenZeppelin-5.0-blueviolet)](https://openzeppelin.com/contracts)
[![Chainlink](https://img.shields.io/badge/Chainlink-Oracle-375BD2)](https://chain.link)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)
[![Built on Robinhood Chain](https://img.shields.io/badge/Robinhood%20Chain-Testnet-purple)](https://chain.robinhood.com)
[![Tests](https://img.shields.io/badge/Tests-Passing-brightgreen)](#testing)

---

## Table of Contents

- [What is HoodGap?](#what-is-hoodgap)
- [How It Works](#how-it-works)
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

## What is HoodGap?

HoodGap is a decentralized insurance protocol that lets stock investors hedge against **overnight gap risk** — the price difference between one session's close and the next session's open. Built on the Robinhood Chain and powered by Chainlink oracles, it provides trustless, on-chain coverage with transparent pricing.

| Role | What you do | What you earn |
|------|-------------|---------------|
| **Policy Buyer** | Pay a premium to insure your position | Receive full coverage payout if the gap exceeds your threshold |
| **Staker** | Provide USDC liquidity to the pool | Earn 93% of all premiums collected |
| **Guardian** | Approve weekly settlements, manage splits | Ensures protocol operates correctly |

### How It Works

```
Market Close  → Oracle records closing price
Off-hours     → Users buy gap insurance policies  
Market Open   → Oracle updates with opening price
Settlement    → Policies settle: gap ≥ threshold = payout
```

**Binary payout model:** If the overnight gap exceeds the buyer's chosen threshold, they receive their full coverage amount. If not, the premium is distributed to stakers.

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

This time-travel demo walks through the complete lifecycle:
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

---

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

---

## Security

Security is a first-class priority for HoodGap. The protocol is designed with multiple layers of defense-in-depth, following industry best practices from OpenZeppelin and the wider DeFi security community.

### Smart Contract Hardening

| Protection | Implementation |
|------------|---------------|
| **Reentrancy Guard** | All state-changing functions use OpenZeppelin's `ReentrancyGuard` modifier |
| **Checks-Effects-Interactions** | State is updated **before** any external call (e.g., USDC transfer) |
| **Integer Overflow/Underflow** | Solidity 0.8.20 built-in SafeMath — all arithmetic auto-reverts on overflow |
| **Access Control** | `onlyOwner` (guardian) on all privileged functions via OpenZeppelin `Ownable` |
| **Pausability** | Emergency `pause()` / `unpause()` via OpenZeppelin `Pausable` to halt all operations |

### Oracle Security

| Protection | Detail |
|------------|--------|
| **Staleness checks** | Policy purchase requires oracle updated within **1 hour**; premium calculation requires **24-hour** freshness |
| **Settlement timing** | Settlement blocked until oracle provides data **after** the next market open |
| **Time decay premium** | Stale oracle data increases premiums automatically, discouraging purchases on unreliable data |
| **Chainlink integration** | Uses battle-tested Chainlink `AggregatorV3Interface` price feeds |

### Guardian Safeguards

The guardian (admin) role has carefully scoped powers with built-in guardrails:

| ✅ Can | ❌ Cannot |
|--------|-----------|
| Pause / unpause the contract | Withdraw staker funds |
| Approve weekly settlements | Mint or transfer USDC |
| Queue volatility changes (*24h timelock*) | Modify the premium formula |
| Set holiday multipliers (*24h timelock*) | Change contract code |
| | Bypass 24-hour timelocks |

> **48-hour failsafe:** If the guardian is unresponsive, settlements auto-approve after 48 hours — the protocol is never permanently blocked.

### Attack Resistance

| Attack Vector | Defense |
|---------------|---------|
| **Flash Loans** | Policies require close→open time passage — cannot profit in a single transaction |
| **Front-Running** | On-chain deterministic pricing; front-runner pays the same or marginally higher premium |
| **Sybil Attacks** | Dynamic pricing applies identically regardless of address count — no benefit to splitting |
| **Reentrancy** | `ReentrancyGuard` + USDC has no receive hooks (unlike ERC-777) |
| **Oracle Manipulation** | Multi-layer staleness checks + timing requirements block stale/fake price data |
| **DoS (Queue Flooding)** | `processWithdrawalQueue` is gas-bounded (max 20–50 per call); policies settle individually |
| **Over-utilization** | Hard cap: `require(totalCoverage + coverage <= totalStaked)` — 100% utilization is the ceiling |

### Emergency Procedures

| Scenario | Protocol Response |
|----------|-------------------|
| **Pool insolvency** | Reserve balance absorbs shortfall → if insufficient, settlement reverts until capital is added |
| **Oracle failure** | Operations halt gracefully (staleness checks revert) → guardian pauses → await recovery |
| **Guardian key compromise** | `transferOwnership()` to new address; 48h failsafe ensures settlements proceed |

### Recommendations for Operators

- Use a **multisig** (e.g., Gnosis Safe) for the guardian address
- Store keys in a **hardware wallet**
- Monitor oracle health and pool utilization via the admin dashboard
- Consider a third-party audit before mainnet launch

> 📄 **Full threat model & attack scenarios:** [docs/SECURITY.md](docs/SECURITY.md)

---

## Testing

The protocol has a comprehensive test suite spanning unit, integration, and scenario tests.

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

The current deployment supports Tesla (TSLA) gap insurance with a single pool and oracle feed. All core mechanics are live: premium pricing, policy issuance, settlement, staking, and guardian operations.

### V2 — Multi-Asset Expansion + Experience-Based Pricing

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

#### Experience-Based Dynamic Pricing

V2 introduces **loss ratio–driven premium adjustment** — the contract tracks actual payout history and feeds it back into pricing:

- **On-chain counters:** `totalSettled` and `totalPaidOut` increment on every settlement, giving a rolling loss ratio
- **12-week EMA:** An exponential moving average smooths the loss ratio to avoid overreacting to a single bad week while still adapting to sustained trends
- **Premium multiplier:** `lossMultiplier = max(1.0, EMA_lossRatio / target_lossRatio)` — premiums scale up when payouts exceed expectations, protecting staker capital in real-time
- **Replaces manual volatility:** The current guardian-set `currentVolatility` parameter becomes data-driven, reducing trust assumptions

This mechanism ensures premiums stay actuarially fair without waiting for end-of-year recalibration.

### V3 — Future Enhancements

- **Cross-pool staking** — stake once, earn from multiple pools
- **Dynamic volatility feeds** — on-chain implied volatility oracles
- **Governance** — decentralized guardian election via token voting
- **Options-style products** — directional gap bets (bull/bear)
- **Yearly calibration reports** — annual on-chain snapshots of loss ratios, premium adequacy, and pool performance used to recalibrate base tier rates and model parameters

---

## Contributing

Contributions are welcome! To get started:

1. Fork the repository
2. Create a feature branch: `git checkout -b feature/your-feature`
3. Commit your changes: `git commit -m "feat: add your feature"`
4. Push to the branch: `git push origin feature/your-feature`
5. Open a Pull Request

Please ensure:
- All existing tests pass (`npm test`)
- New features include test coverage
- Solidity code follows the project's `.solhint.json` and `.prettierrc` style

---

## Disclaimer

> ⚠️ **This software is provided "as is", without warranty of any kind.** HoodGap is experimental DeFi software currently deployed on testnet only. It has not been audited by an independent third party. Do not use this protocol with funds you cannot afford to lose. The authors and contributors are not liable for any losses incurred through the use of this software.

---

## License

MIT — see [LICENSE](LICENSE) for details.
