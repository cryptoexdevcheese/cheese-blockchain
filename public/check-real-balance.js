const { ethers } = require('ethers');

// BSC RPC (Public)
const RPC_URL = 'https://bsc-dataseed.binance.org/';
const provider = new ethers.JsonRpcProvider(RPC_URL);

const buggyAddress = '0x0380327b38ea655824484302ed06060db3214a7d';
const standardAddress = '0x9A77650d993132F5114136952eA64a2BE117C647'; // Derived via standard secp256k1 from 34698e...

async function checkBalances() {
    console.log('Checking balances on BSC...');
    console.log('RPC:', RPC_URL);

    try {
        console.log(`\n1. Checking Buggy Address: ${buggyAddress}`);
        const bal1 = await provider.getBalance(buggyAddress);
        console.log(`   BNB Balance: ${ethers.formatEther(bal1)} BNB`);

        console.log(`\n2. Checking Standard Address: ${standardAddress}`);
        const bal2 = await provider.getBalance(standardAddress);
        console.log(`   BNB Balance: ${ethers.formatEther(bal2)} BNB`);

        if (bal1 > 0n) {
            console.log('\n❌ FUNDS CONFIRMED ON BUGGY ADDRESS.');
        } else if (bal2 > 0n) {
            console.log('\n✅ FUNDS ARE ON STANDARD ADDRESS! IT IS A UI BUG!');
        } else {
            console.log('\n⚠️ Both addresses are empty.');
        }

    } catch (e) {
        console.error('Error checking balances:', e.message);
    }
}

checkBalances();
