const { execFile } = require('child_process');
const path = require('path');
const fs = require('fs');
const https = require('https');
const http = require('http');
const crypto = require('crypto');
const puppeteer = require('puppeteer-core');
const { getFbVideoInfo } = require('fb-downloader-scrapper');
const config = require('./config');
const { logDownload, logError, logInfo, getFileSizeInMB, safeDeleteFile } = require('./utils');

/**
 * Dynamically locates Chrome or Chromium executable on Windows or Linux environments.
 * Searches system PATH, environment variables, and Puppeteer cache directories.
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

  // Search inside Puppeteer cache directory (.cache/puppeteer)
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

class Downloader {
  constructor() {
    this.activeDownloads = 0;
  }

  /**
   * Get currently active download count.
   * @returns {number}
   */
  getActiveDownloadsCount() {
    return this.activeDownloads;
  }

  /**
   * Helper to get executable path for yt-dlp (local binary or PATH).
   * @returns {string}
   */
  getYtdlpCmd() {
    const localBinary = path.join(process.cwd(), process.platform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp');
    if (fs.existsSync(localBinary)) {
      return localBinary;
    }
    return 'yt-dlp';
  }

  /**
   * Check if yt-dlp binary is installed and executable in system PATH or local directory.
   * @returns {Promise<boolean>}
   */
  async checkYtdlpAvailable() {
    const cmd = this.getYtdlpCmd();
    return new Promise((resolve) => {
      execFile(cmd, ['--version'], (error) => {
        resolve(!error);
      });
    });
  }

  /**
   * Helper to download a direct file URL to disk, automatically following HTTP redirects.
   * @param {string} fileUrl
   * @param {string} outputPath
   * @returns {Promise<boolean>}
   */
  async _downloadFileFromUrl(fileUrl, outputPath) {
    return new Promise((resolve, reject) => {
      const fileStream = fs.createWriteStream(outputPath);
      const protocol = fileUrl.startsWith('https') ? https : http;

      const request = protocol.get(fileUrl, (response) => {
        // Handle HTTP redirects (301, 302, 307, 308)
        if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
          const redirectUrl = response.headers.location;
          fileStream.close();
          return this._downloadFileFromUrl(redirectUrl, outputPath).then(resolve).catch(reject);
        }

        if (response.statusCode !== 200) {
          fileStream.close();
          return reject(new Error(`HTTP status code ${response.statusCode}`));
        }

        response.pipe(fileStream);

        fileStream.on('finish', () => {
          fileStream.close();
          resolve(true);
        });
      });

      request.on('error', (err) => {
        fs.unlink(outputPath, () => {});
        reject(err);
      });

      request.setTimeout(config.DOWNLOAD_TIMEOUT, () => {
        request.destroy();
        fs.unlink(outputPath, () => {});
        reject(new Error('HTTP download request timeout'));
      });
    });
  }

  /**
   * Primary download engine: Facebook Scraper API
   */
  async _downloadViaApi(url, outputPath) {
    try {
      logInfo('Attempting download via Facebook API Engine...');
      const info = await getFbVideoInfo(url);
      if (!info || (!info.hd && !info.sd)) {
        throw new Error('No direct video URL returned from API');
      }

      const videoDirectUrl = info.hd || info.sd;
      logInfo('API extracted video URL successfully. Downloading MP4 stream...');
      await this._downloadFileFromUrl(videoDirectUrl, outputPath);
      return true;
    } catch (err) {
      logError(`API Download Engine failed: ${err.message}`);
      return false;
    }
  }

  /**
   * Fallback download engine: yt-dlp
   */
  async _downloadViaYtdlp(url, outputPath) {
    logInfo('Falling back to yt-dlp Engine...');
    const args = [
      '--no-playlist',
      '--format', 'b[ext=mp4]/bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/mp4/best',
      '--merge-output-format', 'mp4',
      '--no-warnings',
      '--max-filesize', `${config.MAX_FILE_SIZE_MB}M`,
      '-o', outputPath,
      url
    ];

    return new Promise((resolve) => {
      let isSettled = false;
      let childProcess = null;

      const timer = setTimeout(async () => {
        if (!isSettled) {
          isSettled = true;
          logError(`yt-dlp download timed out after ${config.DOWNLOAD_TIMEOUT}ms`);
          if (childProcess && !childProcess.killed) {
            try {
              childProcess.kill('SIGKILL');
            } catch (e) {
              // Ignore kill error
            }
          }
          await safeDeleteFile(outputPath);
          resolve(false);
        }
      }, config.DOWNLOAD_TIMEOUT);

      const cmd = this.getYtdlpCmd();
      childProcess = execFile(cmd, args, async (error, stdout, stderr) => {
        if (isSettled) return;
        isSettled = true;
        clearTimeout(timer);

        if (error) {
          logError(`yt-dlp error: ${stderr || error.message}`);
          await safeDeleteFile(outputPath);
          return resolve(false);
        }
        resolve(true);
      });
    });
  }

  /**
   * Photo Download Engine: Extract post image via Chrome Puppeteer
   */
  async _downloadViaPhotoEngine(url, outputPath) {
    logInfo('Attempting photo extraction via Chrome Engine...');
    const chromePath = getChromeExecutablePath();
    if (!chromePath) {
      logError('Chrome executable not found for photo extraction');
      return false;
    }

    let browser = null;
    try {
      browser = await puppeteer.launch({
        executablePath: chromePath,
        headless: true,
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-gpu'
        ]
      });

      const page = await browser.newPage();
      await page.goto(url, { waitUntil: 'networkidle2', timeout: 25000 });

      const imageUrl = await page.evaluate(() => {
        const metaOg = document.querySelector('meta[property="og:image"]');
        if (metaOg && metaOg.content && metaOg.content.includes('scontent')) return metaOg.content;

        const imgs = Array.from(document.querySelectorAll('img'));
        const postImg = imgs.find(i => 
          i.src &&
          (i.src.includes('scontent') || i.src.includes('fbcdn')) &&
          !i.src.includes('emoji') &&
          !i.src.includes('rsrc.php') &&
          !i.src.includes('static') &&
          (i.width > 200 || i.height > 200)
        );

        return postImg ? postImg.src : (metaOg ? metaOg.content : null);
      });

      await browser.close();
      browser = null;

      if (!imageUrl) {
        logError('No photo stream found on Facebook page');
        return false;
      }

      logInfo(`Found image URL (${imageUrl.substring(0, 60)}...). Downloading photo...`);
      await this._downloadFileFromUrl(imageUrl, outputPath);
      return true;
    } catch (err) {
      if (browser) {
        try { await browser.close(); } catch (e) {}
      }
      logError(`Photo Engine error: ${err.message}`);
      return false;
    }
  }

  /**
   * Downloads Facebook Media (Video or Photo) with API, yt-dlp, and Photo Engine fallbacks.
   * @param {string} url - Facebook post/video URL
   * @param {string} userPhone - User identifier for logging
   * @returns {Promise<{success: boolean, filePath?: string, isVideo?: boolean, error?: string, sizeExceeded?: boolean}>}
   */
  async downloadMedia(url, userPhone) {
    this.activeDownloads++;
    logDownload(`User: ${userPhone}`);
    logDownload(`URL: ${url}`);
    logDownload('Started');

    const uniqueId = `${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
    const mp4Path = path.join(config.DOWNLOADS_DIR, `fb_${uniqueId}.mp4`);
    const jpgPath = path.join(config.DOWNLOADS_DIR, `fb_${uniqueId}.jpg`);

    try {
      // 1. Primary Method: Fast Facebook API Engine for Videos
      let success = await this._downloadViaApi(url, mp4Path);

      // 2. Fallback Method: yt-dlp Video Engine
      if (!success) {
        success = await this._downloadViaYtdlp(url, mp4Path);
      }

      if (success && fs.existsSync(mp4Path)) {
        const sizeMB = getFileSizeInMB(mp4Path);
        if (sizeMB > 0) {
          if (config.MAX_FILE_SIZE_MB > 0 && sizeMB > config.MAX_FILE_SIZE_MB) {
            await safeDeleteFile(mp4Path);
            return { success: false, error: 'FILE_TOO_LARGE', sizeExceeded: true };
          }

          logDownload('Video Download Completed');
          return { success: true, filePath: mp4Path, isVideo: true };
        }
      }

      await safeDeleteFile(mp4Path);

      // 3. Fallback Method: Photo Download Engine for Photo / Post links
      const photoSuccess = await this._downloadViaPhotoEngine(url, jpgPath);
      if (photoSuccess && fs.existsSync(jpgPath) && getFileSizeInMB(jpgPath) > 0) {
        logDownload('Photo Download Completed');
        return { success: true, filePath: jpgPath, isVideo: false };
      }

      await safeDeleteFile(jpgPath);
      return { success: false, error: 'DOWNLOAD_FAILED' };
    } catch (err) {
      logError(`Unexpected download error: ${err.message}`);
      await safeDeleteFile(mp4Path);
      await safeDeleteFile(jpgPath);
      return { success: false, error: 'DOWNLOAD_FAILED' };
    } finally {
      this.activeDownloads = Math.max(0, this.activeDownloads - 1);
    }
  }

  /**
   * Alias for backward compatibility.
   */
  async downloadVideo(url, userPhone) {
    return this.downloadMedia(url, userPhone);
  }
}

module.exports = new Downloader();
