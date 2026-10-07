const config = require('./config');

class RateLimiter {
  constructor() {
    // Map of userId -> Array of download timestamps (ms)
    this.userDownloads = new Map();

    // Run cleanup every 5 minutes to clear inactive users from memory
    setInterval(() => this.cleanup(), 5 * 60 * 1000);
  }

  /**
   * Filter and return timestamps within the configured rolling rate limit window.
   */
  _getValidTimestamps(userId) {
    const windowMs = config.RATE_LIMIT_MINUTES * 60 * 1000;
    const now = Date.now();
    const timestamps = this.userDownloads.get(userId) || [];
    return timestamps.filter((ts) => now - ts < windowMs);
  }

  /**
   * Check if user has reached maximum allowed downloads in window.
   * If MAX_DOWNLOADS_PER_USER is 0 or less, rate limiting is disabled (unlimited).
   * @param {string} userId
   * @returns {boolean}
   */
  isRateLimited(userId) {
    if (!config.MAX_DOWNLOADS_PER_USER || config.MAX_DOWNLOADS_PER_USER <= 0) {
      return false; // Unlimited mode
    }
    const validTimestamps = this._getValidTimestamps(userId);
    return validTimestamps.length >= config.MAX_DOWNLOADS_PER_USER;
  }

  /**
   * Record a download event for user.
   * @param {string} userId
   */
  addDownload(userId) {
    if (!config.MAX_DOWNLOADS_PER_USER || config.MAX_DOWNLOADS_PER_USER <= 0) {
      return; // No tracking needed in unlimited mode
    }
    const validTimestamps = this._getValidTimestamps(userId);
    validTimestamps.push(Date.now());
    this.userDownloads.set(userId, validTimestamps);
  }

  /**
   * Get minutes remaining until the user's oldest download in window expires.
   * @param {string} userId
   * @returns {number}
   */
  getRemainingWindowMinutes(userId) {
    if (!config.MAX_DOWNLOADS_PER_USER || config.MAX_DOWNLOADS_PER_USER <= 0) {
      return 0;
    }
    const validTimestamps = this._getValidTimestamps(userId);
    if (validTimestamps.length === 0) return 0;

    const windowMs = config.RATE_LIMIT_MINUTES * 60 * 1000;
    const oldestTimestamp = validTimestamps[0];
    const msRemaining = windowMs - (Date.now() - oldestTimestamp);
    return Math.max(1, Math.ceil(msRemaining / 60000));
  }

  /**
   * Clean up stale user entries from memory.
   */
  cleanup() {
    const windowMs = config.RATE_LIMIT_MINUTES * 60 * 1000;
    const now = Date.now();

    for (const [userId, timestamps] of this.userDownloads.entries()) {
      const valid = timestamps.filter((ts) => now - ts < windowMs);
      if (valid.length === 0) {
        this.userDownloads.delete(userId);
      } else {
        this.userDownloads.set(userId, valid);
      }
    }
  }
}

module.exports = new RateLimiter();
