if (document) document.addEventListener('DOMContentLoaded', () => {
    // --- DOM Elements ---
    const navLinks = document.querySelectorAll('.nav-links li');
    const categoryTitle = document.getElementById('categoryTitle');
    const categoryDesc = document.getElementById('categoryDesc');
    const dropCategory = document.getElementById('dropCategory');
    const dropzone = document.getElementById('dropzone');
    const fileInput = document.getElementById('fileInput');
    const uploadSection = document.querySelector('.upload-section');
    const processingArea = document.getElementById('processingArea');
    const resultArea = document.getElementById('resultArea');
    const hashValue = document.getElementById('hashValue');
    const txValue = document.getElementById('txValue');
    const resetBtn = document.getElementById('resetBtn');

    // P2P Elements
    const shareP2PBtn = document.getElementById('shareP2PBtn');
    const p2pTransferArea = document.getElementById('p2pTransferArea');
    const p2pLinkInput = document.getElementById('p2pLink');
    const copyLinkBtn = document.getElementById('copyLinkBtn');
    const transferStatusText = document.getElementById('transferStatusText');
    const transferSpinner = document.getElementById('transferSpinner');
    const progressBarContainer = document.getElementById('progressBarContainer');
    const progressBar = document.getElementById('progressBar');
    const cancelP2PBtn = document.getElementById('cancelP2PBtn');

    const p2pReceiverArea = document.getElementById('p2pReceiverArea');
    const incomingFileName = document.getElementById('incomingFileName');
    const incomingFileSize = document.getElementById('incomingFileSize');
    const incomingFileHash = document.getElementById('incomingFileHash');
    const receiverStatusText = document.getElementById('receiverStatusText');
    const receiverProgressBar = document.getElementById('receiverProgressBar');
    const receiverProgressBarContainer = document.getElementById('receiverProgressBarContainer');
    const receiverDownloadBox = document.getElementById('receiverDownloadBox');
    const downloadReceivedBtn = document.getElementById('downloadReceivedBtn');

    // New Choice System Elements
    const sendChoiceArea = document.getElementById('sendChoiceArea');
    const p2pMethodForm = document.getElementById('p2pMethodForm');
    const traditionalMethodForm = document.getElementById('traditionalMethodForm');
    const p2pReceiverAddress = document.getElementById('p2pReceiverAddress');
    const traditionalPlatform = document.getElementById('traditionalPlatform');
    const traditionalRecipient = document.getElementById('traditionalRecipient');
    const copyHashBtn = document.getElementById('copyHashBtn');
    const copyTxBtn = document.getElementById('copyTxBtn');
    const hashOnlyBtn = document.getElementById('hashOnlyBtn');
    const hashAndSendBtn = document.getElementById('hashAndSendBtn');
    const backToMethodsBtn = document.getElementById('backToMethodsBtn');
    const backToMethodsBtn2 = document.getElementById('backToMethodsBtn2');
    const sendP2PBtn = document.getElementById('sendP2PBtn');
    const sendTraditionalBtn = document.getElementById('sendTraditionalBtn');

    // History & Duplicate Alert DOM Elements
    const historySection = document.getElementById('historySection');
    const historyList = document.getElementById('historyList');
    const clearHistoryBtn = document.getElementById('clearHistoryBtn');
    const duplicateAlert = document.getElementById('duplicateAlert');
    const resultIcon = document.getElementById('resultIcon');
    const resultTitle = document.getElementById('resultTitle');

    // --- State Variables ---
    let currentFile = null;
    let currentHash = '';
    let currentTxId = '';
    let peerConnection = null;
    let dataChannel = null;
    let socket = null;
    let roomId = null;
    const CHUNK_SIZE = 16384; // 16KB chunks for WebRTC stability

    // Category Data
    const categories = {
        documents: {
            title: 'Document Verification',
            desc: 'Securely hash and timestamp your important documents on the Cheese Blockchain.',
            dropText: 'document',
            accept: '.pdf,.doc,.docx,.txt'
        },
        pictures: {
            title: 'Picture Verification',
            desc: 'Protect your visual assets. Stamp images immutably on the blockchain.',
            dropText: 'picture',
            accept: 'image/*'
        },
        audio: {
            title: 'Audio Verification',
            desc: 'Secure copyright claims for your music and audio recordings.',
            dropText: 'audio file',
            accept: 'audio/*'
        },
        videos: {
            title: 'Video Verification',
            desc: 'Timestamp your video content to establish undeniable proof of creation.',
            dropText: 'video',
            accept: 'video/*'
        }
    };

    let currentCategory = 'documents';

    /** Show one main step: upload | processing | result | p2p-send | p2p-receive */
    function setViewState(state) {
        const panels = {
            upload: uploadSection,
            processing: processingArea,
            result: resultArea,
            'p2p-send': p2pTransferArea,
            'p2p-receive': p2pReceiverArea
        };
        Object.entries(panels).forEach(([key, el]) => {
            if (!el) return;
            const active = key === state;
            el.classList.toggle('hidden', !active);
            if (active) {
                el.style.display = key === 'upload' || key === 'processing' ? 'flex' : 'block';
            } else {
                el.style.display = 'none';
            }
        });
        if (state === 'upload') {
            if (onPageInstructions) onPageInstructions.style.display = '';
            if (historySection) {
                historySection.classList.remove('hidden');
                historySection.style.display = 'block';
                renderHistory();
            }
        } else {
            if (onPageInstructions) onPageInstructions.style.display = 'none';
            if (historySection) {
                historySection.classList.add('hidden');
                historySection.style.display = 'none';
            }
        }
    }

    const onPageInstructions = document.querySelector('.on-page-instructions');
    const stampStatusNote = document.getElementById('stampStatusNote');
    const viewExplorerBtn = document.getElementById('viewExplorerBtn');
    const verifyStampBtn = document.getElementById('verifyStampBtn');

    setViewState('upload');

    // --- Navigation & Basic UI ---
    navLinks.forEach(link => {
        if (link) link.addEventListener('click', () => {
            navLinks.forEach(l => l.classList.remove('active'));
            link.classList.add('active');

            currentCategory = link.getAttribute('data-category');
            const data = categories[currentCategory];
            
            categoryTitle.textContent = data.title;
            categoryDesc.textContent = data.desc;
            dropCategory.textContent = data.dropText;
            fileInput.setAttribute('accept', data.accept);

            resetUI();
        });
    });

    ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => {
        if (dropzone) dropzone.addEventListener(eventName, preventDefaults, false);
    });

    function preventDefaults(e) { e.preventDefault(); e.stopPropagation(); }

    ['dragenter', 'dragover'].forEach(eventName => {
        if (dropzone) dropzone.addEventListener(eventName, () => dropzone.classList.add('dragover'), false);
    });

    ['dragleave', 'drop'].forEach(eventName => {
        if (dropzone) dropzone.addEventListener(eventName, () => dropzone.classList.remove('dragover'), false);
    });

    if (dropzone) dropzone.addEventListener('drop', e => {
        const files = e.dataTransfer.files;
        if (files.length > 0) processFile(files[0]);
    });

    if (dropzone) dropzone.addEventListener('click', () => fileInput.click());
    if (fileInput) fileInput.addEventListener('change', function() {
        if (this.files.length > 0) processFile(this.files[0]);
    });

    // --- Core Processing Logic ---
    async function processFile(file) {
        if (!file) return;
        currentFile = file;
        console.log('📄 Processing file:', file.name, 'Size:', file.size);
        
        setViewState('processing');

        try {
            // 1. Calculate SHA-256 Hash locally
            console.log('🔐 Starting hash calculation...');
            currentHash = await calculateSHA256(file);
            console.log('🔑 Local Hash Generated:', currentHash);

            // Add immediately to local history as 'hash-only'
            addHistoryEntry(currentHash, file.name, file.size, currentCategory, '', 'hash-only');

            // 2. Query Blockchain API to check if it's already stamped
            console.log('📡 Checking if hash already exists on blockchain...');
            let isDuplicate = false;
            let existingTx = null;

            try {
                const verifyRes = await fetch(`${window.location.origin}/api/notary/verify?q=${encodeURIComponent(currentHash)}`);
                const verifyData = await verifyRes.json();
                
                if (verifyRes.ok && verifyData.success && verifyData.verified) {
                    isDuplicate = true;
                    existingTx = verifyData.transaction || {};
                    console.log('⚠️ Duplicate Hash Found on Blockchain:', existingTx);
                }
            } catch (verifyErr) {
                console.warn('⚠️ Verification check failed (could be offline or 404), proceeding with normal stamping:', verifyErr);
            }

            if (isDuplicate && existingTx) {
                // If it's a duplicate, do NOT stamp again! Load existing details instead
                currentTxId = existingTx.id || '';
                const when = existingTx.timestamp;
                
                // Update history with confirmed status
                addHistoryEntry(currentHash, file.name, file.size, currentCategory, currentTxId, 'confirmed');

                // Update UI for duplicate state
                hashValue.textContent = currentHash;
                txValue.textContent = currentTxId || '—';

                if (duplicateAlert) duplicateAlert.classList.remove('hidden');
                if (resultIcon) {
                    resultIcon.className = 'success-icon';
                    resultIcon.innerHTML = '<i class="fa-solid fa-circle-exclamation" style="color: var(--cheese-gold);"></i>';
                }
                if (resultTitle) {
                    resultTitle.textContent = 'Document Already Registered';
                }
                if (stampStatusNote) {
                    const formattedDate = when ? new Date(when).toLocaleString() : 'previously';
                    stampStatusNote.innerHTML = `This file's hash footprint was already notarized on the Cheese Blockchain on <strong>${formattedDate}</strong>.<br>No new transaction was created to avoid duplicate registration.`;
                }

                if (viewExplorerBtn && currentTxId) {
                    viewExplorerBtn.href = `/explorer/?tx=${encodeURIComponent(currentTxId)}`;
                }

                setViewState('result');

                if (sendChoiceArea) sendChoiceArea.classList.add('hidden');
                if (p2pMethodForm) p2pMethodForm.classList.add('hidden');
                if (traditionalMethodForm) traditionalMethodForm.classList.add('hidden');
                if (hashAndSendBtn) hashAndSendBtn.style.display = 'block';
                if (hashOnlyBtn) hashOnlyBtn.style.display = 'block';
                return;
            }

            // 3. Submit to Cheese Blockchain API (Not a duplicate, stamp it!)
            console.log('📡 Sending to blockchain API for stamping...');
            const response = await fetch(window.location.origin + '/api/notary/stamp', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    hash: currentHash,
                    fileName: file.name,
                    category: currentCategory
                })
            });

            console.log('📡 API Response status:', response.status);
            const result = await response.json();
            console.log('📡 API Response:', result);

            if (result.success) {
                const tx = result.transaction || {};
                currentTxId = result.txid || tx.id || '';
                console.log('✅ Blockchain Stamp Successful:', currentTxId);

                // Update history item status to pending / stamped
                const newStatus = result.status === 'pending' ? 'pending' : 'confirmed';
                addHistoryEntry(currentHash, file.name, file.size, currentCategory, currentTxId, newStatus);

                hashValue.textContent = currentHash;
                txValue.textContent = currentTxId || '—';

                // Reset standard UI state
                if (duplicateAlert) duplicateAlert.classList.add('hidden');
                if (resultIcon) {
                    resultIcon.className = 'success-icon';
                    resultIcon.innerHTML = '<i class="fa-solid fa-check-circle"></i>';
                }
                if (resultTitle) {
                    resultTitle.textContent = 'Successfully Stamped!';
                }

                if (stampStatusNote) {
                    stampStatusNote.textContent = result.message ||
                        (result.status === 'pending'
                            ? 'Stamp submitted. It will appear in the explorer after the next block is mined.'
                            : 'Your file hash is recorded on the Cheese Blockchain.');
                }

                if (viewExplorerBtn && currentTxId) {
                    viewExplorerBtn.href = result.explorerUrl || `/explorer/?tx=${encodeURIComponent(currentTxId)}`;
                }

                setViewState('result');

                if (sendChoiceArea) sendChoiceArea.classList.add('hidden');
                if (p2pMethodForm) p2pMethodForm.classList.add('hidden');
                if (traditionalMethodForm) traditionalMethodForm.classList.add('hidden');
                if (hashAndSendBtn) hashAndSendBtn.style.display = 'block';
                if (hashOnlyBtn) hashOnlyBtn.style.display = 'block';
            } else {
                throw new Error(result.error || 'Blockchain rejection');
            }
        } catch (err) {
            console.error('❌ Processing failed:', err);
            
            let errorMsg = 'Error processing file: ';
            if (err.message.includes('hash') || err.message.includes('crypto')) {
                errorMsg = 'Cannot hash file - ' + err.message;
            } else if (err.message.includes('network') || err.message.includes('fetch')) {
                errorMsg = 'Network error - ' + err.message;
            } else {
                errorMsg += err.message;
            }

            alert(errorMsg + '\n\nPlease check browser console (F12) for details.');
            resetUI();
        }
    }

    function resetUI() {
        setViewState('upload');
        if (sendChoiceArea) sendChoiceArea.classList.add('hidden');
        if (p2pMethodForm) p2pMethodForm.classList.add('hidden');
        if (traditionalMethodForm) traditionalMethodForm.classList.add('hidden');
        fileInput.value = '';
        if (p2pReceiverAddress) p2pReceiverAddress.value = '';
        if (traditionalRecipient) traditionalRecipient.value = '';
        currentFile = null;
        currentHash = '';
        currentTxId = '';
        if (socket) socket.close();
        if (peerConnection) peerConnection.close();
        
        // Reset button visibility
        if (hashAndSendBtn) hashAndSendBtn.style.display = 'block';
        if (hashOnlyBtn) hashOnlyBtn.style.display = 'block';
    }

    // Improved SHA-256 calculation with better error handling
    async function calculateSHA256(file) {
        console.log('🔧 Starting hash calculation, file size:', file.size);

        // Check if crypto.subtle is available
        if (!window.crypto || !window.crypto.subtle) {
            throw new Error('Web Crypto API not available. Please use a modern browser over HTTPS.');
        }

        if (file.size === 0) {
            throw new Error('File is empty');
        }

        try {
            // For smaller files, use direct arrayBuffer approach (simpler and more reliable)
            if (file.size < 10 * 1024 * 1024) { // 10MB threshold
                console.log('📦 Using direct arrayBuffer for smaller file');
                const arrayBuffer = await file.arrayBuffer();
                const hashBuffer = await window.crypto.subtle.digest('SHA-256', arrayBuffer);
                const hashArray = Array.from(new Uint8Array(hashBuffer));
                return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
            }

            // For larger files, use chunked reading
            console.log('📦 Using chunked hashing for larger file');
            const CHUNK_SIZE = 2 * 1024 * 1024; // 2MB chunks
            const chunks = [];

            for (let offset = 0; offset < file.size; offset += CHUNK_SIZE) {
                const chunk = file.slice(offset, offset + CHUNK_SIZE);
                const arrayBuffer = await chunk.arrayBuffer();
                chunks.push(arrayBuffer);
                console.log(`📦 Processed chunk ${offset / CHUNK_SIZE + 1}, total: ${Math.min(offset + CHUNK_SIZE, file.size)}/${file.size}`);
            }

            // Combine all chunks and hash
            const totalBuffer = new Uint8Array(file.size);
            let position = 0;
            for (const chunk of chunks) {
                totalBuffer.set(new Uint8Array(chunk), position);
                position += chunk.byteLength;
            }

            const hashBuffer = await window.crypto.subtle.digest('SHA-256', totalBuffer.buffer);
            const hashArray = Array.from(new Uint8Array(hashBuffer));
            return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');

        } catch (error) {
            console.error('❌ Hash calculation failed:', error);
            throw new Error('Failed to calculate file hash: ' + error.message);
        }
    }

    if (resetBtn) resetBtn.addEventListener('click', resetUI);

    if (verifyStampBtn) {
        verifyStampBtn.addEventListener('click', () => {
            if (hashSearch && currentHash) {
                hashSearch.value = currentHash;
                performSearch();
            }
        });
    }

    // --- WebRTC Signaling & P2P Logic ---

    // --- Copy Buttons ---
    if (copyHashBtn) if (copyHashBtn) copyHashBtn.addEventListener('click', () => {
        navigator.clipboard.writeText(currentHash);
        copyHashBtn.textContent = 'Copied!';
        setTimeout(() => copyHashBtn.textContent = 'Copy Hash', 2000);
    });

    if (copyTxBtn) if (copyTxBtn) copyTxBtn.addEventListener('click', () => {
        navigator.clipboard.writeText(currentTxId);
        copyTxBtn.textContent = 'Copied!';
        setTimeout(() => copyTxBtn.textContent = 'Copy Transaction ID', 2000);
    });

    // --- First Level Choice Buttons ---
    if (hashOnlyBtn) if (hashOnlyBtn) hashOnlyBtn.addEventListener('click', () => {
        console.log('📋 Hash Only - Copy hash to clipboard');
        navigator.clipboard.writeText(currentHash);
        alert(`Hash copied to clipboard!\n\nHash: ${currentHash}\nTransaction ID: ${currentTxId}\n\nYou can now share this hash as proof of your file's integrity.`);
    });

    if (hashAndSendBtn) if (hashAndSendBtn) hashAndSendBtn.addEventListener('click', () => {
        console.log('📤 Hash & Send - Show sending method choices');
        sendChoiceArea.classList.remove('hidden');
        hashAndSendBtn.style.display = 'none';
        hashOnlyBtn.style.display = 'none';
    });

    // --- Global functions for HTML onclick ---
    window.showP2PMethod = function() {
        sendChoiceArea.classList.add('hidden');
        p2pMethodForm.classList.remove('hidden');
    };

    window.showTraditionalMethod = function() {
        sendChoiceArea.classList.add('hidden');
        traditionalMethodForm.classList.remove('hidden');
    };

    // --- Back Buttons ---
    if (backToMethodsBtn) if (backToMethodsBtn) backToMethodsBtn.addEventListener('click', () => {
        p2pMethodForm.classList.add('hidden');
        sendChoiceArea.classList.remove('hidden');
    });

    if (backToMethodsBtn2) if (backToMethodsBtn2) backToMethodsBtn2.addEventListener('click', () => {
        traditionalMethodForm.classList.add('hidden');
        sendChoiceArea.classList.remove('hidden');
    });

    // --- P2P Send Button (with blockchain address) ---
    if (sendP2PBtn) if (sendP2PBtn) sendP2PBtn.addEventListener('click', async () => {
        const receiverAddress = p2pReceiverAddress.value.trim();

        if (!receiverAddress) {
            alert('Please enter a receiver blockchain address.');
            return;
        }

        if (!receiverAddress.startsWith('0x') || receiverAddress.length !== 42) {
            alert('Please enter a valid blockchain address (0x...)');
            return;
        }

        if (currentFile && currentFile.isMock) {
            alert('To transfer the actual file directly via peer-to-peer connection, please drag & drop or select the file from your computer again so that the WebRTC engine can read it in memory. If you only want to share the blockchain verification proof, please use the Traditional method.');
            return;
        }

        console.log('📤 Sending file + hash via P2P to:', receiverAddress);

        // First, record the send on blockchain
        try {
            const response = await fetch(window.location.origin + '/api/notary/send', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    hash: currentHash,
                    fileName: currentFile.name,
                    receiverAddress: receiverAddress,
                    originalTxId: currentTxId,
                    sendMethod: 'p2p'
                })
            });

            const result = await response.json();

            if (result.success) {
                console.log('✅ Blockchain send recorded:', result.sendTxid);

                // Then start P2P file transfer
                roomId = Math.random().toString(36).substr(2, 9);
                const baseUrl = window.location.origin + window.location.pathname;
                const shareLink = `${baseUrl}?room=${roomId}&hash=${currentHash}&name=${encodeURIComponent(currentFile.name)}&size=${currentFile.size}&receiver=${receiverAddress}`;

                p2pLinkInput.value = shareLink;
                console.log('🔗 Generated P2P Link:', shareLink);

                if (p2pMethodForm) p2pMethodForm.classList.add('hidden');
                setViewState('p2p-send');

                initSender(roomId);
            } else {
                throw new Error(result.error || 'Failed to record send on blockchain');
            }
        } catch (error) {
            console.error('❌ P2P Send failed:', error);
            alert('Failed to initiate P2P transfer: ' + error.message);
        }
    });

    // --- Traditional Send Button (hash only) ---
    if (sendTraditionalBtn) if (sendTraditionalBtn) sendTraditionalBtn.addEventListener('click', () => {
        const platform = traditionalPlatform.value;
        const recipient = traditionalRecipient.value.trim();

        if (!recipient) {
            alert('Please enter a recipient.');
            return;
        }

        const message = `I've stamped a file on the Cheese Blockchain!\n\nFile: ${currentFile.name}\nHash: ${currentHash}\nTransaction ID: ${currentTxId}\n\nYou can verify this file's integrity using the hash above.`;

        let url = '';

        switch(platform) {
            case 'whatsapp':
                url = `https://wa.me/?text=${encodeURIComponent(message)}`;
                break;
            case 'telegram':
                url = `https://t.me/share/url?url=${encodeURIComponent(window.location.href)}&text=${encodeURIComponent(message)}`;
                break;
            case 'email':
                url = `mailto:${recipient}?subject=Blockchain Stamped File&body=${encodeURIComponent(message)}`;
                break;
            case 'messenger':
                url = `https://www.facebook.com/dialog/send?link=${encodeURIComponent(window.location.href)}&quote=${encodeURIComponent(message)}`;
                break;
            case 'twitter':
                url = `https://twitter.com/intent/tweet?text=${encodeURIComponent(message)}`;
                break;
            case 'copy':
                navigator.clipboard.writeText(message);
                alert('Message copied to clipboard! You can now paste it anywhere.');
                return;
            default:
                url = '';
        }

        if (url) {
            window.open(url, '_blank');
            alert(`Opening ${platform}... You can send the hash and transaction ID to verify the file's integrity.`);
        }
    });

    // --- Original P2P Share Button (kept for compatibility) ---
    if (shareP2PBtn) shareP2PBtn.addEventListener('click', () => {
        console.log('📡 Share P2P Clicked');
        if (!currentFile || !currentHash) {
            console.error('❌ Cannot share: File or Hash missing');
            alert('Please wait for the file to be stamped first.');
            return;
        }

        roomId = Math.random().toString(36).substr(2, 9);
        const baseUrl = window.location.origin + window.location.pathname;
        const shareLink = `${baseUrl}?room=${roomId}&hash=${currentHash}&name=${encodeURIComponent(currentFile.name)}&size=${currentFile.size}`;
        
        p2pLinkInput.value = shareLink;
        console.log('🔗 Generated P2P Link:', shareLink);
        
        setViewState('p2p-send');
        initSender(roomId);
    });

    function initSender(rid) {
        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        socket = new WebSocket(`${protocol}//${window.location.host}/notary-signaling?room=${rid}`);

        let candidateQueue = [];

        socket.onmessage = async (event) => {
            const data = JSON.parse(event.data);

            if (data.answer) {
                await peerConnection.setRemoteDescription(new RTCSessionDescription(data.answer));
                for (const candidate of candidateQueue) {
                    await peerConnection.addIceCandidate(candidate).catch(e => console.warn('Delayed candidate failed:', e));
                }
                candidateQueue = [];
            } else if (data.candidate) {
                const iceCandidate = new RTCIceCandidate(data.candidate);
                if (peerConnection && peerConnection.remoteDescription) {
                    await peerConnection.addIceCandidate(iceCandidate).catch(e => console.warn('Add candidate failed:', e));
                } else {
                    candidateQueue.push(iceCandidate);
                }
            } else if (data.ready) {
                // Receiver is ready, initiate connection
                createPeerConnection(rid);
                const offer = await peerConnection.createOffer();
                await peerConnection.setLocalDescription(offer);
                socket.send(JSON.stringify({ offer }));
            }
        };
    }

    function createPeerConnection(rid) {
        const config = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] };
        peerConnection = new RTCPeerConnection(config);

        peerConnection.onicecandidate = (event) => {
            if (event.candidate) {
                socket.send(JSON.stringify({ candidate: event.candidate }));
            }
        };

        dataChannel = peerConnection.createDataChannel('fileTransfer', { ordered: true });
        
        dataChannel.onopen = () => {
            transferStatusText.textContent = 'Connection Established! Sending file...';
            transferSpinner.classList.add('hidden');
            progressBarContainer.classList.remove('hidden');
            sendFile();
        };
    }

    async function sendFile() {
        const buffer = await currentFile.arrayBuffer();
        let offset = 0;

        const sendNextChunk = () => {
            while (offset < buffer.byteLength) {
                if (dataChannel.bufferedAmount > dataChannel.bufferedAmountLowThreshold) {
                    dataChannel.onbufferedamountlow = () => {
                        dataChannel.onbufferedamountlow = null;
                        sendNextChunk();
                    };
                    return;
                }
                
                const chunk = buffer.slice(offset, offset + CHUNK_SIZE);
                dataChannel.send(chunk);
                offset += CHUNK_SIZE;
                
                const percent = Math.min((offset / buffer.byteLength) * 100, 100);
                progressBar.style.width = percent + '%';
            }
            
            dataChannel.send('DONE');
            transferStatusText.innerHTML = '<span style="color: #10b981;">Transfer Complete!</span>';
        };

        sendNextChunk();
    }

    // --- Receiver Logic ---
    const urlParams = new URLSearchParams(window.location.search);
    const joinRoomId = urlParams.get('room');
    
    if (joinRoomId) {
        const rName = urlParams.get('name');
        const rSize = urlParams.get('size');
        const rHash = urlParams.get('hash');

        setViewState('p2p-receive');
        incomingFileName.textContent = rName;
        incomingFileSize.textContent = (rSize / 1024 / 1024).toFixed(2) + ' MB';
        incomingFileHash.textContent = rHash;

        initReceiver(joinRoomId, rHash);
    }

    function initReceiver(rid, expectedHash) {
        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        socket = new WebSocket(`${protocol}//${window.location.host}/notary-signaling?room=${rid}`);

        const config = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] };
        peerConnection = new RTCPeerConnection(config);
        let receivedChunks = [];
        let receivedSize = 0;
        let candidateQueue = [];

        peerConnection.onicecandidate = (event) => {
            if (event.candidate) {
                socket.send(JSON.stringify({ candidate: event.candidate }));
            }
        };

        peerConnection.ondatachannel = (event) => {
            const channel = event.channel;
            channel.onopen = () => {
                receiverStatusText.textContent = 'Transferring file directly from sender...';
                receiverSpinner.classList.add('hidden');
                receiverProgressBarContainer.classList.remove('hidden');
            };

            channel.onmessage = async (e) => {
                if (e.data === 'DONE') {
                    const blob = new Blob(receivedChunks);
                    verifyAndPrepareDownload(blob, expectedHash);
                } else {
                    receivedChunks.push(e.data);
                    receivedSize += e.data.byteLength;
                    const totalSize = parseInt(urlParams.get('size'));
                    const percent = Math.min((receivedSize / totalSize) * 100, 100);
                    receiverProgressBar.style.width = percent + '%';
                }
            };
        };

        socket.onopen = () => socket.send(JSON.stringify({ ready: true }));

        socket.onmessage = async (event) => {
            const data = JSON.parse(event.data);
            if (data.offer) {
                await peerConnection.setRemoteDescription(new RTCSessionDescription(data.offer));
                const answer = await peerConnection.createAnswer();
                await peerConnection.setLocalDescription(answer);
                socket.send(JSON.stringify({ answer }));
                for (const candidate of candidateQueue) {
                    await peerConnection.addIceCandidate(candidate).catch(e => console.warn('Delayed candidate failed:', e));
                }
                candidateQueue = [];
            } else if (data.candidate) {
                const iceCandidate = new RTCIceCandidate(data.candidate);
                if (peerConnection && peerConnection.remoteDescription) {
                    await peerConnection.addIceCandidate(iceCandidate).catch(e => console.warn('Add candidate failed:', e));
                } else {
                    candidateQueue.push(iceCandidate);
                }
            }
        };
    }

    async function verifyAndPrepareDownload(blob, expectedHash) {
        receiverStatusText.textContent = 'Verifying with Cheese Blockchain...';
        
        const arrayBuffer = await blob.arrayBuffer();
        const hashBuffer = await crypto.subtle.digest('SHA-256', arrayBuffer);
        const hashArray = Array.from(new Uint8Array(hashBuffer));
        const actualHash = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');

        if (actualHash === expectedHash) {
            receiverStatusText.innerHTML = '<span style="color: #10b981;">Integrity Verified!</span>';
            receiverProgressBarContainer.classList.add('hidden');
            receiverDownloadBox.classList.remove('hidden');

            // Save verified file to receiver's local history as well!
            const rName = urlParams.get('name') || 'received_file';
            const rSize = parseInt(urlParams.get('size')) || blob.size;
            addHistoryEntry(actualHash, rName, rSize, 'documents', '', 'confirmed');

            // Attempt to retrieve the block txid in the background
            try {
                fetch(`${window.location.origin}/api/notary/verify?q=${actualHash}`)
                    .then(res => res.json())
                    .then(data => {
                        if (data.success && data.verified && data.transaction) {
                            addHistoryEntry(actualHash, rName, rSize, 'documents', data.transaction.id, 'confirmed');
                        }
                    }).catch(() => {});
            } catch (e) {}
            
            downloadReceivedBtn.onclick = () => {
                const url = window.URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = urlParams.get('name');
                a.click();
            };
        } else {
            receiverStatusText.innerHTML = '<span style="color: #ef4444;">Verification Failed! File may be tampered.</span>';
        }
    }

    // --- Search & Copy ---
    if (copyLinkBtn) copyLinkBtn.addEventListener('click', () => {
        p2pLinkInput.select();
        document.execCommand('copy');
        copyLinkBtn.textContent = 'Copied!';
        setTimeout(() => copyLinkBtn.textContent = 'Copy', 2000);
    });

    if (cancelP2PBtn) cancelP2PBtn.addEventListener('click', resetUI);

    // Existing Search Logic
    const hashSearch = document.getElementById('hashSearch');
    const searchBtn = document.getElementById('searchBtn');
    const searchResultModal = document.getElementById('searchResultModal');
    const searchResultContent = document.getElementById('searchResultContent');
    const searchCloseBtn = document.querySelector('.search-close-btn');

    async function performSearch() {
        const query = hashSearch.value.trim();
        if (!query) return;

        searchResultModal.classList.add('show');
        searchResultContent.innerHTML = `
            <div class="processing-area" style="padding: 2rem 0; text-align: center;">
                <div class="spinner" style="margin: 0 auto 1.5rem auto;"></div>
                <h3 style="margin-bottom: 0.5rem; color: var(--text-main);">Verifying...</h3>
                <p style="color: var(--text-muted);">Querying the Cheese Blockchain.</p>
            </div>
        `;

        try {
            const res = await fetch(`${window.location.origin}/api/notary/verify?q=${encodeURIComponent(query)}`);
            const data = await res.json();

            if (res.ok && data.success && data.verified) {
                const tx = data.transaction || {};
                const when = tx.timestamp ? new Date(tx.timestamp).toLocaleString() : '—';
                const statusLabel = data.status === 'pending' ? 'Pending (in mempool)' : 'Confirmed on chain';
                const statusColor = data.status === 'pending' ? '#f59e0b' : '#10b981';
                searchResultContent.innerHTML = `
                    <div class="verification-success">
                        <i class="fa-solid fa-circle-check icon"></i>
                        <h3 style="color: var(--text-main); margin-bottom: 0.5rem;">Verification Successful!</h3>
                        <p style="color: var(--text-muted);">This notary record exists on the Cheese Blockchain.</p>
                        <div class="result-details">
                            <p><strong>Status:</strong> <span style="color: ${statusColor};">${statusLabel}</span></p>
                            <p><strong>File:</strong> <span>${tx.fileName || '—'}</span></p>
                            <p><strong>Document Hash:</strong> <span style="word-break: break-all; font-family: monospace; font-size: 0.85rem;">${tx.hash || '—'}</span></p>
                            <p><strong>Transaction ID:</strong> <span style="word-break: break-all; font-family: monospace; font-size: 0.85rem;">${tx.id || '—'}</span></p>
                            <p><strong>Timestamp:</strong> <span>${when}</span></p>
                            ${data.blockIndex != null ? `<p><strong>Block:</strong> <span>#${data.blockIndex}</span></p>` : ''}
                        </div>
                        ${tx.id ? `<a href="/explorer/?tx=${encodeURIComponent(tx.id)}" target="_blank" rel="noopener" class="btn-primary btn-small" style="display:inline-block;margin-top:1rem;text-decoration:none;">Open in Explorer</a>` : ''}
                    </div>
                `;
            } else {
                searchResultContent.innerHTML = `
                    <div class="verification-error">
                        <i class="fa-solid fa-circle-xmark icon"></i>
                        <h3 style="color: var(--text-main); margin-bottom: 0.5rem;">Record Not Found</h3>
                        <p style="color: var(--text-muted);">${data.error || 'No matching document hash or transaction ID was found. If you just stamped, wait for the next block or search by transaction ID.'}</p>
                    </div>
                `;
            }
        } catch (err) {
            console.error('Verify search failed:', err);
            searchResultContent.innerHTML = `
                <div class="verification-error">
                    <i class="fa-solid fa-circle-xmark icon"></i>
                    <h3 style="color: var(--text-main); margin-bottom: 0.5rem;">Verification Error</h3>
                    <p style="color: var(--text-muted);">Could not reach the blockchain API. Try again or use the <a href="/explorer/" style="color: var(--cheese-gold);">Explorer</a>.</p>
                </div>
            `;
        }
    }

    if (searchBtn) searchBtn.addEventListener('click', performSearch);
    if (hashSearch) hashSearch.addEventListener('keypress', e => e.key === 'Enter' && performSearch());
    if (searchCloseBtn) searchCloseBtn.addEventListener('click', () => searchResultModal.classList.remove('show'));
    if (searchResultModal) searchResultModal.addEventListener('click', e => e.target === searchResultModal && searchResultModal.classList.remove('show'));

    // --- Local History Management ---
    function loadHistory() {
        try {
            const data = localStorage.getItem('cheese_notary_history');
            return data ? JSON.parse(data) : [];
        } catch (e) {
            console.error('Failed to load history:', e);
            return [];
        }
    }

    function saveHistory(history) {
        try {
            localStorage.setItem('cheese_notary_history', JSON.stringify(history));
        } catch (e) {
            console.error('Failed to save history:', e);
        }
    }

    function addHistoryEntry(hash, fileName, fileSize, category, txid = '', status = 'hash-only') {
        let history = loadHistory();
        // Remove existing item with same hash if exists
        history = history.filter(item => item.hash !== hash);
        // Prepend new item
        history.unshift({
            hash,
            fileName,
            fileSize,
            category,
            txid,
            timestamp: Date.now(),
            status
        });
        // Limit to 50 items
        if (history.length > 50) {
            history = history.slice(0, 50);
        }
        saveHistory(history);
        renderHistory();
    }

    function deleteHistoryEntry(hash) {
        let history = loadHistory();
        history = history.filter(item => item.hash !== hash);
        saveHistory(history);
        renderHistory();
    }

    function clearAllHistory() {
        if (confirm('Are you sure you want to clear your entire recent notarizations history? This cannot be undone.')) {
            saveHistory([]);
            renderHistory();
        }
    }

    function formatBytes(bytes, decimals = 2) {
        if (!bytes || bytes === 0) return '0 Bytes';
        const k = 1024;
        const dm = decimals < 0 ? 0 : decimals;
        const sizes = ['Bytes', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
    }

    function renderHistory() {
        if (!historyList) return;
        const history = loadHistory();
        
        if (history.length === 0) {
            historyList.innerHTML = `
                <div class="history-empty">
                    <i class="fa-solid fa-folder-open" style="font-size: 1.5rem; margin-bottom: 0.5rem; display: block; color: var(--text-muted);"></i>
                    No recent notarizations found. Documents hashed or stamped will appear here.
                </div>
            `;
            return;
        }

        const categoryIcons = {
            documents: 'fa-file-lines',
            pictures: 'fa-file-image',
            audio: 'fa-file-audio',
            videos: 'fa-file-video'
        };

        historyList.innerHTML = history.map(item => {
            const icon = categoryIcons[item.category] || 'fa-file';
            const sizeStr = formatBytes(item.fileSize);
            const dateStr = new Date(item.timestamp).toLocaleString();
            
            let badgeClass = 'hash-only';
            let badgeText = 'Hash Only';
            if (item.status === 'confirmed') {
                badgeClass = 'confirmed';
                badgeText = 'Stamped';
            } else if (item.status === 'pending') {
                badgeClass = 'pending';
                badgeText = 'Pending';
            }

            return `
                <div class="history-item" data-hash="${item.hash}">
                    <div class="history-item-left">
                        <div class="history-item-icon">
                            <i class="fa-solid ${icon}"></i>
                        </div>
                        <div class="history-item-details">
                            <div class="history-item-name" title="${item.fileName}">${item.fileName}</div>
                            <div class="history-item-meta">
                                <span><i class="fa-solid fa-database"></i> ${sizeStr}</span>
                                <span><i class="fa-solid fa-clock"></i> ${dateStr}</span>
                                <span class="meta-hash" title="Copy Hash: ${item.hash}" data-hash="${item.hash}"><i class="fa-solid fa-hashtag"></i> ${item.hash.substring(0, 8)}...${item.hash.substring(item.hash.length - 8)}</span>
                            </div>
                        </div>
                    </div>
                    <div style="margin: 0 1rem;">
                        <span class="status-badge ${badgeClass}">${badgeText}</span>
                    </div>
                    <div class="history-item-actions">
                        <button type="button" class="history-btn copy-hash-btn" title="Copy Hash" data-hash="${item.hash}"><i class="fa-solid fa-hashtag"></i></button>
                        ${item.txid ? `
                            <button type="button" class="history-btn copy-tx-btn" title="Copy Transaction ID" data-tx="${item.txid}"><i class="fa-solid fa-receipt"></i></button>
                            <a href="/explorer/?tx=${item.txid}" target="_blank" rel="noopener" class="history-btn explorer-btn" title="View in Explorer"><i class="fa-solid fa-arrow-up-right-from-square"></i></a>
                        ` : ''}
                        <button type="button" class="history-btn share-btn" title="Send / Share Proof" data-hash="${item.hash}"><i class="fa-solid fa-share-nodes"></i></button>
                        <button type="button" class="history-btn delete-btn" title="Remove from History" data-hash="${item.hash}"><i class="fa-solid fa-trash"></i></button>
                    </div>
                </div>
            `;
        }).join('');
    }

    // Event delegation for history items
    if (historyList) {
        historyList.addEventListener('click', async (e) => {
            const target = e.target;
            
            const copyHashBtn = target.closest('.copy-hash-btn');
            const copyTxBtn = target.closest('.copy-tx-btn');
            const deleteBtn = target.closest('.delete-btn');
            const shareBtn = target.closest('.share-btn');
            const hashSpan = target.closest('.meta-hash');
            
            if (copyHashBtn || hashSpan) {
                const hash = (copyHashBtn || hashSpan).getAttribute('data-hash');
                navigator.clipboard.writeText(hash);
                alert('Hash copied to clipboard!');
            } else if (copyTxBtn) {
                const tx = copyTxBtn.getAttribute('data-tx');
                navigator.clipboard.writeText(tx);
                alert('Transaction ID copied to clipboard!');
            } else if (deleteBtn) {
                const hash = deleteBtn.getAttribute('data-hash');
                if (confirm('Remove this item from history?')) {
                    deleteHistoryEntry(hash);
                }
            } else if (shareBtn) {
                const hash = shareBtn.getAttribute('data-hash');
                const history = loadHistory();
                const item = history.find(i => i.hash === hash);
                if (item) {
                    console.log('📋 Loading history item to share:', item);
                    currentHash = item.hash;
                    currentTxId = item.txid || '';
                    currentCategory = item.category;
                    currentFile = { 
                        name: item.fileName, 
                        size: item.fileSize, 
                        isMock: true 
                    };
                    
                    // Populate results screen
                    hashValue.textContent = currentHash;
                    txValue.textContent = currentTxId || '—';
                    if (viewExplorerBtn && currentTxId) {
                        viewExplorerBtn.href = `/explorer/?tx=${encodeURIComponent(currentTxId)}`;
                    } else if (viewExplorerBtn) {
                        viewExplorerBtn.href = '#';
                    }
                    
                    // Reset styling to standard result
                    if (duplicateAlert) duplicateAlert.classList.add('hidden');
                    if (resultIcon) {
                        resultIcon.className = 'success-icon';
                        resultIcon.innerHTML = '<i class="fa-solid fa-check-circle"></i>';
                    }
                    if (resultTitle) {
                        resultTitle.textContent = item.txid ? 'Notarized Document' : 'Hashed Document';
                    }
                    if (stampStatusNote) {
                        stampStatusNote.textContent = item.txid 
                            ? 'This file\'s notarization record has been loaded from history.'
                            : 'This file\'s hash footprint has been loaded from history.';
                    }
                    
                    setViewState('result');
                    if (sendChoiceArea) sendChoiceArea.classList.remove('hidden');
                    if (hashAndSendBtn) hashAndSendBtn.style.display = 'none';
                    if (hashOnlyBtn) hashOnlyBtn.style.display = 'none';
                }
            }
        });
    }

    if (clearHistoryBtn) {
        clearHistoryBtn.addEventListener('click', clearAllHistory);
    }

    // Initial render of history
    renderHistory();
});

