#!/bin/bash
set -e

DISPLAY_NUM=99
export DISPLAY=:${DISPLAY_NUM}

# Matar instancias previas si existen
pkill -f Xvfb || true
pkill -f x11vnc || true
pkill -f websockify || true
sleep 1

echo "🖥️  Iniciando Xvfb en display :${DISPLAY_NUM}..."
Xvfb :${DISPLAY_NUM} -screen 0 1920x1080x24 -ac +extension GLX +render -noreset &
XVFB_PID=$!
sleep 2

# Verificar que Xvfb está corriendo
if ! kill -0 $XVFB_PID 2>/dev/null; then
    echo "❌ Xvfb no pudo iniciar"
    exit 1
fi
echo "✅ Xvfb corriendo (PID: $XVFB_PID)"

echo "🪟 Iniciando gestor de ventanas (fluxbox)..."
fluxbox &
sleep 1

echo "📡 Iniciando servidor VNC (puerto 5900)..."
x11vnc -display :${DISPLAY_NUM} -forever -shared -nopw -rfbport 5900 -bg -o /var/log/x11vnc.log
sleep 1

echo "🌐 Iniciando noVNC (puerto 6080)..."
websockify --web=/usr/share/novnc/ 6080 localhost:5900 &
sleep 2

echo ""
echo "======================================================================"
echo "✅ VNC listo."
echo ""
echo "   🌍 Desde tu host abre: http://localhost:6080/vnc.html"
echo "   📺 Display virtual   : :${DISPLAY_NUM}"
echo "   🔌 Puerto VNC        : 5900"
echo "   🔌 Puerto noVNC      : 6080"
echo ""
echo "   El scraper usará este display automáticamente"
echo "   si la variable DISPLAY=:${DISPLAY_NUM} está exportada."
echo "======================================================================"

# Exportar DISPLAY para que el backend lo herede
echo "export DISPLAY=:${DISPLAY_NUM}" >> /root/.bashrc
export DISPLAY=:${DISPLAY_NUM}

# Mantener el script vivo (Ctrl+C para detener todo)
wait $XVFB_PID