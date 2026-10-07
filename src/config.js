const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

const config = {
  ALLOWED_PHONE_NUMBER: (process.env.ALLOWED_PHONE_NUMBER || '').trim(),
  MAX_FILE_SIZE_MB: parseInt(process.env.MAX_FILE_SIZE_MB, 10) || 64,
  MAX_DOWNLOADS_PER_USER: parseInt(process.env.MAX_DOWNLOADS_PER_USER, 10) || 0,
  RATE_LIMIT_MINUTES: parseInt(process.env.RATE_LIMIT_MINUTES, 10) || 0,
  DOWNLOAD_TIMEOUT: parseInt(process.env.DOWNLOAD_TIMEOUT, 10) || 300000,
  DOWNLOADS_DIR: path.join(__dirname, '../downloads'),
  LOGS_DIR: path.join(__dirname, '../logs'),
  LOG_FILE: path.join(__dirname, '../logs/bot.log'),
};

module.exports = config;
