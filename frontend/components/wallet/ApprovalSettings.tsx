"use client";

import { useState, useEffect } from "react";
import { ApprovalMode } from "@/hooks/useApproval";

export default function ApprovalSettings() {
  const [mode, setMode] = useState<ApprovalMode>(ApprovalMode.INFINITE);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    const stored = localStorage.getItem("hoodgap_approval_mode") as ApprovalMode;
    if (stored && Object.values(ApprovalMode).includes(stored)) {
      setMode(stored);
    }
  }, []);

  function handleChange(newMode: ApprovalMode) {
    setMode(newMode);
    localStorage.setItem("hoodgap_approval_mode", newMode);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

  const options = [
    {
      mode: ApprovalMode.INFINITE,
      title: "Infinite",
      detail: "Approve once, never again. Standard for DeFi.",
      recommended: true,
    },
    {
      mode: ApprovalMode.BUFFERED,
      title: "Buffered (+10%)",
      detail: "Approve premium + 10% buffer per purchase.",
      recommended: false,
    },
    {
      mode: ApprovalMode.EXACT,
      title: "Exact",
      detail: "Approve exact amount only. May fail if price changes.",
      recommended: false,
    },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-bold">Approval Settings</h2>
        <p className="text-sm text-muted mt-1">
          How USDC spending is approved for purchases.
        </p>
      </div>

      <div className="space-y-2">
        {options.map((opt) => (
          <button
            key={opt.mode}
            onClick={() => handleChange(opt.mode)}
            className={`w-full text-left p-4 border rounded-lg transition-colors duration-150 ${
              mode === opt.mode ? "border-fg" : "border-border hover:border-border-dark"
            }`}
          >
            <div className="flex items-center gap-3">
              <div
                className={`w-4 h-4 rounded-full border-2 flex items-center justify-center ${
                  mode === opt.mode ? "border-fg" : "border-border"
                }`}
              >
                {mode === opt.mode && <div className="w-2 h-2 rounded-full bg-fg" />}
              </div>
              <div>
                <span className="font-semibold text-sm">
                  {opt.title}
                  {opt.recommended && (
                    <span className="text-xs text-muted font-normal ml-2">Recommended</span>
                  )}
                </span>
                <p className="text-xs text-muted mt-0.5">{opt.detail}</p>
              </div>
            </div>
          </button>
        ))}
      </div>

      {saved && (
        <div className="text-sm text-center text-muted">Saved</div>
      )}

      <div className="text-sm text-muted space-y-2 border-t pt-4">
        <p className="font-semibold text-fg">Why is approval needed?</p>
        <p>
          USDC is a separate token. You must approve HoodGap to spend it — this is a standard ERC-20 security feature. You can revoke approval anytime.
        </p>
      </div>
    </div>
  );
}
