# 1.4 BUSINESS LOGIC DECISION TREES

## **1.4.1 Policy Purchase Flow**

```text
User initiates buyPolicy(coverage, threshold)
│
├─→ CHECK: Is contract paused?
│   ├─→ YES: REJECT "Contract paused"
│   └─→ NO: Continue
│
├─→ CHECK: Is coverage > 0?
│   ├─→ NO: REJECT "Coverage must be > 0"
│   └─→ YES: Continue
│
├─→ CHECK: Is threshold valid (500-2000)?
│   ├─→ NO: REJECT "Threshold must be 5-20%"
│   └─→ YES: Continue
│
├─→ CHECK: Is totalCoverage + coverage ≤ totalStaked?
│   ├─→ NO: REJECT "Insufficient liquidity"
│   └─→ YES: Continue
│
├─→ CALCULATE: Premium = calculatePremium(coverage)
│   │
│   ├─→ CHECK: Is oracle fresh (<24 hours)?
│   │   ├─→ NO: REJECT "Oracle stale"
│   │   └─→ YES: Continue
│   │
│   ├─→ CALCULATE: Base = coverage × 0.1796
│   ├─→ CALCULATE: M_util = 1 + U²
│   ├─→ CALCULATE: M_vol = σ_curr / σ_avg
│   ├─→ CALCULATE: M_time = 1 + (0.015 × hours)
│   ├─→ COMBINE: Premium = Base × M_util × M_vol × M_time
│   │
│   ├─→ CHECK: Premium ≥ coverage × 0.01?
│   │   ├─→ NO: Premium = coverage × 0.01
│   │   └─→ YES: Continue
│   │
│   └─→ CHECK: Premium ≤ coverage × 0.95?
│       ├─→ NO: REJECT "Liquidity exhausted"
│       └─→ YES: Continue
│
├─→ TRANSFER: USDC from user to contract
│   ├─→ CHECK: User has sufficient USDC balance?
│   │   ├─→ NO: Transaction reverts
│   │   └─→ YES: Continue
│   │
│   └─→ CHECK: User has approved USDC spending?
│       ├─→ NO: Transaction reverts
│       └─→ YES: Transfer succeeds
│
├─→ SPLIT PREMIUM:
│   ├─→ Platform fee (2%): Reserve for team
│   ├─→ Reserve fund (5%): Add to reserveBalance
│   └─→ Stakers (93%): Remains in contract (increases pool value)
│
├─→ GET: Friday close price from oracle
│   ├─→ CHECK: Price > 0?
│   │   ├─→ NO: REJECT "Invalid price"
│   │   └─→ YES: Continue
│   │
│   └─→ STORE: fridayClose = oracle.latestPrice()
│
├─→ MINT: Policy NFT to user
│   ├─→ Generate: policyId = nextPolicyId++
│   ├─→ Mint: ERC721._mint(user, policyId)
│   └─→ Transfer: Ownership to user
│
├─→ STORE: Policy data
│   ├─→ holder = user address
│   ├─→ coverage = coverage amount
│   ├─→ threshold = threshold %
│   ├─→ premium = premium paid
│   ├─→ purchaseTime = block.timestamp
│   ├─→ fridayClose = oracle price
│   ├─→ settlementWeek = mondayOpenTime / 604800
│   ├─→ settled = false
│   └─→ paidOut = false
│
├─→ UPDATE: Global state
│   └─→ totalCoverage += coverage
│
└─→ EMIT: PolicyPurchased event
    └─→ SUCCESS: Return policyId
```

---

### **1.4.2 Settlement Flow**

```User calls settlePolicy(policyId)
│
├─→ LOAD: Policy from storage
│
├─→ CHECK: Is policy already settled?
│   ├─→ YES: REJECT "Already settled"
│   └─→ NO: Continue
│
├─→ CHECK: Is it Monday or later?
│   ├─→ NO: REJECT "Too early to settle"
│   └─→ YES: Continue
│
├─→ CHECK: Is settlement approved for this week?
│   ├─→ NO: REJECT "Awaiting guardian approval"
│   └─→ YES: Continue
│
├─→ GET: Monday price from oracle
│   ├─→ CALL: oracle.latestRoundData()
│   │
│   ├─→ CHECK: Oracle updated after Monday open?
│   │   ├─→ NO: REJECT "Oracle not updated yet"
│   │   └─→ YES: Continue
│   │
│   └─→ CHECK: Price > 0?
│       ├─→ NO: REJECT "Invalid price"
│       └─→ YES: mondayPrice = oracle price
│
├─→ GET: Friday price
│   └─→ fridayPrice = policy.fridayClose
│
├─→ GET: Split ratio
│   ├─→ ratio = splitRatios[policy.settlementWeek]
│   └─→ IF (ratio == 0) ratio = 10000  // Default 1.0x
│
├─→ CALCULATE: Adjusted Friday price
│   └─→ adjustedFriday = (fridayPrice × ratio) / 10000
│
├─→ CALCULATE: Gap percentage
│   ├─→ IF (mondayPrice > adjustedFriday)
│   │   └─→ gap = ((mondayPrice - adjustedFriday) × 10000) / adjustedFriday
│   └─→ ELSE
│       └─→ gap = ((adjustedFriday - mondayPrice) × 10000) / adjustedFriday
│
├─→ SET: policy.settled = true
│
├─→ UPDATE: totalCoverage -= policy.coverage
│
├─→ CHECK: Does gap exceed threshold?
│   │
│   ├─→ YES: Gap ≥ threshold
│   │   │
│   │   ├─→ CHECK: Solvency
│   │   │   ├─→ IF (totalStaked < policy.coverage)
│   │   │   │   ├─→ Calculate shortfall
│   │   │   │   ├─→ CHECK: Reserve has funds?
│   │   │   │   │   ├─→ YES: Use reserve
│   │   │   │   │   └─→ NO: REJECT "Pool insolvent"
│   │   │   │   └─→ Deduct from reserve + totalStaked
│   │   │   └─→ ELSE
│   │   │       └─→ totalStaked -= policy.coverage
│   │   │
│   │   ├─→ SET: policy.paidOut = true
│   │   │
│   │   ├─→ TRANSFER: USDC to policy holder
│   │   │   └─→ USDC.transfer(policy.holder, policy.coverage)
│   │   │
│   │   └─→ EMIT: PolicyPaidOut event
│   │
│   └─→ NO: Gap < threshold
│       └─→ Policy expires worthless (no payout)
│
└─→ EMIT: PolicySettled event
    └─→ SUCCESS
```

---

### 1.4.3 Staker Withdraw Flow

```Staker calls withdraw(amount)
│
├─→ CHECK: Does staker have sufficient balance?
│   ├─→ NO: REJECT "Insufficient balance"
│   └─→ YES: Continue
│
├─→ CALCULATE: Free liquidity
│   └─→ freeLiquidity = totalStaked - totalCoverage
│
├─→ CHECK: Is withdrawal amount ≤ free liquidity?
│   │
│   ├─→ NO: REJECT "Capital backing active policies"
│   │   └─→ User must wait for policies to settle
│   │
│   └─→ YES: Continue
│
├─→ UPDATE: Staker balance
│   └─→ stakerBalances[user] -= amount
│
├─→ UPDATE: Total staked
│   └─→ totalStaked -= amount
│
├─→ TRANSFER: USDC to staker
│   └─→ USDC.transfer(user, amount)
│
└─→ EMIT: Withdrawn event
    └─→ SUCCESS
```

---
