const fs = require('fs');
const path = require('path');
const config = require('./config');
const { logCleanup, logError } = require('./utils');

/**
 * Removes files older than maxAgeMs from the downloads directory.
 * @param {number} maxAgeMs - Maximum allowed file age in milliseconds (default: 10 minutes)
 */
async function cleanupOldFiles(maxAgeMs = 10 * 60 * 1000) {
  try {
    if (!fs.existsSync(config.DOWNLOADS_DIR)) return;

    const files = await fs.promises.readdir(config.DOWNLOADS_DIR);
    const now = Date.now();

    for (const file of files) {
      if (file === '.gitkeep') continue;

      const filePath = path.join(config.DOWNLOADS_DIR, file);
      try {
        const stats = await fs.promises.stat(filePath);
        if (stats.isFile() && now - stats.mtimeMs > maxAgeMs) {
          await fs.promises.unlink(filePath);
          logCleanup(`Removed orphaned temporary file: ${file}`);
        }
      } catch (err) {
        logError(`Error cleaning up file ${file}: ${err.message}`);
      }
    }
  } catch (err) {
    logError(`Error scanning downloads directory for cleanup: ${err.message}`);
  }
}

/**
 * Initializes cleanup background timer.
 * @param {number} intervalMs - Interval between cleanup runs in milliseconds
 */
function initCleanupRoutine(intervalMs = 15 * 60 * 1000) {
  // Initial cleanup on boot
  cleanupOldFiles();

  // Periodic scheduled cleanup
  setInterval(() => {
    cleanupOldFiles();
  }, intervalMs);
}

module.exports = {
  cleanupOldFiles,
  initCleanupRoutine,
};
