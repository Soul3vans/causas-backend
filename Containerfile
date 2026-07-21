# Containerfile — causas-backend con Google Chrome real (no Chromium)
FROM node:20-bookworm

# --- Dependencias del sistema necesarias para que Chrome headless funcione ---
RUN apt-get update && apt-get install -y --no-install-recommends \
    wget \
    gnupg \
    ca-certificates \
    fonts-liberation \
    libasound2 \
    libatk-bridge2.0-0 \
    libatk1.0-0 \
    libc6 \
    libcairo2 \
    libcups2 \
    libdbus-1-3 \
    libexpat1 \
    libfontconfig1 \
    libgbm1 \
    libgcc1 \
    libglib2.0-0 \
    libgtk-3-0 \
    libnspr4 \
    libnss3 \
    libpango-1.0-0 \
    libx11-6 \
    libx11-xcb1 \
    libxcb1 \
    libxcomposite1 \
    libxcursor1 \
    libxdamage1 \
    libxext6 \
    libxfixes3 \
    libxi6 \
    libxrandr2 \
    libxrender1 \
    libxss1 \
    libxtst6 \
    xdg-utils \
    xvfb \
    x11vnc \
    fluxbox \
    novnc \
    websockify \
    procps \
    && rm -rf /var/lib/apt/lists/*

# --- Google Chrome real (NO Chromium) desde el repo oficial de Google ---
RUN wget -q -O /etc/apt/trusted.gpg.d/google-chrome.asc https://dl.google.com/linux/linux_signing_key.pub \
    && echo "deb [arch=amd64 signed-by=/etc/apt/trusted.gpg.d/google-chrome.asc] http://dl.google.com/linux/chrome/deb/ stable main" \
       > /etc/apt/sources.list.d/google-chrome.list \
    && apt-get update \
    && apt-get install -y --no-install-recommends google-chrome-stable \
    && rm -rf /var/lib/apt/lists/*

# Verificación de que Chrome quedó instalado y usable
RUN google-chrome-stable --version

# --- Redis (para la cola BullMQ) ---
RUN apt-get update && apt-get install -y --no-install-recommends redis-server \
    && rm -rf /var/lib/apt/lists/*

# --- ngrok ---
RUN wget -q -O /tmp/ngrok.tgz https://bin.equinox.io/c/bNyj1mQVY4c/ngrok-v3-stable-linux-amd64.tgz \
    && tar -xzf /tmp/ngrok.tgz -C /usr/local/bin \
    && rm /tmp/ngrok.tgz \
    && ngrok version

# --- App ---
WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev

COPY . .

# Directorio donde vivirá el perfil persistente de Chrome (montado como volumen)
RUN mkdir -p /data/chrome-profile

COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

COPY warm-profile.sh /warm-profile.sh
RUN chmod +x /warm-profile.sh

ENV NODE_ENV=production
ENV CHROME_PROFILE_DIR=/data/chrome-profile
# Le decimos a nuestro getExecutablePath() dónde está Chrome real dentro del contenedor
ENV CHROME_EXECUTABLE_PATH=/usr/bin/google-chrome-stable
ENV REDIS_HOST=127.0.0.1
ENV REDIS_PORT=6379

EXPOSE 4000
EXPOSE 6080

ENTRYPOINT ["/entrypoint.sh"]