"use client";

import { useState, useRef, useEffect } from "react";

interface InfoTooltipProps {
  title: string;
  children: React.ReactNode;
}

/**
 * ⓘ info button that opens a popover with explanatory text.
 * Click to open, click again or click outside to close.
 */
export default function InfoTooltip({ title, children }: InfoTooltipProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open]);

  return (
    <span className="relative inline-flex" ref={ref}>
      <button
        type="button"
        onClick={(e) => { e.preventDefault(); e.stopPropagation(); setOpen(!open); }}
        className="inline-flex items-center justify-center w-4 h-4 rounded-full text-[9px] font-bold leading-none border border-muted/40 text-muted hover:text-fg hover:border-fg/50 transition-colors ml-1 align-middle cursor-help"
        aria-label={`Info: ${title}`}
      >
        i
      </button>

      {open && (
        <div className="absolute z-50 bottom-full left-1/2 -translate-x-1/2 mb-2 w-64 animate-fade-in">
          <div className="bg-[hsl(0,0%,12%)] border border-[hsl(0,0%,22%)] rounded-lg shadow-xl p-3 text-left">
            <div className="font-semibold text-xs text-fg mb-1.5">{title}</div>
            <div className="text-xs text-muted leading-relaxed">{children}</div>
          </div>
          {/* Arrow */}
          <div className="absolute left-1/2 -translate-x-1/2 -bottom-1 w-2 h-2 bg-[hsl(0,0%,12%)] border-r border-b border-[hsl(0,0%,22%)] rotate-45" />
        </div>
      )}
    </span>
  );
}
