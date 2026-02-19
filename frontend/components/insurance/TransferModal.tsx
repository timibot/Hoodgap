"use client";

import { useState } from "react";
import { useContract } from "@/hooks/useContract";
import { useWeb3 } from "@/contexts/Web3Context";
import { useApproval } from "@/hooks/useApproval";
import { showToast, updateToast } from "@/components/shared/TransactionToast";
import { parseTransactionError } from "@/lib/errors";
import type { PolicyDisplay } from "@/types/policy";

interface TransferModalProps {
  policy: PolicyDisplay;
  onClose: () => void;
}

export default function TransferModal({ policy, onClose }: TransferModalProps) {
  const [recipient, setRecipient] = useState("");
  const [transferring, setTransferring] = useState(false);
  const { hoodgap } = useContract();
  const { address } = useWeb3();

  const transferFee = policy.premiumUsd * 0.05;
  const isValidAddress = /^0x[a-fA-F0-9]{40}$/.test(recipient);

  async function handleTransfer() {
    if (!hoodgap || !isValidAddress) return;

    setTransferring(true);
    const toastId = showToast({
      type: "pending",
      title: "Transferring Policy",
      message: "Confirm in wallet...",
    });

    try {
      if (!address) throw new Error("No signer");

      const tx = await hoodgap.transferFrom(address, recipient, policy.id);
      updateToast(toastId, { message: "Confirming...", txHash: tx.hash });

      await tx.wait();
      updateToast(toastId, {
        type: "success",
        title: "Policy transferred",
        message: `Policy #${policy.id} → ${recipient.slice(0, 6)}...${recipient.slice(-4)}`,
        txHash: tx.hash,
      });

      onClose();
    } catch (err: any) {
      updateToast(toastId, {
        type: "error",
        title: "Transfer failed",
        message: parseTransactionError(err),
      });
    } finally {
      setTransferring(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="bg-bg border rounded-xl p-6 max-w-md w-full mx-4 space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="font-semibold text-lg">Transfer Policy #{policy.id}</h3>
          <button onClick={onClose} className="text-muted hover:text-fg text-xl">×</button>
        </div>

        <div className="space-y-2">
          <label className="text-sm font-medium">Recipient Address</label>
          <input
            type="text"
            value={recipient}
            onChange={(e) => setRecipient(e.target.value)}
            placeholder="0x..."
            className="input-field font-mono text-sm"
          />
        </div>

        <div className="p-3 bg-surface-alt rounded-lg space-y-1.5 text-sm">
          <div className="flex justify-between">
            <span className="text-muted">Coverage</span>
            <span className="font-mono">${policy.coverageUsd.toLocaleString()}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted">Transfer Fee (5%)</span>
            <span className="font-mono text-negative">${transferFee.toFixed(2)}</span>
          </div>
          <div className="text-xs text-muted pt-1.5 border-t">
            Fee is deducted from your USDC balance and added to the protocol reserve.
            The recipient receives full claim rights.
          </div>
        </div>

        <div className="flex gap-3">
          <button onClick={onClose} className="btn-secondary flex-1">Cancel</button>
          <button
            onClick={handleTransfer}
            disabled={!isValidAddress || transferring}
            className="btn-primary flex-1"
          >
            {transferring ? "Transferring..." : "Confirm Transfer"}
          </button>
        </div>
      </div>
    </div>
  );
}
