const hre = require("hardhat");

async function main() {
  const [signer] = await hre.ethers.getSigners();
  const hoodgap = await hre.ethers.getContractAt("HoodGap", "0xFFC79A5c26bc481f5C446F36C2CfDEF8318771b2");
  const usdc = await hre.ethers.getContractAt("MockUSDC", "0xaAa6F06AEBA8f2369CA2a54a1DED782EF77D42b7");

  console.log("Signer:", signer.address);
  console.log("USDC balance:", Number(await usdc.balanceOf(signer.address)) / 1e6);
  console.log("Allowance:", Number(await usdc.allowance(signer.address, "0xFFC79A5c26bc481f5C446F36C2CfDEF8318771b2")) / 1e6);
  
  // Check treasury  
  const treasury = await hoodgap.treasury();
  console.log("Treasury:", treasury);
  
  // Check paused
  const paused = await hoodgap.paused();
  console.log("Paused:", paused);
  
  // Check timing
  const currentWeek = await hoodgap.getCurrentSettlementWeek();
  console.log("Current week:", Number(currentWeek));
  
  // Check oracle
  const oracle = await hre.ethers.getContractAt("MockChainlinkOracle", "0xBcfA353B27EA9d3d45CBE657d07BEbE5950715fA");
  const roundData = await oracle.latestRoundData();
  console.log("Oracle price:", Number(roundData[1]) / 1e8);
  console.log("Oracle updatedAt:", Number(roundData[3]));
  
  const block = await hre.ethers.provider.getBlock("latest");
  console.log("Block timestamp:", block.timestamp);
  console.log("Oracle age (seconds):", block.timestamp - Number(roundData[3]));

  // Try to buy a policy
  const coverage = 500n * 1000000n; // $500
  const threshold = 500n; // 5%
  
  console.log("\nAttempting buyPolicy($500, 5%)...");
  try {
    const premium = await hoodgap.calculatePremium(coverage);
    console.log("Premium:", Number(premium) / 1e6);
    
    const tx = await hoodgap.buyPolicy(coverage, threshold);
    const receipt = await tx.wait();
    console.log("SUCCESS! Policy purchased. TxHash:", receipt.hash);
  } catch (e) {
    console.log("FAILED:", e.message);
    if (e.data) console.log("Error data:", e.data);
  }
}

main().catch(console.error);
