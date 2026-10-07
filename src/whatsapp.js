const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const config = require('./config');
const downloader = require('./downloader');
const rateLimiter = require('./rateLimiter');
const {
  logInfo,
  logSend,
  logError,
  logWarn,
  formatUptime,
  extractFacebookUrl,
  safeDeleteFile,
} = require('./utils');

const startTime = Date.now();

/**
 * Checks if the message sender is authorized to use the bot.
 * Restricts access to ALLOWED_PHONE_NUMBER (e.g., 7870112967).
 * @param {object} msg
 * @returns {Promise<boolean>}
 */
async function isUserAuthorized(msg) {
  if (!config.ALLOWED_PHONE_NUMBER) return true; // No restriction set

  const allowedDigits = config.ALLOWED_PHONE_NUMBER.replace(/\D/g, '');
  if (!allowedDigits) return true;

  // Always allow self-sent messages / self-chat
  if (msg.fromMe) return true;

  const candidateDigits = [];
  if (msg.from) candidateDigits.push(msg.from.replace(/\D/g, ''));
  if (msg.author) candidateDigits.push(msg.author.replace(/\D/g, ''));

  try {
    const contact = await msg.getContact();
    if (contact && contact.number) {
      candidateDigits.push(contact.number.replace(/\D/g, ''));
    }
    if (contact && contact.id && contact.id._serialized) {
      candidateDigits.push(contact.id._serialized.replace(/\D/g, ''));
    }
  } catch (e) {
    // Non-blocking contact fetch fallback
  }

  return candidateDigits.some((num) => num.endsWith(allowedDigits));
}

const fs = require('fs');
const path = require('path');

/**
 * Dynamically locates Chrome or Chromium executable on Windows or Linux environments.
 * @returns {string|null}
 */
function getChromeExecutablePath() {
  const possiblePaths = [
    process.env.CHROME_BIN,
    process.env.PUPPETEER_EXECUTABLE_PATH,
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium-browser',
    '/usr/bin/chromium'
  ];

  for (const p of possiblePaths) {
    if (p && fs.existsSync(p)) return p;
  }

  const homeDir = process.env.HOME || '/home/container';
  const cacheBase = path.join(homeDir, '.cache', 'puppeteer');

  if (fs.existsSync(cacheBase)) {
    const findChrome = (dir) => {
      try {
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        for (const entry of entries) {
          const fullPath = path.join(dir, entry.name);
          if (entry.isDirectory()) {
            const found = findChrome(fullPath);
            if (found) return found;
          } else if (
            entry.name === 'chrome' ||
            entry.name === 'chrome.exe' ||
            entry.name === 'chrome-headless-shell'
          ) {
            return fullPath;
          }
        }
      } catch (e) {}
      return null;
    };
    const foundCacheChrome = findChrome(cacheBase);
    if (foundCacheChrome) return foundCacheChrome;
  }

  return null;
}

/**
 * Creates and configures the WhatsApp Web client.
 */
function createWhatsAppClient() {
  const chromePath = getChromeExecutablePath();
  const puppeteerOpts = {
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-accelerated-2d-canvas',
      '--no-first-run',
      '--no-zygote',
      '--disable-gpu',
    ],
  };

  if (chromePath) {
    logInfo(`Using Chrome binary at: ${chromePath}`);
    puppeteerOpts.executablePath = chromePath;
  }

  const client = new Client({
    authStrategy: new LocalAuth({
      dataPath: './.wwebjs_auth',
    }),
    takeoverOnConflict: true,
    takeoverTimeoutMs: 0,
    puppeteer: puppeteerOpts,
  });

  client.on('qr', (qr) => {
    logInfo('Scan the QR code below to authenticate WhatsApp:');
    qrcode.generate(qr, { small: true });
  });

  client.on('authenticated', () => {
    logInfo('WhatsApp authenticated');
  });

  client.on('auth_failure', (msg) => {
    logError(`WhatsApp authentication failure: ${msg}`);
  });

  client.on('ready', () => {
    logInfo('Bot ready');
  });

  client.on('disconnected', (reason) => {
    logWarn(`WhatsApp disconnected: ${reason}`);
  });

  // Use message_create to catch both incoming messages and self-chat / self-sent messages
  client.on('message_create', async (msg) => {
    try {
      if (!msg.body || msg.from === 'status@broadcast') return;

      const bodyText = msg.body.trim();

      // Ignore bot's own status/progress/error responses to prevent loops
      if (
        msg.fromMe &&
        (bodyText.startsWith('⏳') ||
          bodyText.startsWith('❌') ||
          bodyText.startsWith('🤖') ||
          bodyText.startsWith('📊') ||
          bodyText.startsWith('🏓') ||
          bodyText.startsWith('✅'))
      ) {
        return;
      }

      await handleMessage(client, msg);
    } catch (err) {
      logError(`Unexpected error processing message: ${err.message}`);
    }
  });

  return client;
}

/**
 * Handles incoming WhatsApp messages and commands.
 */
