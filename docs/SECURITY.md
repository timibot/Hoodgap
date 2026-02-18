# Security

## Threat Model

### Trust Assumptions

| Component | Trust Level | Justification |
|-----------|-------------|---------------|
| Smart Contract | Trustless | On-chain, auditable, immutable logic |
| Guardian | Semi-trusted | Can pause, approve settlements; cannot steal funds |
| Chainlink Oracle | Trusted | External dependency; staleness checks mitigate |
| USDC | Trusted | Regulated stablecoin by Circle |
| Frontend | Untrusted | All critical logic is on-chain |

---

## Attack Scenarios

### 1. Flash Loan Attack

```text
Attacker plan:
1. Flash loan $10M USDC
2. Stake $10M
3. Buy $10M coverage immediately
4. Wait for gap...?

Problem: Can't profit in single transaction
- Policies require time (Friday → Monday)
- Flash loan must be repaid in same block
- Attack fails ✓

Conclusion: Flash loans irrelevant for time-based protocols
```

### 2. Front-Running Premium Quotes

```text
Attack attempt:
1. User A sees premium quote in UI
2. Attacker front-runs with identical parameters
3. Both transactions call calculatePremium() on-chain

Result:
- Both get deterministic pricing
- First tx slightly increases utilization
- Second tx pays marginally higher premium
- No meaningful exploit

Protection: On-chain pricing is MEV-resistant ✓
```

### 3. Sybil Attack (Multiple Accounts)

```text
Attack attempt:
1. Create 1000 wallets
2. Buy $50 coverage from each (total $50k)
3. Try to avoid detection

Reality:
- No per-address limits (by design)
- Dynamic pricing applies to ALL purchases
- Splitting across addresses doesn't help
- More gas cost, same premiums
- Attack pointless ✓
```

### 4. Reentrancy

```text
Mitigation:
- All state-changing functions use OpenZeppelin ReentrancyGuard
- USDC (ERC-20) has no receive hooks (unlike ERC-777)
- Checks-Effects-Interactions pattern used throughout
- State updated BEFORE external calls

Example in settlePolicy():
  1. policy.settled = true          // Effect
  2. totalCoverage -= coverage      // Effect
  3. USDC.transfer(holder, payout)  // Interaction
```

### 5. Oracle Manipulation

```text
Threat: Compromised or delayed oracle data

Mitigations:
- Oracle staleness check: require(block.timestamp - updatedAt < 24h)
- Policy purchase requires oracle updated within 1 hour
- Settlement requires oracle updated AFTER Monday 9:30am
- Time decay multiplier increases premium when oracle is stale
- 48-hour failsafe auto-approves if guardian is unresponsive

Attack scenario:
  Attacker tries to feed stale Friday price on Monday
  → require(updatedAt >= mondayOpen) blocks settlement
  → Must wait for real Monday update ✓
```

### 6. Malicious Guardian

```text
Threat: Guardian acts against protocol interests

Powers:
  ✅ Can pause/unpause contract
  ✅ Can approve settlements with split ratios
  ✅ Can queue volatility changes (24h timelock)
  ✅ Can set holiday multipliers (24h timelock)

Cannot:
  ❌ Cannot withdraw staker funds
  ❌ Cannot mint USDC
  ❌ Cannot modify premium formula
  ❌ Cannot change contract code
  ❌ Cannot bypass 24h timelocks on parameter changes

Worst case: Guardian pauses forever
  → Users' staked capital is locked
  → Need governance to transfer ownership
  → Protocol is safe, just frozen

Mitigation: 48h failsafe auto-approves settlement
  → Even if guardian disappears, settlements proceed
```

### 7. Denial of Service

```text
Withdrawal Queue DOS:
  Threat: Attacker floods queue with tiny withdrawal requests
  Mitigation: MAX_QUEUE_PROCESS = 20 per call, gas-bounded
  Mitigation: Queue auto-advances head past processed entries

BlockGas DOS:
  Threat: Settlement or queue loops use too much gas
  Mitigation: processWithdrawalQueue takes maxToProcess (1-50)
  Mitigation: Policies settle individually, not in batch
```

### 8. Decimal Precision

```text
USDC: 6 decimals (1 USDC = 1,000,000 units)
Oracle: 8 decimals (1 dollar = 100,000,000 units)
Basis points: 10,000 = 100%

Premium calculation:
  basePremium = (coverage * BASE_RATE) / 10000
  premium = (basePremium * M_util * M_vol * M_time) / 1e12

Multipliers are scaled to 10000 (1.0x = 10000)
Division by 1e12 (10000^3) normalizes three multipliers

Edge case: Very small coverage ($0.01 = 10000 units)
  Base premium = 10000 * 1000 / 10000 = 1000 ($0.001)
  Floor: coverage / 100 = 100 ($0.0001)
  Applied: $0.001 (above floor) ✓
```

---

## Extreme Utilization Scenarios

### Race to 100% Utilization

```text
Pool state: $1M staked, $950k coverage (95%)

User A: Tries to buy $50k → Check: 950k + 50k ≤ 1M → YES
User B: Tries to buy $50k → Check: 1M + 50k ≤ 1M → REJECT

Result: First-come-first-served protection ✓
Atomic: Solidity executes sequentially within block
```

### Utilization Above 100% (Impossible)

```text
Guard: require(totalCoverage + coverage <= totalStaked)
USDC: No hooks, no reentrancy possible
State: totalCoverage updated AFTER premium transfer
Result: Cannot exceed 100% ✓
```

---

## Emergency Procedures

### Pool Insolvency

```text
Trigger: totalStaked < coverage payout needed

Step 1: Draw from reserveBalance
  require(reserveBalance >= shortfall)
  reserveBalance -= shortfall

Step 2: If reserve insufficient → settlePolicy reverts
  "Insufficient pool + reserve funds"
  Policy cannot settle until more capital is staked

Step 3: Guardian should:
  1. Pause the contract
  2. Assess the situation
  3. Coordinate with stakers for emergency capital
  4. Unpause when solvent
```

### Oracle Failure

```text
Scenario: Chainlink oracle stops updating

Impact:
- calculatePremium fails after 24h (staleness check)
- settlePolicy fails if oracle not updated after Monday open
- buyPolicy fails if oracle not updated in last 1h

Guardian response:
1. Pause contract to prevent losses
2. Wait for oracle recovery
3. If permanent: deploy new oracle, redeploy protocol
```

### Guardian Key Compromise

```text
Immediate:
1. Call pause() from compromised key (if helpful)
2. Transfer ownership via transferOwnership() to new address

If attacker pauses:
- Funds are safe but locked
- Need new deployment or governance to recover

Prevention:
- Use multisig (Gnosis Safe) for guardian address
- Hardware wallet for key storage
```
