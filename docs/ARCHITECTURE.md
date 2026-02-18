# 1.1 FILE STRUCTURE

```text
hoodgap/
│
├── contracts/                          # Solidity smart contracts
│   ├── HoodGap.sol                    # Main protocol contract
│   ├── interfaces/                    # Interface definitions
│   │   ├── AggregatorV3Interface.sol  # Chainlink oracle interface
│   │   └── IERC20.sol                 # Token interface
│   └── mocks/                         # Testing mocks
│       ├── MockUSDC.sol               # Mock USDC for testing
│       ├── MockChainlinkOracle.sol    # Mock oracle for testing
│       └── MockERC20.sol              # Generic mock token
│
├── test/                              # Hardhat test suite
│   ├── unit/                          # Unit tests (pure functions)
│   │   ├── PremiumCalculation.test.js
│   │   ├── UtilizationMultiplier.test.js
│   │   ├── TimeDecay.test.js
│   │   └── SplitAdjustment.test.js
│   ├── integration/                   # Integration tests (multi-function)
│   │   ├── StakeWithdraw.test.js
│   │   ├── BuySettle.test.js
│   │   └── FullLifecycle.test.js
│   └── scenarios/                     # Scenario tests (real-world cases)
│       ├── StockSplit.test.js
│       ├── BankRun.test.js
│       ├── MultipleGaps.test.js
│       └── ExtremeVolatility.test.js
│
├── scripts/                           # Deployment and utility scripts
│   ├── deploy.js                      # Main deployment script
│   ├── verify.js                      # Contract verification
│   ├── seed-liquidity.js              # Seed initial liquidity
│   ├── demo-lifecycle.js              # 🆕 Time-travel demo
│   ├── simulate-weekend.js            # 🆕 Weekend simulation
│   └── guardian-operations.js         # 🆕 Guardian workflow helpers
│
├── frontend/                          # Next.js application
│   ├── app/                           # Next.js 15 app directory
│   │   ├── layout.tsx                 # Root layout
│   │   ├── page.tsx                   # Landing page
│   │   ├── buy/
│   │   │   └── page.tsx               # Buy insurance page
│   │   ├── stake/
│   │   │   └── page.tsx               # Become staker page
│   │   ├── portfolio/
│   │   │   └── page.tsx               # My policies page
│   │   └── dashboard/
│   │       └── page.tsx               # Staker dashboard
│   │
│   ├── components/                    # React components
│   │   ├── wallet/
│   │   │   ├── WalletConnect.tsx
│   │   │   └── NetworkCheck.tsx
│   │   ├── insurance/
│   │   │   ├── RiskWizard.tsx         # Coverage calculator
│   │   │   ├── PremiumQuote.tsx       # Premium display
│   │   │   └── PolicyCard.tsx         # Policy NFT card
│   │   ├── staking/
│   │   │   ├── StakeForm.tsx
│   │   │   ├── WithdrawForm.tsx
│   │   │   └── StakerStats.tsx
│   │   ├── settlement/
│   │   │   ├── SettlementCountdown.tsx
│   │   │   ├── OracleStatus.tsx
│   │   │   └── ClaimButton.tsx
│   │   └── shared/
│   │       ├── LoadingSpinner.tsx
│   │       ├── ErrorBoundary.tsx
│   │       └── TransactionToast.tsx
│   │
│   ├── contexts/                      # React contexts
│   │   ├── Web3Context.tsx            # Web3 provider state
│   │   ├── ContractContext.tsx        # Contract instances
│   │   └── UserContext.tsx            # User data state
│   │
│   ├── hooks/                         # Custom React hooks
│   │   ├── useContract.ts             # Contract interaction
│   │   ├── usePremium.ts              # Premium calculation
│   │   ├── usePolicy.ts               # Policy management
│   │   ├── useStaker.ts               # Staker operations
│   │   └── useSettlement.ts           # Settlement logic
│   │
│   ├── lib/                           # Utility libraries
│   │   ├── constants.ts               # Contract addresses, ABIs
│   │   ├── formatting.ts              # Number/date formatting
│   │   ├── validation.ts              # Input validation
│   │   └── calculations.ts            # Client-side math helpers
│   │
│   └── types/                         # TypeScript type definitions
│       ├── contracts.ts               # Contract types
│       ├── policy.ts                  # Policy types
│       └── user.ts                    # User types
│
├── docs/                              # Documentation
│   ├── ARCHITECTURE.md                # System architecture
│   ├── MATHEMATICAL_MODEL.md          # All formulas explained
│   ├── SECURITY.md                    # Security considerations
│   ├── GUARDIAN_MANUAL.md             # Guardian operations guide
│   └── API.md                         # Contract API reference
│
├── hardhat.config.js                  # Hardhat configuration
├── package.json                       # Node dependencies
├── tsconfig.json                      # TypeScript config
├── .env.example                       # Environment variables template
└── README.md                          # Main documentation
```

