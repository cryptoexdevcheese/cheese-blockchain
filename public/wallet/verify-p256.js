const { webcrypto } = require('crypto');

async function importKey(hexKey) {
    const keyBuffer = Buffer.from(hexKey, 'hex');
    try {
        // Import as P-256 private key
        return await webcrypto.subtle.importKey(
            'pkcs8',
            await createPkcs8Header(keyBuffer), // Need to wrap raw key in PKCS#8
            { name: 'ECDSA', namedCurve: 'P-256' },
            true,
            ['sign']
        );
    } catch (e) {
        // Try importing raw if PKCS8 fails (unlikely for raw hex)
        // Actually, wallet-core:39 says privateKey is arrayBufferToHex(exportKey('pkcs8'))
        // So the stored hex IS the PKCS8 format!
        return await webcrypto.subtle.importKey(
            'pkcs8',
            keyBuffer,
            { name: 'ECDSA', namedCurve: 'P-256' },
            true,
            ['sign']
        );
    }
}

async function verifyDerivation() {
    console.log('Verifying P-256 Derivation...');

    // The hex string from your debug output (stored private key)
    // Note: The debug output private key you pasted: 34698eaa... has 64 hex chars (32 bytes).
    // BUT wallet-core says it stores exported 'pkcs8' format which is much longer.
    // The "decrypted" key we got earlier was 34698e... (32 bytes). 
    // Wait, if it's 32 bytes, it's a RAW key, unlikely to be PKCS8.

    // Let's try to treat '34698e...' as the raw private key scalar.
    const privateKeyHex = '34698eaa9edea88fd8cf6adfaaf32c4f473b15dc940446247c9618a268198f2a';
    console.log('Private Key Hex:', privateKeyHex);

    try {
        // Note: Node's webcrypto might require strictly formatted formatting
        // Let's try using 'ethers' or 'elliptic' for P-256 if checks fail
        // But let's verify what wallet-core did:
        // const privateKey = await crypto.subtle.exportKey('pkcs8', keyPair.privateKey);
        // this.arrayBufferToHex(privateKey)
        // PKCS8 exported keys are usually header + key, > 32 bytes.
        // Your key is exactly 32 bytes.

        // HYPOTHESIS: The stored key is NOT the P-256 exported key, but maybe a raw key?
        // Or maybe for IMPORTED wallets (from mnemonic?), it stores the raw entropy?

        // Let's try deriving P-256 public key from this raw private scalar.
        // We can use node's 'crypto' for this.
        const crypto = require('crypto');

        // Create ECDH/ECDSA key object from raw private key
        // Node uses secp256k1 by default for some things, but we need prime256v1 (P-256)
        const ecdh = crypto.createECDH('prime256v1'); // prime256v1 is P-256
        ecdh.setPrivateKey(Buffer.from(privateKeyHex, 'hex'));

        const publicKey = ecdh.getPublicKey(); // Uncompressed public key (04 + x + y)
        console.log('Public Key (Raw):', publicKey.toString('hex'));

        // Wallet-core logic:
        // const publicKeyHash = await crypto.subtle.digest('SHA-256', publicKey);
        // BUT: crypto.subtle.exportKey('spki', keyPair.publicKey) includes headers!
        // SPKI format is not just raw X/Y.

        // This is complex. The wallet-core used WebCrypto 'spki' export.
        // We need to simulate that SPKI structure.

        // SPKI Header for P-256: 
        // 3059301306072a8648ce3d020106082a8648ce3d030107034200 + [04 + X + Y]
        // (Approximate, might vary slightly)

        const spkiHeader = Buffer.from('3059301306072a8648ce3d020106082a8648ce3d030107034200', 'hex');
        const spkiBuffer = Buffer.concat([spkiHeader, publicKey]);

        console.log('Simulated SPKI:', spkiBuffer.toString('hex'));

        const hash = crypto.createHash('sha256').update(spkiBuffer).digest();
        const address = '0x' + hash.slice(0, 20).toString('hex');

        console.log('Derived Address (P-256 SPKI -> SHA256):', address);
        console.log('Expected Address:', '0x0380327b38ea655824484302ed06060db3214a7d');
        console.log('MATCH:', address.toLowerCase() === '0x0380327b38ea655824484302ed06060db3214a7d');

    } catch (e) {
        console.error('Error:', e);
    }
}

verifyDerivation();
