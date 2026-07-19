/**
 * CHEESE Blockchain - Cryptographic License Key Generator
 * Signs a miner wallet address using the Founder private key.
 * 
 * Usage:
 *   node scripts/generate-license.js <miner_wallet_address>
 */

const ethers = require('ethers');

const FOUNDER_PRIVATE_KEY = process.env.FOUNDER_PRIVATE_KEY; // MUST be set in ENV - no fallback
const FOUNDER_ADDRESS = '0x0E6ec6713E7b5b7C11d969dA848813d08223598E';

async function main() {
    const args = process.argv.slice(2);
    if (args.length === 0) {
        console.log('\n❌ Error: Miner wallet address is required.');
        console.log('Usage:\n  node scripts/generate-license.js <miner_wallet_address>\n');
        process.exit(1);
    }

    const minerWallet = args[0].trim();
    if (!ethers.isAddress(minerWallet)) {
        console.error(`\n❌ Error: Invalid EVM wallet address: ${minerWallet}\n`);
        process.exit(1);
    }

    console.log('🔑 CHEESE BLOCKCHAIN LICENSE GENERATOR');
    console.log('====================================');
    console.log(`👑 Founder Address:  ${FOUNDER_ADDRESS}`);
    console.log(`⛏️  Miner Wallet:     ${minerWallet}`);
    console.log('------------------------------------');

    try {
        const wallet = new ethers.Wallet(FOUNDER_PRIVATE_KEY);
        const message = "CHEESE-LICENSE:" + minerWallet.toLowerCase();
        
        console.log(`📝 Signing message: "${message}"`);
        const signature = await wallet.signMessage(message);

        console.log('====================================');
        console.log('✅ LICENSE GENERATED SUCCESSFULLY!');
        console.log('\nCopy and paste this into your node environment configuration:\n');
        console.log(`PREMIUM_LICENSE_KEY="${signature}"`);
        console.log(`MINING_WALLET_ADDRESS="${minerWallet}"`);
        console.log('\n====================================');
    } catch (err) {
        console.error('❌ Generation failed:', err.message);
    }
}

main().catch(console.error);
