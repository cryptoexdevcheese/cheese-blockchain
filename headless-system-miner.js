/**
 * 🧀 CHEESE BLOCKCHAIN - HEADLESS SYSTEM & REGISTERED MINER
 * Automates mining for system wallets & dynamically registered user mining wallets.
 */

class HeadlessSystemMiner {
    constructor(blockchain, options = {}) {
        this.blockchain = blockchain;
        this.interval = options.interval || 30000; // Default: 30 seconds for active multi-wallet rotation
        this.isRunning = false;
        
        this.CORE_WALLETS = [
            '0x0E6ec6713E7b5b7C11d969dA848813d08223598E', // FOUNDER
            '0x045D4e61757a873DAF5F3B59CCeD9f2585643cc3', // TREASURY
            '0x3801490C9f806c917b8CbA710Db9135FA3B116ae', // LIQUIDITY
            '0x712A1CBa607C60D95f27088c80aBbBD1f53d33Fe', // OPERATOR
            '0x7e73806ef3E8e11b9a226672Df5EC8E816EDA56D', // MINING VAULT
            '0x0ef03fd4C994614c4f90930e643Ab9048Ab54587', // EXEMPT SYSTEM 1
            '0x051CEcfd2229E9D1a7FB8269d4201487C26565D5', // EXEMPT SYSTEM 2
            // User Authorized Mining Wallets
            '0xe26E75e145bfd03A696B9bd7205dFd1ac63d370F',
            '0x3C1B21D17E09a9b5e7d5Bd46a910C87B3f180bd5',
            '0xF7c8e9f6644FeC4482548D643DD455bbe21Ea398',
            '0x1a31623AD610f810554C866453a303B37c02DC7D',
            '0x474C68e328D426023c96B5ba49Fd69c34E738aED',
            '0x5de7217B05973e665935754556066584B4F63BdE',
            '0xaCe96e917716D2EB7738C2b39e9f9DA9f7eDCe54',
            '0x8525545406696a0f2648aDdb177cf4AD2E38C531',
            '0xc6F01CFB17fD3dbDbE46FC2F4A693d56d78C8015',
            '0x12883F6a8b645E6F407a7C95aAfa81049a415334'
        ];
        
        this.currentIndex = 0;
    }

    start() {
        if (this.isRunning) return;
        this.isRunning = true;
        console.log(`⛏️  System & Registered Miner Started (Rotation Interval: ${this.interval / 1000}s)`);
        this.mineLoop();
    }

    stop() {
        this.isRunning = false;
        console.log('🛑 System Miner Stopped');
    }

    async getActiveMiningWallets() {
        const walletSet = new Set(this.CORE_WALLETS.map(w => w.toLowerCase()));
        
        // Dynamically fetch registered miners from DualStorage / database
        if (this.blockchain && this.blockchain.database && typeof this.blockchain.database.getAllMiningRegistrations === 'function') {
            try {
                const dbRegistrations = await this.blockchain.database.getAllMiningRegistrations();
                if (Array.isArray(dbRegistrations)) {
                    dbRegistrations.forEach(reg => {
                        const addr = reg.walletAddress || reg.minerAddress || reg.address;
                        if (addr && typeof addr === 'string' && addr.startsWith('0x')) {
                            walletSet.add(addr.toLowerCase());
                        }
                    });
                }
            } catch (e) {
                console.warn('⚠️ Could not query db mining registrations:', e.message);
            }
        }
        
        return Array.from(walletSet);
    }

    async mineLoop() {
        while (this.isRunning) {
            try {
                const activeWallets = await this.getActiveMiningWallets();
                if (activeWallets.length === 0) continue;

                this.currentIndex = this.currentIndex % activeWallets.length;
                const minerAddress = activeWallets[this.currentIndex];
                
                console.log(`⚙️  System Miner: Mining block with [${this.currentIndex + 1}/${activeWallets.length}] ${minerAddress.substring(0, 10)}...`);
                
                const block = await this.blockchain.minePendingTransactions(minerAddress);
                
                if (block) {
                    console.log(`✅ System Miner: Block ${block.index} successfully mined by ${minerAddress}`);
                }
                
                // Rotate to next wallet in cycle
                this.currentIndex = (this.currentIndex + 1) % activeWallets.length;
                
            } catch (error) {
                console.warn('⚠️  System Miner Loop Notice:', error.message);
            }
            
            // Wait for next interval
            await new Promise(resolve => setTimeout(resolve, this.interval));
        }
    }
}

module.exports = HeadlessSystemMiner;
