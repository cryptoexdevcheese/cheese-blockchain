const hre = require("hardhat");

async function main() {
  console.log("Deploying CheeseNotary Smart Contract...");

  const CheeseNotary = await hre.ethers.getContractFactory("CheeseNotary");
  const contract = await CheeseNotary.deploy();

  await contract.waitForDeployment();

  console.log("CheeseNotary deployed successfully!");
  console.log("Contract Address:", await contract.getAddress());
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
