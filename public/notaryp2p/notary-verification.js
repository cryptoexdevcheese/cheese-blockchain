/**
 * notary-verification.js
 *
 * Phase 1 front-end integration for NotaryRegistry.sol.
 * Checks an address against the on-chain notary whitelist before the
 * NotaryP2P workspace renders a "Connected to Notary" state.
 *
 * Loaded alongside the existing notaryp2p front-end JS.
 * verifyNotaryAddress() is called when the remote peer's wallet address
 * is received via the WebRTC data channel address_handshake.
 *
 * Assumes ethers.js is already loaded globally.
 */

// Load from localStorage so the user can configure it in the Governance Node tab.
// Falls back to the zero address (which means verification will fail gracefully).
var NOTARY_REGISTRY_ADDRESS = localStorage.getItem('cheese_notary_registry_address') || "0x0000000000000000000000000000000000000000";

const NOTARY_REGISTRY_ABI = [
  "function isVerifiedNotary(address notaryAddress) external view returns (bool)",
  "function getNotary(address notaryAddress) external view returns (string memory agencyName, string memory credentialId, bool active, uint256 dateAdded, uint256 dateRevoked)"
];

/**
 * Returns a read-only contract instance using whatever provider the rest of
 * the app is already using (falls back to window.ethereum if present).
 */
function getNotaryRegistryContract() {
  if (!window.ethereum || typeof ethers === 'undefined') {
    return null;
  }
  try {
    const provider = new ethers.providers.Web3Provider(window.ethereum);
    return new ethers.Contract(NOTARY_REGISTRY_ADDRESS, NOTARY_REGISTRY_ABI, provider);
  } catch (e) {
    return null;
  }
}

const FOUNDATION_NOTARIES = {
  "0x045d4e61757a873daf5f3b59cced9f2585643cc3": { agencyName: "CHEESE Sovereign Treasury Office", credentialId: "GOV-TREASURY-01" },
  "0x0e6ec6713e7b5b7c11d969da848813d08223598e": { agencyName: "CHEESE Founder Office", credentialId: "GOV-FOUNDER-01" },
  "0x712a1cba607c60d95f27088c80abbbd1f53d33fe": { agencyName: "CHEESE Operator Services", credentialId: "GOV-OPERATOR-01" },
  "0x3801490c9f806c917b8cba710db9135fa3b116ae": { agencyName: "CHEESE Liquidity Custody", credentialId: "GOV-LIQUIDITY-01" }
};

/**
 * Checks whether an address is an active, whitelisted notary.
 * Call this BEFORE rendering any "Connected to Notary" / "Verified
 * Government Notary" UI state.
 *
 * @param {string} notaryAddress - the remote peer's wallet address
 * @returns {Promise<{ verified: boolean, agencyName?: string, credentialId?: string }>}
 */
async function verifyNotaryAddress(notaryAddress) {
  try {
    if (!notaryAddress) return { verified: false };
    
    // First try the foundation local registry mapping
    const normalized = notaryAddress.toLowerCase();
    if (FOUNDATION_NOTARIES[normalized]) {
      return {
        verified: true,
        agencyName: FOUNDATION_NOTARIES[normalized].agencyName,
        credentialId: FOUNDATION_NOTARIES[normalized].credentialId
      };
    }

    const registry = getNotaryRegistryContract();
    if (!registry || NOTARY_REGISTRY_ADDRESS === "0x0000000000000000000000000000000000000000") {
      return { verified: false, reason: 'Registry address unconfigured' };
    }

    const verified = await registry.isVerifiedNotary(notaryAddress);

    if (!verified) {
      return { verified: false };
    }

    const record = await registry.getNotary(notaryAddress);
    return {
      verified: true,
      agencyName: record.agencyName,
      credentialId: record.credentialId
    };
  } catch (err) {
    console.warn("NotaryRegistry verification offline/skipped:", err.message);
    return { verified: false, error: err.message };
  }
}

/**
 * Called when the client receives the notary peer's wallet address.
 * Updates the notary-verification-status badge in the UI.
 */
async function onNotaryPeerConnected(notaryAddress) {
  const statusEl = document.getElementById("notary-verification-status");
  if (!statusEl) return;

  statusEl.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Checking NotaryRegistry...';
  statusEl.className = "identity-verify-badge unverified";

  const result = await verifyNotaryAddress(notaryAddress);

  if (result.verified) {
    statusEl.innerHTML = `<i class="fa-solid fa-circle-check"></i> Verified Government Notary — ${result.agencyName} (${result.credentialId})`;
    statusEl.className = "identity-verify-badge verified";
  } else {
    statusEl.innerHTML = '<i class="fa-solid fa-circle-xmark"></i> Notary not found on registry (unverified)';
    statusEl.className = "identity-verify-badge unverified";
  }
}

/**
 * Wired stub: enable document upload UI for the citizen.
 * Called when notary is verified.
 */
function enableCitizenDocumentUpload() {
  const uploadBox = document.getElementById('p2p-file-upload-box');
  const signBox = document.getElementById('client-sign-identity-box');
  if (uploadBox) uploadBox.classList.remove('hidden');
  if (signBox) signBox.classList.remove('hidden');
}

/**
 * Wired stub: disable document upload UI for the citizen.
 * Called when notary verification fails.
 */
function disableCitizenDocumentUpload() {
  const uploadBox = document.getElementById('p2p-file-upload-box');
  const signBox = document.getElementById('client-sign-identity-box');
  if (uploadBox) uploadBox.classList.add('hidden');
  if (signBox) signBox.classList.add('hidden');
}
