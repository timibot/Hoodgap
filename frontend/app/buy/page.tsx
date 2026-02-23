"use client";

import RiskWizard from "@/components/insurance/RiskWizard";
import FaucetButton from "@/components/wallet/FaucetButton";
import { useRouter } from "next/navigation";

export default function BuyPage() {
  const router = useRouter();

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold">Buy Insurance</h1>
          <p className="text-sm text-muted mt-1">
            Protect your TSLA position against price gaps between market sessions.
          </p>
        </div>
        <FaucetButton />
      </div>
      <RiskWizard onSuccess={() => router.push("/portfolio")} />
    </div>
  );
}
