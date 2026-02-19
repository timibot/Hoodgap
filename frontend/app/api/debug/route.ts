import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET() {
  const hoodgapAddr = process.env.NEXT_PUBLIC_HOODGAP_ADDRESS ?? "(not set)";
  const usdcAddr = process.env.NEXT_PUBLIC_USDC_ADDRESS ?? "(not set)";
  const oracleAddr = process.env.NEXT_PUBLIC_ORACLE_ADDRESS ?? "(not set)";
  const rpcUrl = process.env.NEXT_PUBLIC_RPC_URL ?? "(not set)";
  const chainId = process.env.NEXT_PUBLIC_CHAIN_ID ?? "(not set)";

  // Test RPC connectivity
  let rpcStatus = "unknown";
  try {
    const res = await fetch(rpcUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", method: "eth_blockNumber", params: [], id: 1 }),
    });
    const data = await res.json();
    rpcStatus = data.result ? `ok (block ${parseInt(data.result, 16)})` : `error: ${JSON.stringify(data)}`;
  } catch (err: any) {
    rpcStatus = `failed: ${err.message}`;
  }

  return NextResponse.json({
    env: {
      NEXT_PUBLIC_HOODGAP_ADDRESS: hoodgapAddr,
      NEXT_PUBLIC_USDC_ADDRESS: usdcAddr,
      NEXT_PUBLIC_ORACLE_ADDRESS: oracleAddr,
      NEXT_PUBLIC_RPC_URL: rpcUrl,
      NEXT_PUBLIC_CHAIN_ID: chainId,
    },
    rpcStatus,
    timestamp: new Date().toISOString(),
  });
}
