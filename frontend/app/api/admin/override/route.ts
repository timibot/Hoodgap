import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { setOverride, clearOverride, clearAllOverrides, getOverride } from "@/lib/priceOverrides";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { action, ticker = "TSLA", price, change, marketCap } = body;

    if (action === "set") {
      const data: any = {};
      if (price !== undefined) data.price = Number(price);
      if (change !== undefined) data.change = Number(change);
      if (marketCap !== undefined) data.marketCap = Number(marketCap);
      setOverride(ticker, data);
      return NextResponse.json({ ok: true, override: getOverride(ticker) });
    }

    if (action === "reset") {
      clearOverride(ticker);
      return NextResponse.json({ ok: true, cleared: ticker });
    }

    if (action === "reset-all") {
      clearAllOverrides();
      return NextResponse.json({ ok: true, cleared: "all" });
    }

    return NextResponse.json({ error: "Invalid action" }, { status: 400 });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function GET() {
  const override = getOverride("TSLA");
  return NextResponse.json({ override });
}
