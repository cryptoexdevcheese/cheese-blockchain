// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

contract CheeseNotary {
    struct NotaryRecord {
        string documentHash;
        address client;
        address notary;
        uint256 timestamp;
        string fileType;
        string fileName;
        bool isVerified;
    }

    // Mapping from document SHA-256 hash string to its NotaryRecord
    mapping(string => NotaryRecord) public records;
    mapping(string => bool) public recordExists;

    // Registry of authorized notaries (optional administrative access, default open to any sender)
    mapping(address => bool) public authorizedNotaries;
    address public owner;

    event DocumentNotarized(
        string indexed documentHash,
        address indexed client,
        address indexed notary,
        uint256 timestamp,
        string fileType,
        string fileName
    );

    constructor() {
        owner = msg.sender;
        authorizedNotaries[msg.sender] = true;
    }

    modifier onlyOwner() {
        require(msg.sender == owner, "Only owner can call this");
        _;
    }

    function setNotaryAuthorization(address _notary, bool _status) public onlyOwner {
        authorizedNotaries[_notary] = _status;
    }

    // Verify ECDSA signature of client
    function getSigner(bytes32 _ethSignedMessageHash, bytes memory _sig) public pure returns (address) {
        require(_sig.length == 65, "Invalid signature length");
        bytes32 r;
        bytes32 s;
        uint8 v;
        assembly {
            r := mload(add(_sig, 32))
            s := mload(add(_sig, 64))
            v := byte(0, mload(add(_sig, 96)))
        }
        return ecrecover(_ethSignedMessageHash, v, r, s);
    }

    // Notarize a document with the client's signature. msg.sender is the notary.
    function notarize(
        string memory _documentHash,
        address _client,
        bytes memory _clientSignature,
        string memory _fileType,
        string memory _fileName
    ) public {
        require(!recordExists[_documentHash], "Document already notarized");
        // Verify msg.sender is authorized notary if notary restrictions are turned on (open by default for demo ease)
        // require(authorizedNotaries[msg.sender], "Not an authorized notary");

        // The client signs the 66-character document hash string directly (e.g. "0x...")
        bytes32 ethSignedMessageHash = keccak256(abi.encodePacked("\x19Ethereum Signed Message:\n66", _documentHash));
        
        address signer = getSigner(ethSignedMessageHash, _clientSignature);
        require(signer == _client, "Invalid client signature");

        records[_documentHash] = NotaryRecord({
            documentHash: _documentHash,
            client: _client,
            notary: msg.sender,
            timestamp: block.timestamp,
            fileType: _fileType,
            fileName: _fileName,
            isVerified: true
        });

        recordExists[_documentHash] = true;

        emit DocumentNotarized(
            _documentHash,
            _client,
            msg.sender,
            block.timestamp,
            _fileType,
            _fileName
        );
    }

    // Public lookup helper
    function getRecord(string memory _documentHash) public view returns (
        string memory documentHash,
        address client,
        address notary,
        uint256 timestamp,
        string memory fileType,
        string memory fileName,
        bool isVerified
    ) {
        require(recordExists[_documentHash], "Record does not exist");
        NotaryRecord memory rec = records[_documentHash];
        return (
            rec.documentHash,
            rec.client,
            rec.notary,
            rec.timestamp,
            rec.fileType,
            rec.fileName,
            rec.isVerified
        );
    }
}
