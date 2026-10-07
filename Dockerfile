# Production Dockerfile for WhatsApp Facebook Video Downloader Bot
FROM node:20-slim

# Prevent interactive prompts during apt install
ENV DEBIAN_FRONTEND=noninteractive
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium
ENV CHROME_BIN=/usr/bin/chromium

# Install System Dependencies: Chromium, FFmpeg, Python3, and fonts
RUN apt-get update && apt-get install -y --no-install-recommends \
    chromium \
    ffmpeg \
    python3 \
    wget \
    curl \
    ca-certificates \
    fonts-freefont-ttf \
    libnss3 \
    libatk1.0-0 \
    libatk-bridge2.0-0 \
    libcups2 \
    libdrm2 \
    libxkbcommon0 \
    libxcomposite1 \
    libxdamage1 \
    libxrandr2 \
    libgbm1 \
    libasound2 \
    libpango-1.0-0 \
    libcairo2 \
    libxfixes3 \
    && rm -rf /var/lib/apt/lists/*

# Install yt-dlp globally inside container
RUN wget https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -O /usr/local/bin/yt-dlp \
    && chmod a+rx /usr/local/bin/yt-dlp

# Set working directory
WORKDIR /usr/src/app

# Copy package manifest and install production dependencies
COPY package*.json ./
RUN npm install --omit=dev

# Copy application source code and WhatsApp session
COPY . .

# Ensure downloads and logs directories exist
RUN mkdir -p downloads logs && chmod -R 777 downloads logs

# Start the WhatsApp bot
CMD ["npm", "start"]
