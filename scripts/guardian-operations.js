/**
 * guardian-operations.js — Guardian workflow helpers for HoodGap
 *
 * Common guardian tasks: approve settlement, update volatility,
 * set holiday multipliers, check pool health, and emergency controls.
 *
 * Usage (pick one):
 *   TASK=approve-week   npx hardhat run scripts/guardian-operations.js --network localhost
 *   TASK=pool-health    npx hardhat run scripts/guardian-operations.js --network localhost
 *   TASK=pause          npx hardhat run scripts/guardian-operations.js --network localhost
 *   TASK=unpause        npx hardhat run scripts/guardian-operations.js --network localhost
 *   TASK=queue-vol      VOL=6000 npx hardhat run scripts/guardian-operations.js --network localhost
 */

const hre = require("hardhat");
const fs = require("fs");
const path = require("path");

const USDC_DECIMALS = 6;
const fromUSDC = (n) => Number(n) / 10 ** USDC_DECIMALS;
const fmt = (n) => `$${fromUSDC(n).toLocaleString("en-US", { minimumFractionDigits: 2 })}`;

function getAddresses() {
  const envPath = path.join(__dirname, "..", "frontend", ".env.local");
  if (!fs.existsSync(envPath)) throw new Error("frontend/.env.local not found. Run deploy.js first.");

  const env = fs.readFileSync(envPath, "utf8");
  const match = (key) => {
    const m = env.match(new RegExp(`${key}=(.+)`));
    return m ? m[1].trim() : null;
  };

  return {
    hoodgap: match("NEXT_PUBLIC_HOODGAP_ADDRESS"),
    usdc: match("NEXT_PUBLIC_USDC_ADDRESS"),
    oracle: match("NEXT_PUBLIC_ORACLE_ADDRESS"),
  };
}

// ── Tasks ─────────────────────────────────────────────────────────────

async function approveWeek(hoodgap) {
  const week = await hoodgap.getCurrentSettlementWeek();
  const [alreadyApproved] = await hoodgap.canSettle(week);

  if (alreadyApproved) {
    console.log(`  Week ${week} is already approved ✅`);
    return;
  }

  const splitRatio = parseInt(process.env.SPLIT || "10000");
  const reason = process.env.REASON || "Normal week — no split";

  console.log(`  Approving week ${week}...`);
  console.log(`    Split ratio: ${splitRatio / 10000}x`);
  console.log(`    Reason: ${reason}`);

  const tx = await hoodgap.approveSettlement(week, splitRatio, reason);
  await tx.wait();
  console.log(`  ✅ Week ${week} approved`);
}

async function poolHealth(hoodgap) {
  const stats = await hoodgap.getPoolStats();
  const vol = await hoodgap.currentVolatility();
  const paused = await hoodgap.paused();
  const week = await hoodgap.getCurrentSettlementWeek();
  const [canSettleNow, splitRatio, settleReason] = await hoodgap.canSettle(week);
  const queueStats = await hoodgap.getQueueStats();

  console.log("  📊 Pool Health Report");
  console.log("  ─────────────────────────────────");
  console.log(`  Status:         ${paused ? "⛔ PAUSED" : "🟢 Active"}`);
  console.log(`  Total Staked:   ${fmt(stats[0])}`);
  console.log(`  Total Coverage: ${fmt(stats[1])}`);
  console.log(`  Utilization:    ${Number(stats[2]) / 100}%`);
  console.log(`  Reserve:        ${fmt(stats[3])}`);
  console.log(`  Policies:       ${stats[4]}`);
  console.log(`  Volatility:     ${Number(vol) / 100}%`);
  console.log("  ─────────────────────────────────");
  console.log(`  Week:           ${week}`);
  console.log(`  Can Settle:     ${canSettleNow ? "✅ Yes" : "❌ No"}`);
  console.log(`  Split Ratio:    ${Number(splitRatio) / 10000}x`);
  console.log(`  Reason:         ${settleReason}`);
  console.log("  ─────────────────────────────────");
  console.log(`  Queue Head:     ${queueStats[0]}`);
  console.log(`  Queue Length:   ${queueStats[1]}`);
  console.log(`  Pending:        ${queueStats[2]}`);
  console.log(`  $ Ahead:        ${fmt(queueStats[3])}`);
  console.log(`  Free Liquidity: ${fmt(queueStats[4])}`);
}

async function queueVolatility(hoodgap) {
  const newVol = parseInt(process.env.VOL || "5000");
  const reason = process.env.REASON || `Market conditions update to ${newVol / 100}%`;

  console.log(`  Queuing volatility change: ${newVol / 100}%`);
  console.log(`  Reason: ${reason}`);
  console.log(`  ⏱️  Will be executable after 24h timelock`);

  const tx = await hoodgap.queueVolatilityChange(newVol, reason);
  await tx.wait();
  console.log("  ✅ Volatility change queued");
}

async function emergencyPause(hoodgap) {
  const isPaused = await hoodgap.paused();
  if (isPaused) {
    console.log("  ⚠️  Contract is already paused");
    return;
  }
  const tx = await hoodgap.pause();
  await tx.wait();
  console.log("  ⛔ Contract PAUSED");
}

async function emergencyUnpause(hoodgap) {
  const isPaused = await hoodgap.paused();
  if (!isPaused) {
    console.log("  ⚠️  Contract is not paused");
    return;
  }
  const tx = await hoodgap.unpause();
  await tx.wait();
  console.log("  🟢 Contract UNPAUSED");
}

// ── Main ──────────────────────────────────────────────────────────────

async function main() {
  const task = (process.env.TASK || "pool-health").toLowerCase();

  console.log(`\n🛡️  Guardian Operations — ${task}`);
  console.log("   Network:", hre.network.name);
  console.log("─".repeat(50));

  const { hoodgap: addr } = getAddresses();
  const hoodgap = await hre.ethers.getContractAt("HoodGap", addr);

  const [signer] = await hre.ethers.getSigners();
  const owner = await hoodgap.owner();
  if (signer.address.toLowerCase() !== owner.toLowerCase()) {
    console.error(`\n  ❌ Signer ${signer.address} is not the guardian (${owner})`);
    process.exit(1);
  }

  console.log(`  Guardian: ${signer.address}\n`);

  switch (task) {
    case "approve-week":
      await approveWeek(hoodgap);
      break;
    case "pool-health":
      await poolHealth(hoodgap);
      break;
    case "queue-vol":
      await queueVolatility(hoodgap);
      break;
    case "pause":
      await emergencyPause(hoodgap);
      break;
    case "unpause":
      await emergencyUnpause(hoodgap);
      break;
    default:
      console.log("  Unknown task. Available tasks:");
      console.log("    approve-week  — Approve settlement for current week");
      console.log("    pool-health   — Show pool health report");
      console.log("    queue-vol     — Queue volatility change (set VOL=6000)");
      console.log("    pause         — Emergency pause");
      console.log("    unpause       — Resume operation");
  }

  console.log("");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
