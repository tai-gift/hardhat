import { HardhatUserConfig } from "hardhat/config";
import "@nomicfoundation/hardhat-toolbox";
import "@openzeppelin/hardhat-upgrades";
import "@nomicfoundation/hardhat-ethers";
import {config as dotenvConfig} from "dotenv";

dotenvConfig();

const config: HardhatUserConfig = {
  solidity: {
    version: "0.8.27",
    settings: {
      optimizer: {
        enabled: true,
        runs: 200
      }
    }
  },
  networks: {
    taiko: {
      url: "https://rpc.hekla.taiko.xyz", // Replace with Taiko's RPC URL
      accounts: [process.env.PRIVATE_KEY!] // Replace with your wallet's private key
    }
  }
};

export default config;
