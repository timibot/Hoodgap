// Purpose: Production configuration for Robinhood Testnet/Mainnet
// Preconditions: .env must contain ROBINHOOD_TESTNET_RPC and PRIVATE_KEY
require("@nomicfoundation/hardhat-toolbox");
require("dotenv").config();

/** @type import('hardhat/config').HardhatUserConfig */
module.exports = {
  solidity: {
    version: "0.8.20",
    settings: {
      optimizer: {
        enabled: true,
        runs: 200,
      },
      // Hardening: Explicitly set EVM version to avoid PUSH0 issues on L2
      evmVersion: "paris", 
    },
  },

  networks: {
    hardhat: {
      chainId: 31337,
      forking: {
        url: process.env.ROBINHOOD_TESTNET_RPC || "",
        enabled: process.env.ENABLE_FORKING === "true",
      },
    },

    localhost: {
      url: "http://127.0.0.1:8545",
      chainId: 31337,
    },

    robinhoodTestnet: {
      url: process.env.ROBINHOOD_TESTNET_RPC || "",
      chainId: 46630,
      accounts: process.env.PRIVATE_KEY ? [process.env.PRIVATE_KEY] : [],
      // Architecture Note: Fixed gas price is often safer on early-stage testnets
      gasPrice: 1000000000, 
    },

    robinhoodMainnet: {
      url: process.env.ROBINHOOD_MAINNET_RPC || "",
      chainId: 42042,
      accounts: process.env.MAINNET_PRIVATE_KEY ? [process.env.MAINNET_PRIVATE_KEY] : [],
      gasPrice: "auto",
    },
  },

  etherscan: {
    apiKey: {
      // Use the same key or separate ones for the explorer verification
      robinhoodTestnet: process.env.ROBINHOOD_EXPLORER_API_KEY || "empty",
      robinhoodMainnet: process.env.ROBINHOOD_EXPLORER_API_KEY || "empty",
    },
    customChains: [
      {
        network: "robinhoodTestnet",
        chainId: 46630,
        urls: {
          apiURL: "https://explorer.testnet.chain.robinhood.com/api",
          browserURL: "https://explorer.testnet.chain.robinhood.com",
        },
      },
      {
        network: "robinhoodMainnet",
        chainId: 42042,
        urls: {
          apiURL: "https://explorer.robinhood.com/api",
          browserURL: "https://explorer.robinhood.com",
        },
      },
    ],
  },

  gasReporter: {
    enabled: process.env.REPORT_GAS === "true",
    currency: "USD",
    coinmarketcap: process.env.COINMARKETCAP_API_KEY,
    outputFile: "gas-report.txt",
    noColors: true,
  },
};