import { buildModule } from "@nomicfoundation/hardhat-ignition/modules";

// npx hardhat ignition deploy ignition/modules/Mecenate.ts --network baseSepolia
export default buildModule("Mecenate", (m) => ({ mecenate: m.contract("Mecenate") }));
