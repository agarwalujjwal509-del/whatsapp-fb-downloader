const fs = require('fs');
const path = require('path');
const config = require('./config');

// Ensure required directories exist
if (!fs.existsSync(config.DOWNLOADS_DIR)) {
  fs.mkdirSync(config.DOWNLOADS_DIR, { recursive: true });
}
if (!fs.existsSync(config.LOGS_DIR)) {
  fs.mkdirSync(config.LOGS_DIR, { recursive: true });
}

/**
 * Appends a log message to the log file.
 */
function writeLogToFile(level, message) {
  const timestamp = new Date().toISOString();
  const logLine = `[${timestamp}] [${level}] ${message}\n`;
  try {
    fs.appendFileSync(config.LOG_FILE, logLine, 'utf8');
  } catch (err) {
    // Non-blocking log write error handler
  }
}

function logInfo(msg) {
  console.log(`[INFO] ${msg}`);
  writeLogToFile('INFO', msg);
}

function logDownload(msg) {
  console.log(`[DOWNLOAD] ${msg}`);
  writeLogToFile('DOWNLOAD', msg);
}

function logSend(msg) {
  console.log(`[SEND] ${msg}`);
  writeLogToFile('SEND', msg);
}

function logCleanup(msg) {
  console.log(`[CLEANUP] ${msg}`);
  writeLogToFile('CLEANUP', msg);
}

function logError(msg) {
  console.error(`[ERROR] ${msg}`);
  writeLogToFile('ERROR', msg);
}

function logWarn(msg) {
  console.warn(`[WARN] ${msg}`);
  writeLogToFile('WARN', msg);
}

/**
 * Formats uptime in human readable string (e.g., "0d 1h 23m 45s")
 * @param {number} totalSeconds
 * @returns {string}
 */
function formatUptime(totalSeconds) {
  const d = Math.floor(totalSeconds / (3600 * 24));
  const h = Math.floor((totalSeconds % (3600 * 24)) / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = Math.floor(totalSeconds % 60);

  return `${d}d ${h}h ${m}m ${s}s`;
}

/**
 * Regex to extract valid Facebook video URLs.
 * Matches facebook.com/... and fb.watch/... links.
 */
const FB_URL_REGEX = /(https?:\/\/(?:www\.|web\.|m\.|mobile\.)?(?:facebook\.com|fb\.watch)\/[^\s]+)/gi;

function extractFacebookUrl(text) {
  if (!text || typeof text !== 'string') return null;

  const matches = text.match(FB_URL_REGEX);
  if (!matches || matches.length === 0) return null;

  let urlCandidate = matches[0];
  // Strip trailing punctuation attached to link
  urlCandidate = urlCandidate.replace(/[.,)!?]+$/, '');

  try {
    const parsed = new URL(urlCandidate);
    const hostname = parsed.hostname.toLowerCase();

    if (
      hostname.endsWith('facebook.com') ||
      hostname === 'fb.watch' ||
      hostname.endsWith('.fb.watch')
    ) {
      return parsed.toString();
    }
  } catch (e) {
    return null;
  }

  return null;
}

function isFacebookUrl(url) {
  return !!extractFacebookUrl(url);
}

/**
 * Safely delete a file if it exists on disk.
 * @param {string} filePath
 */
async function safeDeleteFile(filePath) {
  if (!filePath) return;
  try {
    if (fs.existsSync(filePath)) {
      await fs.promises.unlink(filePath);
      logCleanup(`Temporary file deleted: ${path.basename(filePath)}`);
    }
  } catch (err) {
    logError(`Failed to delete temporary file ${filePath}: ${err.message}`);
  }
}

/**
 * Returns file size in Megabytes (MB).
 * @param {string} filePath
 * @returns {number}
 */
function getFileSizeInMB(filePath) {
  try {
    if (!fs.existsSync(filePath)) return 0;
    const stats = fs.statSync(filePath);
    return stats.size / (1024 * 1024);
  } catch (e) {
    return 0;
  }
}

module.exports = {
  logInfo,
  logDownload,
  logSend,
  logCleanup,
  logError,
  logWarn,
  formatUptime,
  extractFacebookUrl,
  isFacebookUrl,
  safeDeleteFile,
  getFileSizeInMB,
};
