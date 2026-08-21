const mongoose = require('mongoose')

/**
 * Colección INTERNA del JobDispatcher / scrape-pool.
 * NUNCA se expone vía GraphQL — es infraestructura del scraper,
 * no un dato que el usuario final deba consultar directamente.
 * El frontend sigue consumiendo únicamente ProcessStatus.
 */
const CAUSE_STATES = [
  'QUEUED',              // esperando turno, aún no le toca
  'PROCESSING',          // siendo trabajada activamente por un worker
  'COMPLETED',           // terminó con éxito
  'COMPLETED_NOT_FOUND', // terminal válido: la causa no existe en el sitio
  'REQUEUED',            // se detuvo por PoolRecoveryError, espera reanudación con prioridad
  'ERROR'                // fallo real, no relacionado a sesión/infraestructura
]

const ScraperJobSchema = new mongoose.Schema(
  {
    // Vínculo con el mundo "de cara al usuario"
    caseId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Cases',
      required: true
    },
    processId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'ProcessStatus',
      required: true
    },
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Users',
      required: true
    },

    // Datos necesarios para re-ejecutar scrapRawData sin volver a consultar Cases
    fullRol: { type: String, required: true },
    searchParams: { type: mongoose.Schema.Types.Mixed, required: true },

    // Estado de cola
    status: {
      type: String,
      enum: CAUSE_STATES,
      default: 'QUEUED',
      required: true
    },

    // Afinidad de worker: qué TabWorker la tiene/tenía asignada.
    // null mientras está en QUEUED sin asignar todavía.
    ownerWorkerId: {
      type: Number,
      default: null
    },

    // Prioridad de asignación dentro de su worker.
    // REQUEUED siempre usa priority=1 (máxima). QUEUED normal usa priority=0.
    priority: {
      type: Number,
      default: 0
    },

    // Se incrementa cada vez que pasa por REQUEUED, para diagnóstico
    // y como base de un futuro límite de reintentos si hiciera falta.
    requeueCount: {
      type: Number,
      default: 0
    },

    errorMessage: {
      type: String,
      default: null
    },

    startedAt: { type: Date, default: null },
    completedAt: { type: Date, default: null }
  },
  { timestamps: true }
)

// Índice principal de trabajo del JobDispatcher:
// "dame las causas de este worker, ordenadas por prioridad y antigüedad"
ScraperJobSchema.index({ ownerWorkerId: 1, status: 1, priority: -1, createdAt: 1 })

// Índice para el front-draining: "dame las causas QUEUED sin importar worker,
// para repartir en cascada W1→W2→W3"
ScraperJobSchema.index({ status: 1, priority: -1, createdAt: 1 })

// Búsqueda directa por processId (para actualizar cuando termina un job)
ScraperJobSchema.index({ processId: 1 })

module.exports = mongoose.model('ScraperJobs', ScraperJobSchema)
module.exports.CAUSE_STATES = CAUSE_STATES
