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
podman run -d \
  --name "$CONTAINER_NAME" \
  --restart=always \
  -p 4000:4000 \
  -v "${HOST_PROFILE_DIR}:/data/chrome-profile" \
  --env-file .env \
  "$IMAGE_NAME"

echo "✅ Listo. Logs con: podman logs -f $CONTAINER_NAME"
