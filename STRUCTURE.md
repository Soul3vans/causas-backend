# Estructura del proyecto (resumen)

Raíz: causas-backend

├── apollo.config.js
├── docker-compose.yml
├── server.js
├── resolvers.js
├── package.json
├── variables.env
├── gql/
│   └── typeDefs.gql
├── models/
│   ├── Activity.js
│   ├── Cases.js
│   └── ... (esquemas Mongoose)
├── utils/
│   ├── db/
│   │   ├── index.js
│   │   └── mongoose.js
│   ├── scrape-pool.js
│   ├── scrapper.js
│   ├── queues/
│   │   └── scraping-queue.js
│   ├── plugins/
│   └── causes/
├── workers/
│   ├── mail-sender/
│   └── updater/
├── views/
│   └── email/
└── scripts/

Descripción breve de carpetas y archivos importantes
- `server.js`: Entry point principal (inicia Express + Apollo Server). [server.js](server.js)
- `package.json`: dependencias, scripts y `main: server.js`.
- `gql/typeDefs.gql`: esquema GraphQL (tipos y entradas).
- `resolvers.js`: implementación de resolvers GraphQL (lógica de negocio y orquestación). [resolvers.js](resolvers.js)
- `models/`: esquemas Mongoose (persistencia de dominio).
- `utils/`: utilidades y piezas del dominio:
  - `utils/db/`: utilidades de conexión a MongoDB (`MongoDatabase`). [utils/db/mongoose.js](utils/db/mongoose.js)
  - `utils/scrape-pool.js`: pool de instancias del scraper (gestiona sesiones y workers).
  - `utils/scrapper.js`, `utils/scrapper-auth.js`: lógica de scraping (puppeteer).
  - `utils/queues/scraping-queue.js`: cola/producer/consumer para actualizaciones (BullMQ/Redis).
  - `utils/plugins/`: plugins para puppeteer, proxies, user-agent, etc.
- `workers/`: procesos background (envío de mails, actualizadores programados).
- `docker-compose.yml` y `Containerfile`: despliegue local/contenerizado (mongo, redis, backend).
- `variables.env`: ejemplo de variables de entorno usadas en desarrollo.

Stack tecnológico y versiones (extraídas de `package.json` y `docker-compose.yml`)
- Lenguaje / runtime: Node.js (no especificado en `package.json`); package manager: `yarn@4.5.0`.
- Frameworks/Libs principales:
  - `express` ^4.21.1
  - `apollo-server-express` ^2.13.0
  - `graphql` ^15.9.0
  - `mongoose` ^7.0.3
  - `mongodb` 4.1
  - `bullmq` ^5.79.1 (cola basada en Redis)
  - `ioredis` ^5.11.1
  - `puppeteer` ^15.5.0 + `puppeteer-extra` y `stealth` plugin
  - `nodemailer`, `winston`, `morgan`, `node-cron`
  - Dev: `typescript` ^5.6.2, `nodemon`, `eslint`
- Infra en docker-compose:
  - `mongo:6.0` (servicio `mongo`)
  - `redis:7-alpine` (servicio `redis`)

Entry points y cómo ejecutar
- Local (sin contenedor):
  - `yarn start` (ejecuta `node server.js`) — `package.json` script `start`.
  - Requiere `variables.env` en la raíz (server carga `variables.env`). [variables.env](variables.env)
- Contenerizado (Docker):
  - `docker-compose up --build` lanzará `mongo`, `redis` y `backend` (usa `Containerfile`). [docker-compose.yml](docker-compose.yml)
- GraphQL:
  - Schema: `gql/typeDefs.gql` y `resolvers.js` exponen el endpoint en `/graphql`.

Notas rápidas (observaciones detectadas en la inspección):
- `package.json` contiene `type: "module"` pero la base de código usa `require`/CommonJS (`server.js`, `resolvers.js`). Esto es inconsistente y puede provocar errores al ejecutar con Node en modo ESM. Verificar [package.json](package.json) y [server.js](server.js).
- El archivo `server.js` llama a `await scrapePool.initialize(...)` pero no hay `const scrapePool = require('./utils/scrape-pool')` al inicio (posible fallo de referencia). Verificar [server.js](server.js) y [utils/scrape-pool.js](utils/scrape-pool.js).