## 1.2 CORE DATA STRUCTURES

### 1.2.1 On-Chain Data (Solidity)

#### Policy Structure

```solidity
Purpose: Represents a single insurance policy (as NFT)
Storage: Mapping(uint256 => Policy)
Lifecycle: Created on purchase, settled on Monday

struct Policy {
    holder: address            // Owner of policy NFT (transferable)
    coverage: uint256          // Dollar amount insured (USDC, 6 decimals)
    threshold: uint256         // Gap % that triggers payout (basis points)
    premium: uint256           // Amount paid for policy (USDC, 6 decimals)
    purchaseTime: uint256      // Unix timestamp of purchase
    fridayClose: uint256       // Stock price at Friday close (8 decimals)
    settlementWeek: uint256    // Week identifier (mondayOpen / 604800)
    settled: bool              // Has policy been settled?
    paidOut: bool              // Did policy pay out?
}

Field Constraints:
- coverage: 1 USDC ≤ coverage ≤ 50,000 USDC (hardcoded max)
- threshold: 500 ≤ threshold ≤ 2000 (5%-20% in basis points)
- premium: Calculated on-chain, must pass bounds checks
- purchaseTime: Must be < mondayOpenTime
- fridayClose: Must be > 0 (from oracle)
- settlementWeek: Links to splitRatios mapping
- settled: Default false, set true once only
- paidOut: Default false, can be true only if settled = true

Example Instance:
{
    holder: 0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb5,
    coverage: 500000000,        // $500 (6 decimals)
    threshold: 500,             // 5% gap triggers payout
    premium: 90000000,          // $90 premium paid (6 decimals)
    purchaseTime: 1739570100,   // Friday 5:55 PM EST
    fridayClose: 20000000000,   // $200.00 (8 decimals)
    settlementWeek: 2870,       // Week 2870 since epoch
    settled: false,
    paidOut: false
}
```

#### Staker Balance Mapping

```text
Purpose: Track each staker's capital in the pool
Storage: Mapping(address => uint256)
Updates: On stake(), withdraw(), and settlement

mapping(address => uint256) stakerBalances

Characteristics:
- Simple accounting (not ERC-4626 vault for MVP)
- Balance represents USDC deposited (6 decimals)
- Proportional share = stakerBalance / totalStaked
- Earnings/losses automatically reflected in totalStaked

Example State:
stakerBalances[0xAlice] = 50000000000    // $50,000
stakerBalances[0xBob] = 100000000000     // $100,000
stakerBalances[0xCarol] = 350000000000   // $350,000
totalStaked = 500000000000               // $500,000

Alice's share = 50k / 500k = 10%
```

#### Global State Variables

```Purpose: Track pool-wide metrics and configuration

uint256 totalStaked           // Total USDC in pool (sum of all stakerBalances)
uint256 totalCoverage         // Total active coverage sold (sum of unsettled policies)
uint256 reserveBalance        // Emergency reserve (5% of premiums)
uint256 currentVolatility     // Current market volatility (basis points)

uint256 fridayCloseTime       // Next Friday 4pm EST (Unix timestamp)
uint256 mondayOpenTime        // Next Monday 9:30am EST (Unix timestamp)

bool paused                   // Emergency pause flag
address guardian              // Admin address (multisig in production)

uint256 nextPolicyId          // Counter for policy NFT IDs

Constants (immutable):
IERC20 USDC                   // USDC contract address
AggregatorV3Interface priceOracle  // Chainlink oracle address

uint256 constant BASE_RATE = 1796         // 17.96% in basis points
uint256 constant PLATFORM_FEE = 200       // 2%
uint256 constant RESERVE_CUT = 500        // 5%
uint256 constant AVG_VOLATILITY = 5000    // 50%
```