async function handleMessage(client, msg) {
  const text = msg.body.trim();

  // Authorize user
  const authorized = await isUserAuthorized(msg);
  if (!authorized) {
    logWarn(`Unauthorized request rejected from sender: ${msg.from}`);
    await msg.reply('❌ Sorry, this bot is private and locked to the authorized owner.');
    return;
  }

  let targetChatId = msg.to && msg.fromMe ? msg.to : msg.from;
  const userPhone = msg.author || msg.from;

  // Resolve @lid IDs to standard @c.us phone number JIDs if available
  try {
    const contact = await msg.getContact();
    if (contact && contact.id && contact.id._serialized) {
      if (contact.id._serialized.endsWith('@c.us')) {
        targetChatId = contact.id._serialized;
      } else if (contact.number) {
        targetChatId = `${contact.number}@c.us`;
      }
    }
  } catch (e) {
    // Non-blocking contact resolution fallback
  }

  // Command: !ping
  if (text.toLowerCase() === '!ping') {
    await msg.reply('🏓 Pong!');
    return;
  }

  // Command: !help
  if (text.toLowerCase() === '!help') {
    const helpMsg =
      `🤖 *WhatsApp Facebook Video Downloader Bot*\n\n` +
      `*Usage:*\n` +
      `Send any public Facebook video URL (e.g., \`facebook.com/...\` or \`fb.watch/...\`) to automatically download and receive the video.\n\n` +
      `*Available Commands:*\n` +
      `• \`!help\` - Show bot instructions\n` +
      `• \`!ping\` - Check bot responsiveness\n` +
      `• \`!status\` - View bot uptime, status, Node.js version, and active downloads`;
    await msg.reply(helpMsg);
    return;
  }

  // Command: !status
  if (text.toLowerCase() === '!status') {
    const uptimeSec = Math.floor((Date.now() - startTime) / 1000);
    const activeDl = downloader.getActiveDownloadsCount();
    const statusMsg =
      `📊 *Bot Status*\n` +
      `• *Status:* Online 🟢\n` +
      `• *Uptime:* ${formatUptime(uptimeSec)}\n` +
      `• *Node.js:* ${process.version}\n` +
      `• *Active Downloads:* ${activeDl}\n` +
      `• *Owner Locked:* ${config.ALLOWED_PHONE_NUMBER || 'None'}`;
    await msg.reply(statusMsg);
    return;
  }

  // Detect Facebook video URL
  const fbUrl = extractFacebookUrl(text);
  if (!fbUrl) {
    return; // Message is not a Facebook video link
  }

  // Check Rate Limiting
  if (rateLimiter.isRateLimited(targetChatId)) {
    logWarn(`Rate limit hit for user: ${userPhone}`);
    await msg.reply(`⏳ You're downloading too frequently. Please try again later.`);
    return;
  }

  // Record user download attempt
  rateLimiter.addDownload(targetChatId);

  // Send progress acknowledgement
  await msg.reply('⏳ Downloading your Facebook content...');

  let downloadResult = null;
  try {
    downloadResult = await downloader.downloadMedia(fbUrl, userPhone);

    if (!downloadResult.success) {
      if (downloadResult.sizeExceeded) {
        await msg.reply('❌ This content is too large to send through WhatsApp.');
      } else {
        await msg.reply("❌ Couldn't download this Facebook content. Make sure the link is valid and publicly accessible.");
      }
      return;
    }

    const { filePath, isVideo } = downloadResult;

    // Load downloaded media file
    const media = MessageMedia.fromFilePath(filePath);

    logInfo(`Sending ${isVideo ? 'video' : 'photo'} to recipient (${targetChatId})...`);

    // Send media file WITHOUT caption attached to media
    try {
      await client.sendMessage(targetChatId, media);
      logSend(`${isVideo ? 'Video' : 'Photo'} sent successfully via client.sendMessage`);
    } catch (err1) {
      logWarn(`Regular media send failed (${err1.message || err1}), retrying as document...`);
      try {
        await client.sendMessage(targetChatId, media, {
          sendMediaAsDocument: true,
        });
        logSend('Media sent successfully via document option');
      } catch (err2) {
        logWarn(`client.sendMessage document option failed (${err2.message || err2}), falling back to msg.reply...`);
        await msg.reply(media, undefined, {
          sendMediaAsDocument: true,
        });
        logSend('Media sent successfully via msg.reply');
      }
    }

    // Send completion message AFTER media has finished sending
    await msg.reply('✅ Done!');

    // Delete temporary file after sending
    await safeDeleteFile(filePath);
  } catch (err) {
    logError(`Error during download or send pipeline: ${err.stack || err.message || err}`);
    await msg.reply("❌ Couldn't download this Facebook content. Make sure the link is valid and publicly accessible.");

    if (downloadResult && downloadResult.filePath) {
      await safeDeleteFile(downloadResult.filePath);
    }
  }
}

module.exports = {
  createWhatsAppClient,
};
