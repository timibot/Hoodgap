"use client";

import { useState, useEffect } from "react";

interface Toast {
  id: string;
  type: "pending" | "success" | "error";
  title: string;
  message: string;
  txHash?: string;
}

let toasts: Toast[] = [];
let listeners: Array<() => void> = [];

function notify() {
  listeners.forEach((l) => l());
}

export function showToast(toast: Omit<Toast, "id">) {
  const id = Math.random().toString(36).slice(2);
  toasts = [...toasts, { ...toast, id }];
  notify();
  if (toast.type !== "pending") {
    setTimeout(() => dismissToast(id), 4000);
  }
  return id;
}

export function updateToast(id: string, updates: Partial<Toast>) {
  toasts = toasts.map((t) => (t.id === id ? { ...t, ...updates } : t));
  notify();
  if (updates.type && updates.type !== "pending") {
    setTimeout(() => dismissToast(id), 4000);
  }
}

export function dismissToast(id: string) {
  toasts = toasts.filter((t) => t.id !== id);
  notify();
}

export default function TransactionToast() {
  const [, forceRender] = useState(0);

  useEffect(() => {
    const listener = () => forceRender((n) => n + 1);
    listeners.push(listener);
    return () => {
      listeners = listeners.filter((l) => l !== listener);
    };
  }, []);

  if (toasts.length === 0) return null;

  return (
    <div className="fixed bottom-4 right-4 z-50 space-y-2 max-w-xs">
      {toasts.map((toast) => (
        <div
          key={toast.id}
          className="animate-slide-up bg-white border rounded-lg p-4 shadow-sm flex items-start gap-3"
        >
          <div className="text-sm mt-px">
            {toast.type === "pending" && (
              <span className="animate-spin inline-block">◌</span>
            )}
            {toast.type === "success" && "✓"}
            {toast.type === "error" && "✗"}
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-sm font-semibold">{toast.title}</div>
            <div className="text-xs text-muted mt-0.5">{toast.message}</div>
            {toast.txHash && (
              <div className="text-xs text-muted mt-1 font-mono truncate">
                {toast.txHash.slice(0, 10)}...{toast.txHash.slice(-6)}
              </div>
            )}
          </div>
          <button
            onClick={() => dismissToast(toast.id)}
            className="text-muted hover:text-fg text-xs"
          >
            ✕
          </button>
        </div>
      ))}
    </div>
  );
}
