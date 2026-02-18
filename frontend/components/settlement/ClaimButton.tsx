"use client";

import { useState } from "react";
import { useContract } from "@/hooks/useContract";
import { showToast, updateToast } from "@/components/shared/TransactionToast";

export default function ClaimButton({ policyId }: { policyId: number }) {
  const { hoodgap, isReady } = useContract();
  const [claiming, setClaiming] = useState(false);

  async function handleClaim() {
    if (!isReady || !hoodgap) return;
    setClaiming(true);
    const toastId = showToast({ type: "pending", title: "Settling", message: "Confirm in wallet..." });
    try {
      const tx = await hoodgap.settlePolicy(policyId);
      updateToast(toastId, { message: "Confirming...", txHash: tx.hash });
      await tx.wait();
      updateToast(toastId, { type: "success", title: "Settled", message: `Policy #${policyId}` });
    } catch (err: any) {
      updateToast(toastId, { type: "error", title: "Failed", message: err.reason || err.message || "Reverted" });
    } finally {
      setClaiming(false);
    }
  }

  return (
    <button onClick={handleClaim} disabled={claiming || !isReady} className="btn-secondary text-xs">
      {claiming ? "Settling..." : "Settle"}
    </button>
  );
}
