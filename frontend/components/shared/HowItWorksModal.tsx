"use client";

import { useEffect, useRef } from "react";

interface HowItWorksModalProps {
  open: boolean;
  onClose: () => void;
}

export default function HowItWorksModal({ open, onClose }: HowItWorksModalProps) {
  const backdropRef = useRef<HTMLDivElement>(null);

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [open, onClose]);

  // Prevent body scroll when open
  useEffect(() => {
    if (open) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
    }
    return () => { document.body.style.overflow = ""; };
  }, [open]);

  if (!open) return null;

  return (
    <div
      ref={backdropRef}
      onClick={(e) => { if (e.target === backdropRef.current) onClose(); }}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm px-4 animate-fade-in"
    >
      <div className="bg-white rounded-2xl shadow-xl max-w-md w-full p-6 space-y-4 animate-slide-up">
        {/* Header */}
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-full bg-[#c8e64a]/20 flex items-center justify-center shrink-0">
              <span className="text-base font-bold text-[#8aad2e]">i</span>
            </div>
            <h2 className="text-lg font-bold">How it works</h2>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 hover:bg-surface-alt rounded-lg transition-colors text-muted hover:text-fg"
            aria-label="Close"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="3" y1="3" x2="13" y2="13" />
              <line x1="13" y1="3" x2="3" y2="13" />
            </svg>
          </button>
        </div>

        {/* Content */}
        <p className="text-sm text-muted leading-relaxed">
          HoodGap protects your stock position against weekend price gaps. 
          Buy insurance before Friday close — if the stock gaps down on Monday open, 
          you get paid automatically.
        </p>

        {/* Steps */}
        <div className="space-y-3">
          <div className="flex items-start gap-3">
            <span className="w-6 h-6 rounded-full bg-fg text-white text-xs font-bold flex items-center justify-center shrink-0 mt-0.5">1</span>
            <div className="text-sm">
              <span className="font-semibold">Buy a policy</span>
              <span className="text-muted"> — choose your coverage amount and gap threshold.</span>
            </div>
          </div>
          <div className="flex items-start gap-3">
            <span className="w-6 h-6 rounded-full bg-fg text-white text-xs font-bold flex items-center justify-center shrink-0 mt-0.5">2</span>
            <div className="text-sm">
              <span className="font-semibold">Weekend happens</span>
              <span className="text-muted"> — the protocol monitors the price gap from Friday close to Monday open.</span>
            </div>
          </div>
          <div className="flex items-start gap-3">
            <span className="w-6 h-6 rounded-full bg-fg text-white text-xs font-bold flex items-center justify-center shrink-0 mt-0.5">3</span>
            <div className="text-sm">
              <span className="font-semibold">Get paid</span>
              <span className="text-muted"> — if the gap exceeds your threshold, your policy pays out automatically.</span>
            </div>
          </div>
        </div>

        {/* Close button */}
        <button
          onClick={onClose}
          className="w-full py-2.5 bg-fg text-white text-sm font-semibold rounded-full hover:opacity-80 transition-opacity"
        >
          Got it
        </button>
      </div>
    </div>
  );
}
