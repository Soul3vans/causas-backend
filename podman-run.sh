#!/usr/bin/env bash
set -e

IMAGE_NAME="causas-backend"
CONTAINER_NAME="causas-backend"

# Directorio EN EL HOST donde persiste el perfil de Chrome entre despliegues.
# Fuera del repo, para que git pull / rebuilds no lo toquen.
HOST_PROFILE_DIR="${HOME}/causas-chrome-profile"
mkdir -p "$HOST_PROFILE_DIR"

echo "🔨 Construyendo imagen..."
podman build -t "$IMAGE_NAME" -f Containerfile .

echo "🛑 Deteniendo contenedor anterior (si existe)..."
podman rm -f "$CONTAINER_NAME" 2>/dev/null || true

echo "🚀 Lanzando contenedor..."
# Modo debug: pon 1 para ver el navegador vía VNC, 0 para producción normal
SCRAPER_DEBUG=${SCRAPER_DEBUG:-0}

podman run -d \
  --name "$CONTAINER_NAME" \
  --restart=always \
  -p 4000:4000 \
  -p 6080:6080 \
  -v "${HOST_PROFILE_DIR}:/data/chrome-profile" \
  -e SCRAPER_DEBUG="$SCRAPER_DEBUG" \
  --env-file .env \
  "$IMAGE_NAME"

echo "✅ Listo. Logs con: podman logs -f $CONTAINER_NAME"
