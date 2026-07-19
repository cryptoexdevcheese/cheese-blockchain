// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @title NotaryRegistry
/// @notice On-chain whitelist of credentialed notary addresses for the NotaryP2P module.
/// @dev Additions and revocations are restricted to a governance multisig. This is the
///      Phase 1 foundation referenced in the NotaryP2P Architectural Roadmap report —
///      it is the gate that the front end checks before rendering a "Connected to
///      Notary" state, and the anchor that the citizen's signature should reference
///      alongside the document hash.
contract NotaryRegistry {
    struct Notary {
        string agencyName;     // e.g. "LGU Benguet", "DA-CAR"
        string credentialId;   // license / commission number
        bool active;
        uint256 dateAdded;
        uint256 dateRevoked;
    }

    address public governanceMultisig;
    mapping(address => Notary) public notaries;
    address[] public notaryList;

    event NotaryAdded(
        address indexed notaryAddress, string agencyName, string credentialId
    );
    event NotaryRevoked(address indexed notaryAddress, uint256 timestamp);
    event GovernanceTransferred(
        address indexed oldMultisig, address indexed newMultisig
    );

    modifier onlyGovernance() {
        require(
            msg.sender == governanceMultisig,
            "Not authorized: governance multisig only"
        );
        _;
    }

    constructor(address _governanceMultisig) {
        require(_governanceMultisig != address(0), "Invalid multisig address");
        governanceMultisig = _governanceMultisig;
    }

    /// @notice Add a new verified notary. Restricted to governance.
    function addNotary(
        address notaryAddress,
        string calldata agencyName,
        string calldata credentialId
    )
        external onlyGovernance
    {
        require(notaryAddress != address(0), "Invalid notary address");
        require(!notaries[notaryAddress].active, "Notary already active");
        notaries[notaryAddress] =
            Notary(agencyName, credentialId, true, block.timestamp, 0);
        notaryList.push(notaryAddress);
        emit NotaryAdded(notaryAddress, agencyName, credentialId);
    }

    /// @notice Revoke a notary's standing. Restricted to governance.
    function revokeNotary(address notaryAddress) external onlyGovernance {
        require(notaries[notaryAddress].active, "Notary not active");
        notaries[notaryAddress].active = false;
        notaries[notaryAddress].dateRevoked = block.timestamp;
        emit NotaryRevoked(notaryAddress, block.timestamp);
    }

    /// @notice Primary check used by the front end before allowing a notary session.
    function isVerifiedNotary(address notaryAddress) external view returns (bool) {
        return notaries[notaryAddress].active;
    }

    /// @notice Full record lookup for displaying agency/credential info in the UI.
    function getNotary(address notaryAddress)
        external
        view
        returns (
            string memory agencyName,
            string memory credentialId,
            bool active,
            uint256 dateAdded,
            uint256 dateRevoked
        )
    {
        Notary memory n = notaries[notaryAddress];
        return (n.agencyName, n.credentialId, n.active, n.dateAdded, n.dateRevoked);
    }

    /// @notice Returns every address ever added (active or revoked) for admin views.
    function getAllNotaries() external view returns (address[] memory) {
        return notaryList;
    }

    /// @notice Hands control of the registry to a new multisig (e.g. governance rotation).
    function transferGovernance(address newMultisig) external onlyGovernance {
        require(newMultisig != address(0), "Invalid address");
        emit GovernanceTransferred(governanceMultisig, newMultisig);
        governanceMultisig = newMultisig;
    }
}