#### Split Ratio Mapping

```text
Purpose: Handle corporate actions (stock splits)
Storage: Mapping(uint256 => uint256)
Updates: Guardian sets before Monday settlement

mapping(uint256 => uint256) splitRatios
mapping(uint256 => bool) settlementApproved

Key: settlementWeek (uint256) = mondayOpenTime / 604800
Value: splitRatio (uint256) in basis points

Default: 10000 (1.0x, no split)
2:1 split: 5000 (0.5x)
3:1 split: 3333 (0.333x)
4:1 split: 2500 (0.25x)
1:2 reverse split: 20000 (2.0x)

Example State:
splitRatios[2870] = 10000       // Week 2870: No split
splitRatios[2871] = 5000        // Week 2871: 2:1 split announced
settlementApproved[2870] = true  // Settlement can proceed
settlementApproved[2871] = false // Awaiting guardian approval

Usage in Settlement:
fridayPrice = policy.fridayClose      // $800 (8 decimals)
ratio = splitRatios[policy.settlementWeek]  // 5000 (2:1 split)
if (ratio == 0) ratio = 10000               // Default to 1.0x
adjustedFriday = (fridayPrice × ratio) / 10000  // $800 × 0.5 = $400
mondayPrice = oracle.getPrice()               // $400
gap = |mondayPrice - adjustedFriday| / adjustedFriday  // 0%
```

### 1.2.2 Off-Chain Data (Frontend TypeScript)

#### Policy Type (Frontend)

```typescript
Purpose: Frontend representation of policy data
Source: Fetched from smart contract
Display: Policy cards, portfolio view

interface Policy {
    id: number;                    // Policy NFT ID
    coverage: number;              // Dollar amount (converted from USDC units)
    threshold: number;             // Percentage (5 = 5%)
    premium: number;               // Dollar amount paid
    purchaseTime: number;          // Unix timestamp
    fridayClose: number;           // Price in dollars (converted from 8 decimals)
    settlementWeek: number;        // Week identifier
    settled: boolean;
    paidOut: boolean;
    status: PolicyStatus;          // Computed status
    holder: string;                // Address (0x...)
}

enum PolicyStatus {
    ACTIVE = 'Active - Awaiting Settlement',
    SETTLED_WIN = 'Settled - Payout Received',
    SETTLED_LOSS = 'Settled - No Payout',
    EXPIRED = 'Expired',
    PENDING_SETTLEMENT = 'Pending - Oracle Not Updated'
}

Example Instance:
{
    id: 42,
    coverage: 500,
    threshold: 5,
    premium: 90,
    purchaseTime: 1739570100,
    fridayClose: 200.00,
    settlementWeek: 2870,
    settled: false,
    paidOut: false,
    status: PolicyStatus.ACTIVE,
    holder: '0x742d35Cc...'
}
```

#### User State

```text
Purpose: Track user's connection and holdings
Updates: On wallet connection, transactions, polling

interface UserState {
    address: string | null;           // Wallet address
    isConnected: boolean;             // Wallet connection status
    chainId: number | null;           // Current network
    usdcBalance: string;              // USDC balance (formatted)
    stakedBalance: string;            // Amount staked (formatted)
    policies: Policy[];               // User's policies
    pendingTransactions: Transaction[]; // Ongoing transactions
}

interface Transaction {
    hash: string;
    type: TransactionType;
    status: 'pending' | 'confirmed' | 'failed';
    timestamp: number;
}

enum TransactionType {
    APPROVE_USDC = 'Approve USDC',
    STAKE = 'Stake',
    WITHDRAW = 'Withdraw',
    BUY_POLICY = 'Buy Policy',
    SETTLE_POLICY = 'Settle Policy'
}
```

