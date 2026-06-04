# 📝 Registro de Cambios - Mapa del Proyecto

## Cambios Realizados

### 🆕 ARCHIVOS CREADOS

#### 1. **PROJECT_MAP.md** (Este archivo)
   - **Propósito**: Documentar la arquitectura completa del backend
   - **Contenido**:
     - Información general del proyecto
     - Stack tecnológico completo con versiones
     - Estructura de carpetas y módulos
     - Descripción de 14 modelos MongoDB
     - Scripts npm disponibles
     - Configuración de seguridad
     - Tareas programadas con cron
     - Flujo de datos
     - Variables de entorno requeridas
     - Composición del código (JS/Handlebars)
   
   - **Ubicación**: `/PROJECT_MAP.md`
   - **Para IAs Futuras**: Consultar este archivo para entender la arquitectura general del proyecto

#### 2. **CHANGELOG_MAP.md** (Este archivo)
   - **Propósito**: Mantener registro de cambios realizados al mapeo
   - **Ubicación**: `/CHANGELOG_MAP.md`
   - **Actualización**: Después de cualquier cambio arquitectónico o estructural

---

## 📊 Análisis de Dependencias

### Dependencias Críticas del Backend
```json
{
  "apollo-server-express": "^2.13.0",      // GraphQL Server
  "mongoose": "^7.0.3",                     // MongoDB ODM
  "express": "^4.21.1",                     // HTTP Framework
  "graphql": "^15.9.0",                     // GraphQL Core
  "jsonwebtoken": "^8.5.1",                 // Authentication
  "bcrypt": "^5.0.1",                       // Password Security
  "@aws-sdk/client-s3": "^3.674.0",         // Cloud Storage
  "puppeteer": "^15.5.0",                   // Web Scraping
  "nodemailer": "^6.7.2",                   // Email Service
  "node-cron": "^3.0.3"                     // Task Scheduling
}
```

---

## 🔄 Comparativa Frontend vs Backend

### Frontend (causas-frontend)
- **Lenguaje**: Vue.js 3
- **Enfoque**: UI/UX
- **Librerías**: Bulma, Vuex, Apollo Client
- **Herramientas**: Calendario, Validación, PWA
- **Puerto**: Típicamente 8080

### Backend (causas-backend) 
- **Lenguaje**: JavaScript/Node.js
- **Enfoque**: API, Lógica de Negocio
- **Librerías**: Express, Apollo Server, MongoDB
- **Herramientas**: Autenticación, Scraping, Email, S3
- **Puerto**: 4000 (por defecto)

### Integración
```
Frontend (Vue 3) 
    ↓↑ GraphQL Queries/Mutations
Backend (Apollo Server + Express)
    ↓↑ REST APIs + GraphQL
MongoDB + AWS S3
```

---

## 🎯 Puntos Clave para IAs Futuras

### ✅ Cómo Agregar Nuevas Funcionalidades

1. **Nuevo Endpoint GraphQL**:
   - Agregar TypeDef en `gql/typeDefs.gql`
   - Crear Resolver en `resolvers/`
   - Crear Model en `models/` si es necesario

2. **Nueva Tarea Programada**:
   - Crear archivo en `workers/mail-sender/nueva-tarea.js`
   - Importar en `server.js`
   - Configurar cron schedule con timezone

3. **Nueva Entidad de Base de Datos**:
   - Crear schema en `models/NuevaEntidad.js`
   - Importar en `server.js` como contexto
   - Documentar en esta guía

### 🔒 Seguridad

- El token JWT viene en el header `authorization`
- Se valida en la función `getUser()` del server.js
- Se pasa al contexto de Apollo Server para acceso en resolvers

### 📧 Email Templates

- Usar Handlebars (10.5% del código)
- Templates para: activity-reminder, daily-scraps, cases-updater
- Enviados via Nodemailer

### ⏱️ Timezones

- Sistema usa "America/Santiago" para tareas críticas
- Importante para daily-scraps (4:00 AM) y cases-updater (6:30 AM)

---

## 📋 Checklist para Mantenimiento

- [ ] Actualizar versiones de dependencias críticas (Apollo, Mongoose, Express)
- [ ] Revisar logs de cron jobs en producción
- [ ] Validar conexión MongoDB
- [ ] Verificar credenciales AWS S3
- [ ] Monitorear errores de autenticación JWT
- [ ] Revisar tamaño de base de datos

---

## 🚀 Próximas Mejoras Sugeridas

1. **Testing**: Agregar Jest para unit tests
2. **Documentación**: Swagger/OpenAPI para endpoints
3. **Logging**: Winston o Pino para logs estructurados
4. **Rate Limiting**: Implementar rate limit en Apollo
5. **Caching**: Redis para cachear queries frecuentes
6. **Validación**: Yup o Zod en resolvers

---

## 📞 Contacto y Soporte

- **Repositorio**: https://github.com/Soul3vans/causas-backend
- **Propietario**: Soul3vans
- **Tipo**: Público

---

**Última Actualización**: 2026-06-04
**Versión**: 1.0.0
**Mantenedor**: IA Assistant (Copilot)
