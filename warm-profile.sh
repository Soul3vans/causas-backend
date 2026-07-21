#!/bin/bash
set -e

DISPLAY_NUM=99
export DISPLAY=:${DISPLAY_NUM}

echo "🖥️  Iniciando Xvfb en display :${DISPLAY_NUM}..."
Xvfb :${DISPLAY_NUM} -screen 0 1280x800x24 &
sleep 2

echo "🪟 Iniciando gestor de ventanas (fluxbox)..."
fluxbox &
sleep 1

echo "📡 Iniciando servidor VNC (puerto 5900)..."
x11vnc -display :${DISPLAY_NUM} -forever -shared -nopw -rfbport 5900 -bg -o /var/log/x11vnc.log

echo "🌐 Iniciando noVNC (puerto 6080) — accede desde tu navegador a http://<IP-del-servidor>:6080/vnc.html"
websockify --web=/usr/share/novnc/ 6080 localhost:5900 &
sleep 2

echo "🔧 Lanzando Chrome con perfil persistente en ${CHROME_PROFILE_DIR}..."
google-chrome-stable \
  --user-data-dir="${CHROME_PROFILE_DIR}" \
  --no-sandbox \
  --disable-blink-features=AutomationControlled \
  --start-maximized \
  --window-size=1280,800 \
  "https://oficinajudicialvirtual.pjud.cl" &

CHROME_PID=$!

echo ""
echo "======================================================================"
echo "✅ Todo listo. Abre en tu navegador (en tu Aspire o donde sea):"
echo ""
echo "   http://localhost:6080/vnc.html"
echo ""
echo "   (si expusiste el puerto 6080 del contenedor con -p 6080:6080)"
echo ""
echo "Navega manualmente por el portal, resuelve el CAPTCHA si aparece,"
echo "y deja pasar unos minutos simulando uso normal antes de cerrar."
echo ""
echo "Cuando termines, presiona Ctrl+C aquí para cerrar Chrome y guardar"
echo "el perfil (las cookies/sesión ya quedan escritas en el volumen)."
echo "======================================================================"
echo ""

wait $CHROME_PID
