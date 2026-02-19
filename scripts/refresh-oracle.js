const hre = require("hardhat");

async function main() {
  const oracle = await hre.ethers.getContractAt(
    "MockChainlinkOracle",
    "0xBcfA353B27EA9d3d45CBE657d07BEbE5950715fA"
  );

  const block = await hre.ethers.provider.getBlock("latest");
  const now = block.timestamp;

  // Get current price
  const roundData = await oracle.latestRoundData();
  const currentPrice = roundData[1];
  const updatedAt = Number(roundData[3]);
  const age = now - updatedAt;

  console.log("Current oracle price:", Number(currentPrice) / 1e8);
  console.log("Last updated:", updatedAt);
  console.log("Current time:", now);
  console.log("Age:", age, "seconds (", (age / 60).toFixed(1), "minutes)");
  console.log("Stale?:", age >= 3600 ? "YES (>1 hour)" : "No");

  // Refresh oracle timestamp
  console.log("\nRefreshing oracle timestamp...");
  const tx = await oracle.update(currentPrice, now);
  await tx.wait();
  console.log("Oracle refreshed at timestamp:", now);

  // Verify
  const newData = await oracle.latestRoundData();
  console.log("New updatedAt:", Number(newData[3]));
  console.log("New age: 0 seconds");
}

main().catch(console.error);
