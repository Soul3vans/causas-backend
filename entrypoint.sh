#!/bin/bash
set -e

# ========== MODO DEBUG: arrancar VNC ==========
if [ "$SCRAPER_DEBUG" = "1" ] || [ "$SCRAPER_DEBUG" = "true" ]; then
  echo "🔍 MODO DEBUG activado — iniciando VNC..."
  export DISPLAY=:99

  # Iniciar Xvfb en background
  Xvfb :99 -screen 0 1920x1080x24 -ac +extension GLX +render -noreset &
  XVFB_PID=$!
  sleep 2

  # Gestor de ventanas (opcional pero recomendado)
  if command -v fluxbox >/dev/null 2>&1; then
    fluxbox &
    sleep 1
  fi

  # x11vnc
  if command -v x11vnc >/dev/null 2>&1; then
    x11vnc -display :99 -forever -shared -nopw -rfbport 5900 -bg -o /var/log/x11vnc.log
    echo "✅ x11vnc corriendo en puerto 5900"
  fi

  # noVNC (acceso vía navegador)
  if command -v websockify >/dev/null 2>&1; then
    websockify --web=/usr/share/novnc/ 6080 localhost:5900 &
    echo "✅ noVNC corriendo en puerto 6080"
    echo ""
    echo "======================================================================"
    echo "🌐 Abre en tu navegador: http://localhost:6080/vnc.html"
    echo "======================================================================"
  fi

  echo "✅ Xvfb corriendo (PID: $XVFB_PID) en DISPLAY=:99"
fi

# ========== REDIS ==========
echo "🔧 Iniciando Redis..."
redis-server --daemonize yes --bind 127.0.0.1 --port 6379

for i in $(seq 1 10); do
  if redis-cli ping > /dev/null 2>&1; then
    echo "✅ Redis listo"
    break
  fi
  echo "⏳ Esperando Redis... ($i/10)"
  sleep 1
done

# ========== NGROK ==========
if [ -n "$NGROK_AUTHTOKEN" ]; then
  echo "🔧 Configurando ngrok..."
  ngrok config add-authtoken "$NGROK_AUTHTOKEN"
  echo "🔧 Iniciando ngrok en background (puerto 4000)..."
  ngrok http 4000 --log=stdout > /var/log/ngrok.log 2>&1 &
else
  echo "⚠️  NGROK_AUTHTOKEN no definido, saltando ngrok."
fi

# ========== NODE ==========
echo "🚀 Iniciando servidor Node..."
exec node server.js