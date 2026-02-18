"use client";

import type { ReactNode } from "react";
import { Web3Provider } from "./Web3Context";
import { ContractProvider } from "./ContractContext";
import { UserProvider } from "./UserContext";

// Dynamically imported by ClientProviders.tsx
// Pulls ethers.js into a separate chunk
export default function LazyProviders({ children }: { children: ReactNode }) {
  return (
    <Web3Provider>
      <ContractProvider>
        <UserProvider>
          {children}
        </UserProvider>
      </ContractProvider>
    </Web3Provider>
  );
}
