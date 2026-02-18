"use client";

import { useState, useEffect, type ReactNode, Suspense, lazy } from "react";

// Lazy-load the entire Web3 + Contract + User provider stack
// This ensures ethers.js (~800KB) is split into a separate chunk
const LazyProviders = lazy(() => import("./LazyProviders"));

export default function ClientProviders({ children }: { children: ReactNode }) {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted) {
    return <>{children}</>;
  }

  return (
    <Suspense fallback={<>{children}</>}>
      <LazyProviders>{children}</LazyProviders>
    </Suspense>
  );
}
