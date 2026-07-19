/**
 * Railway Compatibility Shim
 * This file exists solely because Railway has a hardcoded start command.
 * It simply redirects to the actual DEX server.
 */

console.log('🔀 Railway shim: Redirecting to blockchain-server.js...');
require('./blockchain-server.js');
