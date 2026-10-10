import hardhatIgnitionViem from "@nomicfoundation/hardhat-ignition-viem";
import hardhatKeystore from "@nomicfoundation/hardhat-keystore";
import hardhatVerify from "@nomicfoundation/hardhat-verify";
import { configVariable, defineConfig } from "hardhat/config";

// Deploy key and explorer key come from the encrypted keystore: npx hardhat keystore set DEPLOYER_KEY
export default defineConfig({
  plugins: [hardhatIgnitionViem, hardhatKeystore, hardhatVerify],
  solidity: { version: "0.8.28", settings: { optimizer: { enabled: true, runs: 200 } } },
  paths: { sources: "src", tests: { solidity: "test" } },
  networks: {
    baseSepolia: { type: "http", chainType: "op", url: "https://sepolia.base.org", accounts: [configVariable("DEPLOYER_KEY")] },
    base: { type: "http", chainType: "op", url: "https://mainnet.base.org", accounts: [configVariable("DEPLOYER_KEY")] },
  },
  verify: { etherscan: { apiKey: configVariable("ETHERSCAN_API_KEY") } },
});
