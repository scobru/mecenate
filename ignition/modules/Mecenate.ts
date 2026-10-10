import { buildModule } from "@nomicfoundation/hardhat-ignition/modules";

// npx hardhat ignition deploy ignition/modules/Mecenate.ts --network baseSepolia
// The deploying account receives the fee (1% of the price of each closed sale). Both are fixed forever once
// deployed; to change them, pass a parameters file: { "Mecenate": { "treasury": "0x…", "feeBps": 100 } }.
export default buildModule("Mecenate", (m) => {
  const treasury = m.getParameter("treasury", m.getAccount(0));
  const feeBps = m.getParameter("feeBps", 100);
  return { mecenate: m.contract("Mecenate", [treasury, feeBps]) };
});
