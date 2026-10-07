const { logInfo, logWarn, logError } = require('./utils');
const downloader = require('./downloader');
const { initCleanupRoutine } = require('./cleanup');
const { createWhatsAppClient } = require('./whatsapp');

async function main() {
  logInfo('WhatsApp bot starting...');

  // Check system dependency: yt-dlp
  const hasYtdlp = await downloader.checkYtdlpAvailable();
  if (!hasYtdlp) {
    logWarn('yt-dlp executable was not detected in PATH. Downloading videos requires yt-dlp to be installed.');
  } else {
    logInfo('yt-dlp dependency check passed');
  }

  // Initialize automatic cleanup routine for old downloads
  initCleanupRoutine();
  logInfo('Cleanup routine initialized');

  // Create & start WhatsApp client
  const client = createWhatsAppClient();

  try {
    await client.initialize();
  } catch (err) {
    logError(`Failed to initialize WhatsApp Web client: ${err.message}`);
  }
}

// Global process exception handlers to keep bot running
process.on('uncaughtException', (err) => {
  logError(`Uncaught Exception: ${err.stack || err.message}`);
});

process.on('unhandledRejection', (reason) => {
  logError(`Unhandled Rejection: ${reason}`);
});

main();
