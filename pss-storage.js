let multer;
try {
    multer = require('multer');
} catch (e) {
    console.warn('⚠️ Multer not installed on server, using fallback upload handler for PSS.');
}

const router = express.Router();
const VAULT_DIR = path.join(process.cwd(), 'pss_vault');
const TEMP_DIR = path.join(VAULT_DIR, 'temp');

// Ensure directories exist
if (!fs.existsSync(VAULT_DIR)) fs.mkdirSync(VAULT_DIR, { recursive: true });
if (!fs.existsSync(TEMP_DIR)) fs.mkdirSync(TEMP_DIR, { recursive: true });

// Setup multer for handling file uploads if available
const upload = multer ? multer({ dest: TEMP_DIR, limits: { fileSize: 50 * 1024 * 1024 } }) : null;

const uploadMiddleware = (req, res, next) => {
    if (upload) {
        return upload.single('pssFile')(req, res, next);
    }
    // Fallback if multer is missing
    next();
};

// POST /api/pss/upload - Receive physical file and save to PSS Vault
router.post('/upload', uploadMiddleware, (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ success: false, error: 'No file uploaded' });
        }

        const tempPath = req.file.path;
        
        // Calculate hash of the uploaded file to ensure integrity and for filename
        const fileBuffer = fs.readFileSync(tempPath);
        const hashHex = crypto.createHash('sha256').update(fileBuffer).digest('hex');
        
        // Use the hash as the filename to ensure it is perfectly correlated
        const finalFilename = `${hashHex}.dat`;
        const finalPath = path.join(VAULT_DIR, finalFilename);

        // Move file from temp to final destination
        // If it already exists, just delete temp, we already have it securely stored
        if (!fs.existsSync(finalPath)) {
            fs.renameSync(tempPath, finalPath);
        } else {
            fs.unlinkSync(tempPath);
        }

        res.json({
            success: true,
            message: 'File securely stored in Private Sovereign Storage (PSS) Vault',
            hash: hashHex,
            size: fileBuffer.length
        });
    } catch (error) {
        console.error('PSS Upload Error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// GET /api/pss/download/:hash - Retrieve physical file from PSS Vault
router.get('/download/:hash', (req, res) => {
    try {
        const hash = req.params.hash;
        
        // Basic sanitization - ensure it's a 64-character hex string (SHA-256)
        if (!/^[a-f0-9]{64}$/i.test(hash)) {
             return res.status(400).json({ success: false, error: 'Invalid Hash format' });
        }

        const filePath = path.join(VAULT_DIR, `${hash}.dat`);
        
        if (!fs.existsSync(filePath)) {
            return res.status(404).json({ success: false, error: 'File not found in isolated PSS Vault' });
        }

        // Send the file back to the client
        res.download(filePath, `PSS_Notarized_${hash.substring(0,8)}.dat`);
    } catch (error) {
        console.error('PSS Download Error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

module.exports = router;
