#!/bin/bash
set -e

# Versión local: para cuando SÍ tienes pantalla física (como tu Aspire).
# No usa Xvfb/VNC/Podman — lanza Chrome directo en tu escritorio actual.

if [ -z "${CHROME_PROFILE_DIR}" ]; then
  echo "❌ CHROME_PROFILE_DIR no está exportada. Corre primero:"
  echo "   export CHROME_PROFILE_DIR=/home/linux/causas-chrome-profile-dev"
  exit 1
fi

echo "🔧 Lanzando Chrome con perfil persistente en ${CHROME_PROFILE_DIR}..."
echo "   (esta ventana se abrirá en tu propio escritorio, úsala normal)"

google-chrome-stable \
  --user-data-dir="${CHROME_PROFILE_DIR}" \
  --no-sandbox \
  --disable-blink-features=AutomationControlled \
  --start-maximized \
  "https://oficinajudicialvirtual.pjud.cl/home/index.php"

echo ""
echo "✅ Chrome cerrado. El perfil (cookies/sesión) ya quedó guardado en:"
echo "   ${CHROME_PROFILE_DIR}"
