/**
 * CHEESE Blockchain - Rate Limiter
 * Protects against DoS and spam attacks
 * 
 * © 2025 Robert Terre. All Rights Reserved.
 */

const EventEmitter = require('events');

class RateLimiter extends EventEmitter {
    constructor(config = {}) {
        super();

        this.config = {
            // Connection rate limiting
            maxConnectionsPerIP: config.maxConnectionsPerIP || 5,
            connectionWindow: config.connectionWindow || 60000, // 1 minute

            // Message rate limiting
            maxMessagesPerSecond: config.maxMessagesPerSecond || 100,
            maxMessagesPerMinute: config.maxMessagesPerMinute || 1000,

            // Bandwidth limiting
            maxBytesPerSecond: config.maxBytesPerSecond || 1024 * 1024, // 1 MB/s

            // Penalty configuration
            banDuration: config.banDuration || 3600000, // 1 hour
            warningThreshold: config.warningThreshold || 3,

            ...config
        };

        // Connection tracking
        this.connectionAttempts = new Map(); // IP -> [timestamps]

        // Message tracking per peer
        this.messageRates = new Map(); // peerId -> { count, windowStart }

        // Bandwidth tracking
        this.bandwidthUsage = new Map(); // peerId -> { bytes, windowStart }

        // Warnings and bans
        this.warnings = new Map(); // peerId/IP -> count
        this.bans = new Map(); // IP -> expireTime

        console.log('🛡️ Rate Limiter initialized');
    }

    /**
     * Start rate limiter
     */
    async start() {
        // Clean up old entries periodically
        this.cleanupTimer = setInterval(() => {
            this.cleanup();
        }, 60000); // Every minute

        console.log('   Rate limiter active');
    }

    /**
     * Stop rate limiter
     */
    stop() {
        if (this.cleanupTimer) {
            clearInterval(this.cleanupTimer);
            this.cleanupTimer = null;
        }
    }

    /**
     * Check if connection is allowed
     */
    allowConnection(address) {
        // Check if banned
        if (this.isBanned(address)) {
            console.log(`   🚫 Connection blocked (banned): ${address}`);
            return false;
        }

        // Get connection attempts for this IP
        const now = Date.now();
        let attempts = this.connectionAttempts.get(address) || [];

        // Filter to recent attempts
        attempts = attempts.filter(t => now - t < this.config.connectionWindow);

        // Check if over limit
        if (attempts.length >= this.config.maxConnectionsPerIP) {
            this.addWarning(address);
            console.log(`   ⚠️ Connection rate limited: ${address}`);
            return false;
        }

        // Record this attempt
        attempts.push(now);
        this.connectionAttempts.set(address, attempts);

        return true;
    }

    /**
     * Check if message is allowed
     */
    allowMessage(peerId) {
        const now = Date.now();
        let rate = this.messageRates.get(peerId);

        if (!rate || now - rate.windowStart > 1000) {
            // New window
            rate = { count: 0, windowStart: now, minuteCount: 0, minuteStart: now };
        }

        // Check per-second limit
        if (now - rate.windowStart < 1000) {
            if (rate.count >= this.config.maxMessagesPerSecond) {
                this.addWarning(peerId);
                return false;
            }
            rate.count++;
        } else {
            // New second window
            rate.windowStart = now;
            rate.count = 1;
        }

        // Check per-minute limit
        if (now - rate.minuteStart < 60000) {
            if (rate.minuteCount >= this.config.maxMessagesPerMinute) {
                this.addWarning(peerId);
                return false;
            }
            rate.minuteCount++;
        } else {
            // New minute window
            rate.minuteStart = now;
            rate.minuteCount = 1;
        }

        this.messageRates.set(peerId, rate);
        return true;
    }

    /**
     * Check bandwidth usage
     */
    allowBandwidth(peerId, bytes) {
        const now = Date.now();
        let usage = this.bandwidthUsage.get(peerId);

        if (!usage || now - usage.windowStart > 1000) {
            // New window
            usage = { bytes: 0, windowStart: now };
        }

        if (now - usage.windowStart < 1000) {
            if (usage.bytes + bytes > this.config.maxBytesPerSecond) {
                this.addWarning(peerId);
                return false;
            }
            usage.bytes += bytes;
        } else {
            // New second window
            usage.windowStart = now;
            usage.bytes = bytes;
        }

        this.bandwidthUsage.set(peerId, usage);
        return true;
    }

    /**
     * Add warning to peer/IP
     */
    addWarning(id) {
        const warnings = (this.warnings.get(id) || 0) + 1;
        this.warnings.set(id, warnings);

        if (warnings >= this.config.warningThreshold) {
            this.ban(id);
        }
    }

    /**
     * Ban an IP/peer
     */
    ban(id) {
        const expireTime = Date.now() + this.config.banDuration;
        this.bans.set(id, expireTime);
        this.warnings.delete(id);

        console.log(`   🚫 BANNED: ${id} until ${new Date(expireTime).toISOString()}`);
        this.emit('banned', id);
    }

    /**
     * Check if banned
     */
    isBanned(id) {
        const expireTime = this.bans.get(id);
        if (!expireTime) return false;

        if (Date.now() > expireTime) {
            this.bans.delete(id);
            return false;
        }

        return true;
    }

    /**
     * Unban an IP/peer
     */
    unban(id) {
        this.bans.delete(id);
        this.warnings.delete(id);
        console.log(`   ✅ Unbanned: ${id}`);
    }

    /**
     * Reset limits for peer (on disconnect)
     */
    resetPeer(peerId) {
        this.messageRates.delete(peerId);
        this.bandwidthUsage.delete(peerId);
    }

    /**
     * Cleanup old entries
     */
    cleanup() {
        const now = Date.now();

        // Clean old connection attempts
        for (const [ip, attempts] of this.connectionAttempts) {
            const recent = attempts.filter(t => now - t < this.config.connectionWindow);
            if (recent.length === 0) {
                this.connectionAttempts.delete(ip);
            } else {
                this.connectionAttempts.set(ip, recent);
            }
        }

        // Clean expired bans
        for (const [id, expireTime] of this.bans) {
            if (now > expireTime) {
                this.bans.delete(id);
            }
        }

        // Clean old message rates
        for (const [peerId, rate] of this.messageRates) {
            if (now - rate.minuteStart > 120000) {
                this.messageRates.delete(peerId);
            }
        }

        // Clean old bandwidth usage
        for (const [peerId, usage] of this.bandwidthUsage) {
            if (now - usage.windowStart > 60000) {
                this.bandwidthUsage.delete(peerId);
            }
        }
    }

    /**
     * Get statistics
     */
    getStats() {
        return {
            trackedConnections: this.connectionAttempts.size,
            trackedPeers: this.messageRates.size,
            activeWarnings: this.warnings.size,
            activeBans: this.bans.size,
            bannedList: Array.from(this.bans.entries()).map(([id, expire]) => ({
                id,
                expiresAt: new Date(expire).toISOString()
            }))
        };
    }
}

module.exports = RateLimiter;
