// Deploy CHEESE BSC DEX Contracts (Excluding wNCH/Wrapped NCH)
// Run: npx hardhat run scripts/deploy-bsc-dex.js --network bscMainnet

const hre = require("hardhat");

async function main() {
    const [deployer] = await hre.ethers.getSigners();

    console.log("Deploying contracts with account:", deployer.address);
    console.log("Account balance:", (await deployer.provider.getBalance(deployer.address)).toString());

    // Configuration
    const TREASURY_ADDRESS = "0x9a4E604Ccef19f1ab9A4509dccB2F00D244d394E";
    const USDT_BSC = "0x55d398326f99059fF775485246999027B3197955"; // BSC USDT
    const CHEESE_BSC = "0x810cf3c5ff83f7b6d2863c91a8e04af6e3bc5879"; // Existing CHEESE token

    console.log("\n=== Deploying CHEESE DEX Router ===");
    const CheeseDEXRouter = await hre.ethers.getContractFactory("CheeseDEXRouter");
    const dexRouter = await CheeseDEXRouter.deploy(TREASURY_ADDRESS, USDT_BSC);
    await dexRouter.waitForDeployment();
    const dexRouterAddress = await dexRouter.getAddress();
    console.log("DEX Router deployed to:", dexRouterAddress);

    console.log("\n=== Setting Token Addresses ===");
    // Set wNCH as address(0) since it is retired/removed
    await dexRouter.setTokenAddresses("0x0000000000000000000000000000000000000000", CHEESE_BSC);
    console.log("Token addresses set (CHEESE set, wNCH disabled)!");

    console.log("\n=== Creating Pools ===");

    // Create CHEESE/USDT pool
    console.log("Creating CHEESE/USDT pool...");
    const tx2 = await dexRouter.createPool(CHEESE_BSC, USDT_BSC);
    await tx2.wait();
    console.log("CHEESE/USDT pool created!");

    console.log("\n========================================");
    console.log("DEPLOYMENT COMPLETE!");
    console.log("========================================");
    console.log("\nContract Addresses:");
    console.log("- DEX Router:", dexRouterAddress);
    console.log("- CHEESE Token:", CHEESE_BSC);
    console.log("- USDT:", USDT_BSC);
    console.log("\nTreasury:", TREASURY_ADDRESS);
    console.log("\nPools Created:");
    console.log("- CHEESE/USDT");

    // Save deployment info
    const deploymentInfo = {
        network: "BSC Mainnet",
        deployer: deployer.address,
        timestamp: new Date().toISOString(),
        contracts: {
            dexRouter: dexRouterAddress,
            CHEESE: CHEESE_BSC,
            USDT: USDT_BSC
        },
        treasury: TREASURY_ADDRESS,
        pools: ["CHEESE/USDT"]
    };

    console.log("\nDeployment Info (save this!):");
    console.log(JSON.stringify(deploymentInfo, null, 2));
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error);
        process.exit(1);
    });
