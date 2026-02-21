const hre = require("hardhat");

async function main() {
  const [signer] = await hre.ethers.getSigners();
  const usdc = await hre.ethers.getContractAt("MockUSDC", "0xaAa6F06AEBA8f2369CA2a54a1DED782EF77D42b7");
  const hoodgap = await hre.ethers.getContractAt("HoodGap", "0xFFC79A5c26bc481f5C446F36C2CfDEF8318771b2");

  console.log("Wallet:", signer.address);

  // Check current state
  const bal = await usdc.balanceOf(signer.address);
  console.log("USDC balance:", Number(bal) / 1e6);

  const allowance = await usdc.allowance(signer.address, "0xFFC79A5c26bc481f5C446F36C2CfDEF8318771b2");
  console.log("USDC allowance to HoodGap:", Number(allowance) / 1e6);

  const stake = await hoodgap.stakerBalances(signer.address);
  console.log("Staked:", Number(stake) / 1e6);

  // Mint $10,000 USDC for buying policies
  const mintAmount = 10000n * 1000000n; // $10k with 6 decimals
  console.log("\nMinting $10,000 USDC for policy purchases...");
  const mintTx = await usdc.mint(signer.address, mintAmount);
  await mintTx.wait();
  
  const newBal = await usdc.balanceOf(signer.address);
  console.log("New USDC balance:", Number(newBal) / 1e6);

  // Approve HoodGap to spend USDC
  console.log("Approving HoodGap to spend USDC...");
  const maxUint = 2n**256n - 1n;
  const approveTx = await usdc.approve("0xFFC79A5c26bc481f5C446F36C2CfDEF8318771b2", maxUint);
  await approveTx.wait();
  console.log("Unlimited approval set");

  // Try calculating premium to see if buyPolicy would work
  try {
    const coverage = 500n * 1000000n; // $500 coverage
    const premium = await hoodgap.calculatePremium(coverage);
    console.log("\nPremium for $500 coverage:", Number(premium) / 1e6);
  } catch (e) {
    console.log("Premium calc error:", e.message);
  }

  // Check pool stats
  const stats = await hoodgap.getPoolStats();
  console.log("\nPool Stats:");
  console.log("  Total Staked:", Number(stats[0]) / 1e6);
  console.log("  Total Coverage:", Number(stats[1]) / 1e6);
  console.log("  Utilization:", Number(stats[2]) / 100, "%");
  
  console.log("\nDone! User wallet is funded and approved.");
}

main().catch(console.error);
