# API Reference

## HoodGap.sol — Smart Contract API

### Core Functions

---

#### `stake(uint256 amount)`

Deposit USDC into the insurance pool.

| Param | Type | Description |
|-------|------|-------------|
| `amount` | `uint256` | USDC amount (6 decimals) |

**Preconditions:** Contract not paused, amount > 0, USDC approved.  
**Effects:** Increases `stakerBalances[msg.sender]` and `totalStaked`. Auto-processes withdrawal queue.  
**Emits:** `Staked(address staker, uint256 amount, uint256 timestamp)`

---

#### `requestWithdrawal(uint256 amount)`

Withdraw staked USDC. Instant if free liquidity is available; otherwise queued.

| Param | Type | Description |
|-------|------|-------------|
| `amount` | `uint256` | USDC amount to withdraw (6 decimals) |

**Logic:** If `amount <= freeLiquidity` → instant withdrawal. Otherwise → added to withdrawal queue.  
**Emits:** `WithdrawalProcessed` (instant) or `WithdrawalQueued` (queued)

---

#### `buyPolicy(uint256 coverage, uint256 threshold) → uint256 policyId`

Purchase gap insurance policy. Mints an ERC-721 NFT to the buyer.

| Param | Type | Description |
|-------|------|-------------|
| `coverage` | `uint256` | Coverage amount in USDC (6 decimals). Max: $50,000 |
| `threshold` | `uint256` | Gap trigger in basis points (500-2000 = 5%-20%) |

**Preconditions:** Contract not paused, sufficient pool liquidity, oracle fresh (< 1h), USDC approved for premium.  
**Premium split:** 2% platform fee, 5% reserve, 93% to stakers.  
**Returns:** `policyId` (uint256)  
**Emits:** `PolicyPurchased(buyer, policyId, coverage, threshold, premium, fridayClose, settlementWeek)`

---

#### `settlePolicy(uint256 policyId)`

Settle a policy after Monday market open. Pays out if gap ≥ threshold.

| Param | Type | Description |
|-------|------|-------------|
| `policyId` | `uint256` | Policy NFT ID to settle |

**Preconditions:** Not already settled, timestamp ≥ Monday open, settlement approved (or 48h failsafe).  
**Logic:** Calculates gap from oracle price vs adjusted Friday close. If gap ≥ threshold → transfers `coverage` USDC to holder.  
**Emits:** `PolicySettled`, `PolicyPaidOut` (if triggered)

---

#### `cancelWithdrawalRequest(uint256 requestId)`

Cancel a pending withdrawal request.

| Param | Type | Description |
|-------|------|-------------|
| `requestId` | `uint256` | Index in the withdrawal queue |

---

#### `processWithdrawalQueue(uint256 maxToProcess)`

Manually process pending withdrawals.

| Param | Type | Description |
|-------|------|-------------|
| `maxToProcess` | `uint256` | Max requests to process (1-50) |

---

### Guardian Functions

All require `onlyOwner` modifier.

---

#### `approveSettlement(uint256 week, uint256 splitRatio, string reason)`

Approve settlement for a specific week with a split ratio.

| Param | Type | Description |
|-------|------|-------------|
| `week` | `uint256` | Settlement week number |
| `splitRatio` | `uint256` | Split ratio in basis points (10000 = 1.0x, 5000 = 2:1 split) |
| `reason` | `string` | Human-readable reason |

---

#### `queueVolatilityChange(uint256 newVolatility, string reason)`

Queue a volatility update (24-hour timelock).

| Param | Type | Description |
|-------|------|-------------|
| `newVolatility` | `uint256` | New volatility in basis points (1000-15000 = 10%-150%) |
| `reason` | `string` | Reason for change |

---

#### `executeVolatilityChange()`

Execute a previously queued volatility change after 24h.

---

#### `cancelVolatilityChange()`

Cancel a pending volatility change.

---

#### `queueHolidayMultiplier(uint256 week, uint256 multiplier, string reason)`

Queue a holiday time decay multiplier override (24-hour timelock).

| Param | Type | Description |
|-------|------|-------------|
| `week` | `uint256` | Target week number |
| `multiplier` | `uint256` | Multiplier (10000-50000 = 1.0x-5.0x) |
| `reason` | `string` | Reason (e.g., "July 4th long weekend") |

---

#### `executeHolidayMultiplier(uint256 week)` / `cancelHolidayMultiplier(uint256 week)`

