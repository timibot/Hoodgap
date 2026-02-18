"use client";

import { useState } from "react";
import { useContract } from "@/hooks/useContract";
import { useApproval } from "@/hooks/useApproval";
import { useWeb3 } from "@/contexts/Web3Context";
import { useUser } from "@/contexts/UserContext";
import { formatDollars, toUSDC, fromUSDC } from "@/lib/formatting";
import { validateStakeAmount } from "@/lib/validation";
import { showToast, updateToast } from "@/components/shared/TransactionToast";
import { parseTransactionError } from "@/lib/errors";

export default function StakeForm() {
  const { status } = useWeb3();
  const { hoodgap, isReady } = useContract();
  const { ensureApproval, approving } = useApproval();
  const { usdcBalance, refresh } = useUser();

  const [amount, setAmount] = useState("");
  const [staking, setStaking] = useState(false);

  const amountNum = Number(amount) || 0;
  const balanceUsd = fromUSDC(usdcBalance);
  const validation = validateStakeAmount(amountNum, balanceUsd);

  async function handleStake() {
    if (!isReady || !hoodgap || !validation.valid) return;

    setStaking(true);
    const toastId = showToast({ type: "pending", title: "Staking", message: "Approving..." });

    try {
      const stakeWei = toUSDC(amountNum);
      await ensureApproval(stakeWei);
      updateToast(toastId, { message: "Confirm in wallet..." });
      const tx = await hoodgap.stake(stakeWei);
      updateToast(toastId, { message: "Confirming...", txHash: tx.hash });
      await tx.wait();
      updateToast(toastId, { type: "success", title: "Staked", message: `${formatDollars(amountNum)} added` });
      setAmount("");
      await refresh();
    } catch (err: any) {
      updateToast(toastId, { type: "error", title: "Failed", message: parseTransactionError(err) });
    } finally {
      setStaking(false);
    }
  }

  return (
    <div className="space-y-4">
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
            onClick={() => setAmount(balanceUsd.toString())}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-xs font-semibold text-fg hover:underline"
          >
            MAX
          </button>
        </div>
        <div className="flex justify-between text-xs text-muted">
          <span>Balance: {formatDollars(balanceUsd)}</span>
          {amount && !validation.valid && <span className="text-negative">{validation.error}</span>}
        </div>
      </div>

      <button
        onClick={handleStake}
        disabled={!isReady || staking || approving || !validation.valid || amountNum <= 0}
        className="btn-primary"
      >
        {status !== "connected" ? "Connect Wallet" : staking || approving ? "Staking..." : "Stake"}
      </button>
    </div>
  );
}