#### Pool Statistics

```Purpose: Display pool health metrics
Updates: Polled every 15 seconds
Display: Dashboard, stats bars

interface PoolStats {
    totalStaked: number;              // Total USDC in pool
    totalCoverage: number;            // Active coverage sold
    utilization: number;              // Percentage (0-100)
    utilizationMultiplier: number;    // Current multiplier (1.0-2.9)
    currentAPY: number;               // Estimated APY for stakers
    reserveBalance: number;           // Emergency reserve
    volatility: number;               // Current volatility (%)
    activePolicies: number;           // Count of unsettled policies
    totalStakers: number;             // Number of unique stakers
}

Calculation Examples:
utilization = (totalCoverage / totalStaked) × 100
utilizationMultiplier = 1 + (utilization/100)²
currentAPY = weeklyReturn × 52 (estimated from recent activity)
```

#### Premium Quote

```text
Purpose: Display premium calculation to user
Source: Calculated by frontend calling contract view function
Display: Risk Wizard, purchase confirmation

interface PremiumQuote {
    coverage: number;                 // Requested coverage
    basePremium: number;              // Before multipliers
    utilMultiplier: number;           // 1 + U²
    volMultiplier: number;            // σ_current / σ_avg
    timeMultiplier: number;           // Time decay factor
    finalPremium: number;             // Total amount to pay
    premiumRate: number;              // Premium as % of coverage
    timestamp: number;                // When calculated
    breakdown: PremiumBreakdown;      // Detailed breakdown
}

interface PremiumBreakdown {
    expectedLoss: number;             // Coverage × P_gap
    stakerYield: number;              // Coverage × APY/52
    utilizationAdjustment: number;    // Added by util multiplier
    volatilityAdjustment: number;     // Added by vol multiplier
    timeAdjustment: number;           // Added by time decay
    platformFee: number;              // 2% of premium
    reserveFee: number;               // 5% of premium
    toStakers: number;                // 93% of premium
}

Example:
{
    coverage: 500,
    basePremium: 89.80,
    utilMultiplier: 1.16,
    volMultiplier: 1.20,
    timeMultiplier: 1.30,
    finalPremium: 162.50,
    premiumRate: 32.5,
    timestamp: 1739572800,
    breakdown: {
        expectedLoss: 85.00,      // 500 × 17%
        stakerYield: 4.80,        // 500 × 0.96%
        utilizationAdjustment: 14.37,  // From 1.16x
        volatilityAdjustment: 17.96,   // From 1.20x
        timeAdjustment: 40.54,    // From 1.30x
        platformFee: 3.25,        // 2%
        reserveFee: 8.13,         // 5%
        toStakers: 151.12         // 93%
    }
}
```

### 2.1 COMPLETE CONTRACT STRUCTURE

### **2.1.1 Contract Architecture Overview**

```text
HoodGap.sol (Main Contract)
├── Inheritance
│   ├── ERC721 (OpenZeppelin) - Policy NFTs
│   ├── Ownable (OpenZeppelin) - Guardian controls
│   └── ReentrancyGuard (OpenZeppelin) - Attack protection
│
├── Interfaces
│   ├── IERC20 (USDC token)
│   └── AggregatorV3Interface (Chainlink oracle)
│
├── State Variables (59 total)
│   ├── Immutable (2)
│   ├── Constants (7)
│   ├── Configurable (3)
│   ├── Mappings (8)
│   └── Dynamic (4)
│
├── Core Functions (15)
│   ├── Staking (2): stake, requestWithdrawal
│   ├── Pricing (4): calculatePremium, get multipliers
│   ├── Policy (2): buyPolicy, settlePolicy
│   ├── Queue (3): processQueue, cancel, status
│   └── Guardian (4): approveSettlement, setRatio, override, pause
│
├── View Functions (12)
│   ├── Math (4): Utilization, volatility, time decay, gap
│   ├── State (5): Balances, stats, queue status
│   └── Calendar (3): Week number, Monday, Friday
│
└── Events (14)
```
