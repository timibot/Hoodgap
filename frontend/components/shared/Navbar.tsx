"use client";

import { useState } from "react";
import Link from "next/link";
import WalletConnect from "@/components/wallet/WalletConnect";
import HowItWorksModal from "@/components/shared/HowItWorksModal";

export default function Navbar() {
  const [menuOpen, setMenuOpen] = useState(false);
  const [showHowItWorks, setShowHowItWorks] = useState(false);

  return (
    <>
      <nav className="sticky top-0 z-40 bg-white border-b">
        <div className="max-w-6xl mx-auto px-4 sm:px-6">
          <div className="flex items-center h-14 gap-4 sm:gap-6">
            <Link href="/" className="font-bold text-sm tracking-tight shrink-0">
              HoodGap
            </Link>

            {/* How it works - always visible */}
            <button
              onClick={() => setShowHowItWorks(true)}
              className="flex items-center gap-1.5 text-xs text-muted hover:text-fg transition-colors shrink-0"
              title="How it works"
            >
              <span className="w-5 h-5 rounded-full border border-current flex items-center justify-center text-[11px] font-bold leading-none">
                i
              </span>
              <span className="hidden sm:inline">How it works</span>
            </button>

            <div className="flex-1" />

            {/* Desktop nav links */}
            <div className="hidden md:flex items-center gap-4">
              <Link href="/dashboard" className="text-sm text-muted hover:text-fg transition-colors">
                Dashboard
              </Link>
              <Link href="/portfolio" className="text-sm text-muted hover:text-fg transition-colors">
                Portfolio
              </Link>
              <Link href="/admin" className="text-sm text-muted hover:text-fg transition-colors">
                Admin
              </Link>
              <WalletConnect />
            </div>

            {/* Mobile hamburger */}
            <div className="flex items-center gap-3 md:hidden">
              <WalletConnect />
              <button
                onClick={() => setMenuOpen(!menuOpen)}
                className="p-2 hover:bg-surface-alt rounded-lg transition-colors"
                aria-label="Toggle menu"
              >
                <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2">
                  {menuOpen ? (
                    <>
                      <line x1="4" y1="4" x2="16" y2="16" />
                      <line x1="16" y1="4" x2="4" y2="16" />
                    </>
                  ) : (
                    <>
                      <line x1="3" y1="5" x2="17" y2="5" />
                      <line x1="3" y1="10" x2="17" y2="10" />
                      <line x1="3" y1="15" x2="17" y2="15" />
                    </>
                  )}
                </svg>
              </button>
            </div>
          </div>

          {/* Mobile menu dropdown */}
          {menuOpen && (
            <div className="md:hidden border-t py-3 space-y-1 animate-slide-up">
              <Link
                href="/dashboard"
                onClick={() => setMenuOpen(false)}
                className="block px-3 py-2.5 text-sm text-muted hover:text-fg hover:bg-surface-alt rounded-lg transition-colors"
              >
                Dashboard
              </Link>
              <Link
                href="/portfolio"
                onClick={() => setMenuOpen(false)}
                className="block px-3 py-2.5 text-sm text-muted hover:text-fg hover:bg-surface-alt rounded-lg transition-colors"
              >
                Portfolio
              </Link>
              <Link
                href="/admin"
                onClick={() => setMenuOpen(false)}
                className="block px-3 py-2.5 text-sm text-muted hover:text-fg hover:bg-surface-alt rounded-lg transition-colors"
              >
                Admin
              </Link>
            </div>
          )}
        </div>
      </nav>

      <HowItWorksModal open={showHowItWorks} onClose={() => setShowHowItWorks(false)} />
    </>
  );
}
