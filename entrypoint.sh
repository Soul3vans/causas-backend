#!/bin/bash
set -e

echo "🔧 Iniciando Redis..."
redis-server --daemonize yes --bind 127.0.0.1 --port 6379

# Esperar a que Redis esté listo antes de seguir
for i in $(seq 1 10); do
  if redis-cli ping > /dev/null 2>&1; then
    echo "✅ Redis listo"
    break
  fi
  echo "⏳ Esperando Redis... ($i/10)"
  sleep 1
done

if [ -n "$NGROK_AUTHTOKEN" ]; then
  echo "🔧 Configurando ngrok..."
  ngrok config add-authtoken "$NGROK_AUTHTOKEN"

  echo "🔧 Iniciando ngrok en background (puerto 4000)..."
  ngrok http 4000 --log=stdout > /var/log/ngrok.log 2>&1 &
else
  echo "⚠️  NGROK_AUTHTOKEN no definido, saltando ngrok."
fi

echo "🚀 Iniciando servidor Node..."
# exec para que Node sea PID 1 y reciba señales (SIGTERM) correctamente
exec node server.js