Execute or cancel a pending holiday multiplier.

---

#### `pause()` / `unpause()`

Emergency pause/resume. Blocks `stake()` and `buyPolicy()` while paused.

---

#### `setTreasury(address newTreasury)`

Update the address that receives platform fees.

---

### View Functions

---

#### `calculatePremium(uint256 coverage) → uint256`

Calculate the premium for a given coverage amount.

**Formula:** `Base × Utilization × Volatility × TimeDecay`  
**Bounds:** Min = 1% of coverage, Max = 95% of coverage  
**Reverts if:** Oracle stale (> 24h) or liquidity exhausted

---

#### `getPoolStats() → (totalStaked, totalCoverage, utilization, reserve, policyCount)`

Returns current pool health metrics.

| Return | Type | Description |
|--------|------|-------------|
| `totalStaked` | `uint256` | Total USDC in pool (6 decimals) |
| `totalCoverage` | `uint256` | Active coverage sold (6 decimals) |
| `utilization` | `uint256` | Utilization in basis points (0-10000) |
| `reserve` | `uint256` | Emergency reserve balance (6 decimals) |
| `policyCount` | `uint256` | Total policies created (nextPolicyId) |

---

#### `canSettle(uint256 week) → (bool allowed, uint256 splitRatio, string reason)`

Check whether settlement can proceed for a given week.

---

#### `canBuyPolicy(address user, uint256 coverage, uint256 threshold) → (bool canBuy, string reason, uint256 estimatedPremium)`

Pre-flight check before calling `buyPolicy()`. Checks pause state, liquidity, balance, and allowance.

---

#### `getQueueStats() → (head, length, pending, dollarAhead, freeLiquidity)`

Returns withdrawal queue status.

---

#### `getPolicies(uint256[] policyIds) → Policy[]`

Batch-fetch policy structs by ID.

---

#### `getUserWithdrawals(address user) → WithdrawalRequest[]`

Get all withdrawal requests for a user (including processed ones).

---

#### `getCurrentUtilization() → uint256`

Current pool utilization in basis points (0-10000).

---

#### `getUtilizationMultiplier(uint256 newCoverage) → uint256`

Get the utilization multiplier that would apply for a given coverage amount.

---

#### `getVolatilityMultiplier() → uint256`

Current volatility multiplier based on `currentVolatility / AVG_VOLATILITY`.

---

#### `getTimeDecayMultiplier() → uint256`

Current time decay multiplier based on hours since Friday close.

---

#### `calculateGap(uint256 priceA, uint256 priceB) → uint256`

Pure function to calculate gap percentage between two prices in basis points.

---

### Constants

| Constant | Value | Description |
|----------|-------|-------------|
| `BASE_RATE` | 1000 | 10% annual base rate |
| `PLATFORM_FEE` | 200 | 2% platform fee |
| `RESERVE_CUT` | 500 | 5% reserve cut |
| `AVG_VOLATILITY` | 5000 | 50% baseline volatility |
| `MAX_POLICY_COVERAGE` | 50000e6 | $50,000 max coverage |
| `MIN_THRESHOLD` | 500 | 5% minimum gap trigger |
| `MAX_THRESHOLD` | 2000 | 20% maximum gap trigger |
| `FAILSAFE_DELAY` | 48 hours | Auto-approve timeout |
| `VOLATILITY_TIMELOCK` | 24 hours | Parameter change delay |
| `HOLIDAY_TIMELOCK` | 24 hours | Holiday override delay |

---

### Events

| Event | Parameters |
|-------|-----------|
| `Staked` | staker, amount, timestamp |
| `WithdrawalProcessed` | staker, amount, requestId, timestamp |
| `WithdrawalQueued` | staker, amount, requestId, position, estimatedWait, timestamp |
| `WithdrawalCancelled` | staker, requestId, timestamp |
| `QueueProcessed` | processed, remainingLiquidity, newQueueHead |
| `PolicyPurchased` | buyer, policyId, coverage, threshold, premium, fridayClose, settlementWeek |
| `PolicySettled` | policyId, mondayPrice, adjustedFriday, gap, paidOut |
| `PolicyPaidOut` | policyId, holder, amount, gap |
| `SettlementApproved` | week, splitRatio, reason, timestamp |
| `FailsafeTriggered` | week, reason |
| `VolatilityUpdated` | oldVolatility, newVolatility |
| `Paused` / `Unpaused` | by |
