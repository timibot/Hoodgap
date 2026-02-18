# Guardian Manual

## Overview

The Guardian is the protocol operator responsible for weekly settlement approvals, parameter management, and emergency controls. In production, this should be a multisig wallet (e.g., Gnosis Safe).

---

## Weekly Checklist

### Friday (Before Market Close — 4:00 PM EST)

- [ ] Check pool health: `TASK=pool-health npx hardhat run scripts/guardian-operations.js`
- [ ] Verify utilization is healthy (< 80% preferred)
- [ ] Confirm oracle is active and prices are current
- [ ] Check for any pending corporate actions (stock splits, reverse splits)

### Friday Evening (After Market Close)

- [ ] Monitor news for Tesla announcements
- [ ] If stock split announced: prepare split ratio
- [ ] Update volatility if market conditions changed significantly

### Saturday–Sunday

- [ ] Monitor for major Tesla news
- [ ] If split/corporate action: set split ratio before Monday

### Monday Morning (Before 9:30 AM EST)

- [ ] **Approve settlement** for the current week:
  ```bash
  TASK=approve-week npx hardhat run scripts/guardian-operations.js --network robinhoodTestnet
  ```
- [ ] If stock split occurred:
  ```bash
  TASK=approve-week SPLIT=5000 REASON="TSLA 2:1 split" npx hardhat run scripts/guardian-operations.js --network robinhoodTestnet
  ```
- [ ] Verify oracle updated with Monday opening price
- [ ] Monitor settlements proceeding smoothly

### Monday Afternoon

- [ ] Check all policies settled
- [ ] Review pool health post-settlement
- [ ] Process any pending withdrawals

---

## Settlement Approval

### Normal Week (No Split)

```bash
TASK=approve-week npx hardhat run scripts/guardian-operations.js --network robinhoodTestnet
```

This calls `approveSettlement(week, 10000, "Normal week — no split")` where `10000` = 1.0x ratio.

### Stock Split Week

| Split Type | Ratio Value | Example |
|------------|-------------|---------|
| 2:1 split | 5000 | $800 → $400 |
| 3:1 split | 3333 | $900 → $300 |
| 4:1 split | 2500 | $1000 → $250 |
| 1:2 reverse | 20000 | $50 → $100 |

```bash
TASK=approve-week SPLIT=5000 REASON="TSLA 2:1 split effective Monday" npx hardhat run scripts/guardian-operations.js
```

### Failsafe (48-Hour Timeout)

If the guardian fails to approve, the protocol auto-approves after 48 hours with a default 1.0x split ratio. This prevents permanent fund lockup.

```text
Monday 9:30am: Settlement requested
  → canSettle() returns false: "Awaiting guardian approval or 48h failsafe"

Wednesday 9:30am (48h later):
  → canSettle() returns true: "Failsafe: 48h timeout, defaulting 1.0x"
  → FailsafeTriggered event emitted
```

---

## Split Timing Scenarios

### Split Announced Friday After Market Close

```text
Friday 2pm: Users buy 1000 policies
Friday 5pm: Tesla announces 2:1 split effective Monday

Guardian action (Friday 6pm):
- Set split ratio: SPLIT=5000 REASON="TSLA 2:1 split"
- Approve settlement

Monday:
- All policies use adjusted Friday price
- No false payouts ✓
```

### Guardian Forgets to Set Split Ratio

```text
Friday: 2:1 split announced
Saturday-Sunday: Policies sold
Monday 9:30am: Users try to settle

Settlement: BLOCKED
  → "Awaiting guardian approval or 48h failsafe"

After 48h failsafe triggers:
  → Default 1.0x ratio applied
  → False payouts occur ⚠️

Prevention: Monitor corporate action calendars!
```

---

## Volatility Management

### Queuing a Volatility Change (24h Timelock)

```bash
# Step 1: Queue (starts 24h timer)
TASK=queue-vol VOL=6000 REASON="Elevated market volatility" npx hardhat run scripts/guardian-operations.js

# Step 2: Execute (after 24h)
# Call executeVolatilityChange() via etherscan or custom script
```

| Volatility | Value | Market Condition |
|-----------|-------|------------------|
| 10% (floor) | 1000 | Dead calm |
| 30% | 3000 | Low volatility |
| 50% (default) | 5000 | Normal |
| 75% | 7500 | Elevated |
| 100% | 10000 | Crisis |
| 150% (ceiling) | 15000 | Extreme |

### Holiday Multiplier (24h Timelock)

For long weekends (3-day+), increase the time decay multiplier:

```bash
# Queue: 2.0x for July 4th weekend
# Call queueHolidayMultiplier(week, 20000, "July 4th long weekend")
```

---

## Emergency Procedures

### Emergency Pause

```bash
TASK=pause npx hardhat run scripts/guardian-operations.js --network robinhoodTestnet
```

**When to pause:**
- Suspected exploit or abnormal behavior
- Oracle failure lasting > 1 hour
- Smart contract bug discovered
- Extreme market conditions (circuit breaker)

**Effect of pausing:**
- `stake()` blocked
- `buyPolicy()` blocked
- `settlePolicy()` still works (to protect policyholders)
- `requestWithdrawal()` still works

### Resume Operations

```bash
TASK=unpause npx hardhat run scripts/guardian-operations.js --network robinhoodTestnet
```

### Pool Insolvency

If `totalStaked < payout needed`:

1. **Pause** the contract
2. Reserve balance is used automatically for shortfall
3. If reserve insufficient, settlement reverts
4. Coordinate emergency staking from partners
5. **Unpause** once solvent

---

## Monitoring

### Key Metrics to Watch

| Metric | Healthy | Warning | Critical |
|--------|---------|---------|----------|
| Utilization | < 60% | 60-85% | > 85% |
| Reserve | > $10k | $1k-$10k | < $1k |
| Oracle Age | < 1h | 1-6h | > 6h |
| Pending Queue | 0 | 1-5 | > 10 |

### Quick Health Check

```bash
TASK=pool-health npx hardhat run scripts/guardian-operations.js --network robinhoodTestnet
```

This prints: pool status, staked/coverage/utilization, reserve, volatility, settlement approval status, and withdrawal queue stats.
