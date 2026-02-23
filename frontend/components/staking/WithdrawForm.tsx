"use client";

import { useState } from "react";
import { useContract } from "@/hooks/useContract";
import { useWeb3 } from "@/contexts/Web3Context";
import { useUser } from "@/contexts/UserContext";
import { useQueueStatus, usePoolStats } from "@/hooks/useStaker";
import { formatDollars, formatDate, toUSDC, fromUSDC } from "@/lib/formatting";
import { validateWithdrawAmount } from "@/lib/validation";
import { showToast, updateToast } from "@/components/shared/TransactionToast";
import { parseTransactionError } from "@/lib/errors";
import LoadingSpinner from "@/components/shared/LoadingSpinner";

export default function WithdrawForm() {
  const { status } = useWeb3();
  const { hoodgap, isReady } = useContract();
  const { stakedBalance, refresh } = useUser();
  const { stats } = usePoolStats();

  const [amount, setAmount] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [queuedRequestId, setQueuedRequestId] = useState<number | null>(null);

  const amountNum = Number(amount) || 0;
  const stakedUsd = fromUSDC(stakedBalance);
  const validation = validateWithdrawAmount(amountNum, stakedUsd);

  async function handleWithdraw() {
    if (!isReady || !hoodgap || !validation.valid) return;

    setSubmitting(true);
    const toastId = showToast({ type: "pending", title: "Withdrawing", message: "Confirm in wallet..." });

    try {
      const tx = await hoodgap.requestWithdrawal(toUSDC(amountNum));
      updateToast(toastId, { message: "Confirming...", txHash: tx.hash });
      const receipt = await tx.wait();

      const processedEvent = receipt.logs.find((log: any) => log.fragment?.name === "WithdrawalProcessed");
      const queuedEvent = receipt.logs.find((log: any) => log.fragment?.name === "WithdrawalQueued");

      if (processedEvent) {
        updateToast(toastId, { type: "success", title: "Withdrawn", message: `${formatDollars(amountNum)} sent` });
      } else if (queuedEvent) {
        const reqId = Number(queuedEvent.args?.requestId);
        setQueuedRequestId(reqId);
        updateToast(toastId, { type: "success", title: "Queued", message: `Request #${reqId}` });
      }

      setAmount("");
      await refresh();
    } catch (err: any) {
      updateToast(toastId, { type: "error", title: "Failed", message: parseTransactionError(err) });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="space-y-5">
      {/* Balance */}
      <div className="border-b pb-4">
        <div className="text-xs text-muted uppercase tracking-wider">Staked Balance</div>
        <div className="text-2xl font-bold font-mono mt-1">{formatDollars(stakedUsd)}</div>
        {stats && (
          <div className="text-xs text-muted mt-1">
            Utilization {stats.utilization.toFixed(2)}% · Free {formatDollars(stats.freeLiquidity)}
          </div>
        )}
      </div>

      {/* Input */}
      <div className="space-y-2">
        <label className="text-sm font-medium">Amount</label>
        <div className="relative">
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted text-sm">$</span>
          <input
            type="number"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            className="input-field pl-7"
            placeholder="0.00"
          />
          <button
            onClick={() => setAmount(stakedUsd.toString())}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-xs font-semibold text-fg hover:underline"
          >
            MAX
          </button>
        </div>
        {amount && !validation.valid && (
          <p className="text-xs text-negative">{validation.error}</p>
        )}
        {stats && amountNum > 0 && amountNum > stats.freeLiquidity && (
          <p className="text-xs text-muted">
            Only {formatDollars(stats.freeLiquidity)} available — this will be queued.
          </p>
        )}
      </div>

      <button
        onClick={handleWithdraw}
        disabled={!isReady || submitting || !validation.valid || amountNum <= 0}
        className="btn-primary"
      >
        {status !== "connected" ? "Connect Wallet" : submitting ? "Processing..." : "Withdraw"}
      </button>

      {queuedRequestId !== null && <QueueTracker requestId={queuedRequestId} />}
    </div>
  );
}

function QueueTracker({ requestId }: { requestId: number }) {
  const { status, loading } = useQueueStatus(requestId);
  const { hoodgap } = useContract();

  if (loading) return <div className="py-8"><LoadingSpinner text="Loading queue..." /></div>;
  if (!status) return <div className="text-sm text-muted text-center py-4">Failed to load queue</div>;

  if (status.processed) {
    return (
      <div className="border-t pt-4 text-center space-y-1">
        <div className="font-semibold">Withdrawal Processed</div>
        <div className="text-sm text-muted">{formatDollars(status.amount)} sent to your wallet</div>
      </div>
    );
  }

  async function handleCancel() {
    if (!hoodgap) return;
    if (!window.confirm("Cancel this withdrawal?")) return;
    const toastId = showToast({ type: "pending", title: "Cancelling", message: "Confirm in wallet..." });
    try {
      const tx = await hoodgap.cancelWithdrawalRequest(requestId);
      await tx.wait();
      updateToast(toastId, { type: "success", title: "Cancelled", message: "Balance restored" });
    } catch (err: any) {
      updateToast(toastId, { type: "error", title: "Failed", message: parseTransactionError(err) });
    }
  }

  return (
    <div className="animate-slide-up space-y-4 border-t pt-5">
      {/* Header */}
      <div className="flex justify-between items-baseline">
        <div>
          <div className="font-semibold">Request #{requestId}</div>
          <div className="text-xs text-muted">{formatDate(status.requestTime)}</div>
        </div>
        <div className="text-xl font-bold font-mono">{formatDollars(status.amount)}</div>
      </div>

      {/* Progress */}
      <div className="space-y-1">
        <div className="flex justify-between text-xs text-muted">
          <span>Progress</span>
          <span>{status.progressPercent.toFixed(0)}%</span>
        </div>
        <div className="h-1.5 bg-surface-alt rounded-full overflow-hidden">
          <div
            className="h-full bg-fg rounded-full transition-all duration-500"
            style={{ width: `${status.progressPercent}%` }}
          />
        </div>
      </div>

      {/* Dollar ahead — PRIMARY */}
      <div className="border rounded-lg p-4 text-center">
        <div className="text-xs text-muted uppercase tracking-wider">Ahead in queue</div>
        <div className="text-2xl font-bold font-mono mt-1">{formatDollars(status.dollarAhead)}</div>
        <div className="text-xs text-muted mt-1">Position #{status.position}</div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 gap-3">
        <div className="border rounded-lg p-3">
          <div className="text-xs text-muted">Available</div>
          <div className="font-bold font-mono">{formatDollars(status.freeLiquidity)}</div>
        </div>
        <div className="border rounded-lg p-3">
          <div className="text-xs text-muted">Still needed</div>
          <div className="font-bold font-mono">{formatDollars(status.shortfall)}</div>
        </div>
      </div>

      {/* Wait estimate */}
      <div className="text-sm text-muted">
        Estimated wait: ~{Math.ceil(status.estimatedWaitDays)} days ({status.estimatedSettlements} settlement{status.estimatedSettlements !== 1 ? "s" : ""})
      </div>

      <button onClick={handleCancel} className="btn-danger w-full">
        Cancel Request
      </button>

      <p className="text-xs text-center text-muted">Auto-refreshes every 15s</p>
    </div>
  );
}
