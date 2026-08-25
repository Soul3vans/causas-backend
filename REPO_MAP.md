# REPO_MAP / PROJECT_MAP

**Resumen ejecutivo**

Este repositorio implementa el backend de "Causas Concursales": una API GraphQL (Apollo + Express) que expone datos judiciales (causas), persistidos en MongoDB, y que además orquesta un motor de scraping basado en Puppeteer para obtener/actualizar información desde portales judiciales. El sistema incluye colas (BullMQ/Redis), workers asíncronos, envíos de correo (templates), y tareas programadas (cron).

**Capas / arquitectura**
- Frontend: repositorio separado (mencionado como `../client` en `package.json` scripts).
- Backend API: `server.js` + `resolvers.js` + `gql/typeDefs.gql`.
- Persistencia: MongoDB (Mongoose models en `models/`).
- Cola & workers: Redis + BullMQ (`utils/queues/scraping-queue.js`, `workers/`).
- Scraper: Puppeteer (`utils/scrapper.js`, `utils/scrape-pool.js`, `utils/plugins/*`).
- Infra: Docker (`docker-compose.yml`, `Containerfile`), ngrok configurado opcionalmente.

**Módulos / componentes clave y responsabilidades**
- `server.js`: Inicialización Express + Apollo, middlewares (CORS, morgan), cron jobs y arranque del servidor. [server.js](server.js)
- `gql/typeDefs.gql`: contrato GraphQL (tipos, inputs, paginación). [gql/typeDefs.gql](gql/typeDefs.gql)
- `resolvers.js`: lógica de dominio para queries/mutations, orquesta scraping, encolado, mailing y llamadas a utilidades. [resolvers.js](resolvers.js)
- `models/`: modelos Mongoose para `Cases`, `Users`, `Messages`, `ProcessStatus`, etc.
- `utils/db/mongoose.js`: `MongoDatabase.connect()` con manejo de timeouts y eventos. [utils/db/mongoose.js](utils/db/mongoose.js)
- `utils/scrape-pool.js`: pool + runners para scraping concurrente. [utils/scrape-pool.js](utils/scrape-pool.js)
- `utils/scrapper.js` / `utils/scrapper-auth.js`: funciones concretas para scrapear páginas y extraer datos.
- `utils/queues/scraping-queue.js`: productor/consumidor que usa BullMQ para encolar actualizaciones.
- `workers/mail-sender/`: plantillas y scripts para envío de notificaciones por correo.

**Grafo de dependencias internas (resumen)**
- `server.js` → `resolvers.js`, `utils/db`, `utils/plugins`, modelos en `models/`.
- `resolvers.js` → `utils/scrapper`, `utils/scrapper-auth`, `utils/queues/scraping-queue`, `utils/mail`, `workers/mail-sender/templates`.
- `utils/scrape-pool.js` → `browser-session-manager`, `job-dispatcher`, `case-updater`.
- `utils/queues/scraping-queue.js` → `utils/scrape-pool.js` (enqueue) y workers que procesan la cola.

**Flujos críticos**
- Autenticación:
  - `resolvers.js` -> `getUser(token)` usa `jwt.verify` con `process.env.SECRET` y devuelve `currentUser` en `context` del Apollo Server.
  - Buscar lógica adicional en `utils/session-guard.js` y `utils/auth-guard.js`.

- Request → Response (GraphQL):
  - `express` acepta request -> `ApolloServer` maneja GraphQL -> `context` inyecta modelos y `currentUser` -> resolvers ejecutan consultas/operaciones.

- Scraping / actualización de causas:
  - `resolvers.js` invoca funciones de `utils/scrapper` o encola trabajos en `utils/queues/scraping-queue.js`.
  - `utils/scrape-pool.js` administra sesiones de navegador y runner loops que consumen `ScraperJobs`.
  - Los resultados se guardan en `models/Cases` y se envían notificaciones vía `workers/mail-sender`.

- Jobs programados (cron):
  - `server.js` registra `node-cron` tasks: `sendActivityReminder`, `dailyScraps`, `casesUpdater`.

**Integraciones externas y configuración**
- MongoDB: `MONGO_URI`, `MONGO_DB_NAME` (`variables.env`, `docker-compose.yml`).
- Redis: `REDIS_HOST`/`REDIS_PORT` o `REDIS_URL` (cola y BullMQ).
- SMTP: `MAIL_HOST`, `MAIL_USER`, `MAIL_PASS` (ver `config/mail.js`).
- AWS S3 / DigitalOcean Spaces: SDK presente (`@aws-sdk/client-s3`) y variables opcionales comentadas.
- Ngrok: `NGROK_AUTHTOKEN` en `variables.env`.

Variables de entorno importantes (buscar en `variables.env` y `docker-compose.yml`):
- `SECRET` (JWT)
- `MONGO_URI`, `MONGO_DB_NAME`
- `REDIS_URL` o `REDIS_HOST`/`REDIS_PORT`
- `MAIL_HOST`, `MAIL_USER`, `MAIL_PASS`
- `CORS_ORIGIN_URI`
- `CHROME_PROFILE_DIR`, `BROWSER_HEADLESS`, `SCRAPING_CONCURRENCY`

**Dónde buscar X (router de conceptos → archivos)**
- Autenticación JWT: `resolvers.js` (getUser) y `utils/auth-guard.js`.
- Conexión DB: `utils/db/mongoose.js`.
- Esquema GraphQL: `gql/typeDefs.gql`.
- Resolvers / lógica de negocio: `resolvers.js`.
- Scraper principal: `utils/scrapper.js`, `utils/scrapper-auth.js`, `utils/scrape-pool.js`.
- Cola / workers: `utils/queues/scraping-queue.js`, `workers/`.
- Envío de mails: `config/mail.js`, `utils/mail.js`, `workers/mail-sender/`.

**Puntos frágiles / deuda técnica detectada**
- Inconsistencia `type: "module"` en `package.json` vs código CommonJS (`require`) — riesgo de fallo en tiempo de ejecución.
- `server.js` llama `await scrapePool.initialize(...)` sin declarar `scrapePool` (posible ReferenceError). [server.js](server.js)
- Dependencias mezcladas: `apollo-server-express@2.x` y `graphql@15.x` (versiones antiguas frente a Apollo/GraphQL actuales). Considerar migración si se actualiza Node.
- Secrets en `variables.env` con valores reales (ej. `PASS`, `SECRET`) — riesgo de exposición. Evitar subir credenciales.
- Puppeteer + scraping: consumo de memoria y manejo de sesiones complejo; `scrape-pool` intenta mitigar pero conviene revisar límites y manejo de errores.
- Tests: no se detectan pruebas unitarias automáticas ni configuración CI en el repo (deuda de cobertura).
