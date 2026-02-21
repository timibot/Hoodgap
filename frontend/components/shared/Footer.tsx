"use client";

import { useState } from "react";
import HowItWorksModal from "@/components/shared/HowItWorksModal";

export default function Footer() {
  const [feedback, setFeedback] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const [showHowItWorks, setShowHowItWorks] = useState(false);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!feedback.trim()) return;
    console.log("Feedback submitted:", feedback);
    setSubmitted(true);
    setFeedback("");
    setTimeout(() => setSubmitted(false), 4000);
  }

  return (
    <>
      <footer className="border-t bg-surface-alt mt-16">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-10">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-10">
            {/* Brand */}
            <div>
              <div className="flex items-center gap-2">
                <span className="text-xl font-bold tracking-tight">
                  Hood<span className="text-[#c8e64a]">Gap</span>
                </span>
              </div>
              <p className="text-sm text-muted mt-2">
                Overnight gap insurance for stock holders. Built on Robinhood Chain.
              </p>
              {/* How it works link */}
              <button
                onClick={() => setShowHowItWorks(true)}
                className="mt-3 flex items-center gap-1.5 text-xs text-muted hover:text-fg transition-colors"
              >
                <span className="w-5 h-5 rounded-full border border-current flex items-center justify-center text-[11px] font-bold leading-none">
                  i
                </span>
                <span>How it works</span>
              </button>
            </div>

            {/* Contact */}
            <div className="space-y-3">
              <h4 className="font-semibold text-sm">Contact</h4>
              <a
                href="mailto:olufisoyetimileyin@gmail.com"
                className="text-sm text-muted hover:text-fg transition-colors flex items-center gap-2"
              >
                <span>✉</span> olufisoyetimileyin@gmail.com
              </a>
            </div>

            {/* Feedback */}
            <div className="space-y-3">
              <h4 className="font-semibold text-sm">Feedback</h4>
              {submitted ? (
                <p className="text-sm text-positive font-medium">✓ Thank you for your feedback!</p>
              ) : (
                <form onSubmit={handleSubmit} className="space-y-2">
                  <textarea
                    value={feedback}
                    onChange={(e) => setFeedback(e.target.value)}
                    placeholder="Suggestions, bugs, feature requests..."
                    rows={3}
                    className="w-full px-3 py-2 text-sm border rounded-lg focus:outline-none focus:border-fg resize-none bg-white"
                  />
                  <button
                    type="submit"
                    disabled={!feedback.trim()}
                    className="px-4 py-1.5 text-xs font-semibold border rounded-full hover:bg-fg hover:text-white transition-colors disabled:opacity-40"
                  >
                    Send Feedback
                  </button>
                </form>
              )}
            </div>
          </div>

          <div className="border-t mt-8 pt-4 text-center text-xs text-muted">
            © {new Date().getFullYear()} HoodGap Protocol. All rights reserved.
          </div>
        </div>
      </footer>

      <HowItWorksModal open={showHowItWorks} onClose={() => setShowHowItWorks(false)} />
    </>
  );
}
