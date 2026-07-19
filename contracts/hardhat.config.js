require("@nomicfoundation/hardhat-toolbox");
require("dotenv").config();

/** @type import('hardhat/config').HardhatUserConfig */
module.exports = {
    solidity: {
        version: "0.8.20",
        settings: {
            optimizer: {
                enabled: true,
                runs: 200
            }
        }
    },
    networks: {
        hardhat: {},
        bscTestnet: {
            url: "https://data-seed-prebsc-1-s1.binance.org:8545",
            chainId: 97,
            accounts: process.env.PRIVATE_KEY || process.env.BRIDGE_PRIVATE_KEY ? [process.env.PRIVATE_KEY || process.env.BRIDGE_PRIVATE_KEY] : []
        },
        bscMainnet: {
            url: "https://bsc-dataseed.binance.org/",
            chainId: 56,
            accounts: process.env.PRIVATE_KEY || process.env.BRIDGE_PRIVATE_KEY ? [process.env.PRIVATE_KEY || process.env.BRIDGE_PRIVATE_KEY] : []
        }
    },
    etherscan: {
        apiKey: {
            bscMainnet: process.env.BSCSCAN_API_KEY || "",
            bsc: process.env.BSCSCAN_API_KEY || "",
            bscTestnet: process.env.BSCSCAN_API_KEY || ""
        },
        customChains: [
            {
                network: "bscMainnet",
                chainId: 56,
                urls: {
                    apiURL: "https://api.bscscan.com/api",
                    browserURL: "https://bscscan.com"
                }
            }
        ]
    }
};
