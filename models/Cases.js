const mongoose = require('mongoose')

const CasesShema = new mongoose.Schema(
  {
    // ========== CAMPOS EXISTENTES ==========
    rol: { type: String, trim: true },
    cover: { type: String, trim: true },
    debtor: { type: String, trim: true },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
      ref: 'Users'
    },
    admission: { type: Date },
    estAdmin: { type: String, trim: true },
    process: { type: String, trim: true },
    location: { type: String, trim: true },
    stage: { type: String, trim: true },
    processState: { type: String, trim: true },
    court: { type: String, trim: true },
    movementsHistory: [
      {
        invoice: { type: String, trim: true, default: 0 },
        document: [
          {
            name: { type: String },
            file: { type: String },
            annexs: [
              {
                reference: { type: String },
                file: { type: String },
                date: { type: Date }
              }
            ]
          }
        ],
        annex: { type: String, trim: true },
        stage: { type: String, trim: true },
        procedure: { type: String, trim: true },
        descProcedure: { type: String, trim: true },
        dateProcedure: { type: Date },
        page: { type: Number, trim: true },
        book: { type: String, trim: true, default: '0 Principal' }
      }
    ],
    litigants: [
      {
        participant: { type: String, trim: true },
        rut: { type: String, trim: true },
        person: { type: String, trim: true },
        name: { type: String, trim: true }
      }
    ],
    extLink: { type: String, trim: true },
    status: { type: String, enum: ['ACTIVE', 'INACTIVE', 'CLOSED'], default: 'ACTIVE' },
    visibility: { type: Boolean, default: false },
    typeSearch: { type: String, enum: ['RESERVADA', 'UNIFICADA'], default: 'UNIFICADA' },
    lastUpdate: { type: Date },

    // ========== NUEVOS CAMPOS ==========
    searchParams: {
      competencia: { 
        type: String, 
        required: true,
        enum: ['1', '2', '3', '4', '5', '6', '7']
      },
      corteId: { type: String, required: true },
      tribunalId: { type: String, required: true },
      libroTipo: { type: String, required: true },
      rolNumber: { type: String, required: true },
      year: { type: String, required: true },
      fullRol: { type: String, required: true }
    },

    scrapedData: {
      lastScrapedAt: { type: Date, default: null },
      lastScrapedBy: { type: String, default: 'scheduler', enum: ['scheduler', 'manual', 'auto'] },
      status: { 
        type: String, 
        enum: ['pending', 'scraping', 'success', 'error', 'not_found'], 
        default: 'pending' 
      },
      errorMessage: { type: String, default: null },
      retryCount: { type: Number, default: 0 },
      data: {
        type: mongoose.Schema.Types.Mixed,
        default: null
      }
    }
  },
  { timestamps: true }
)

// ========== ÍNDICES ==========
CasesShema.index({ rol: 1 })
CasesShema.index({ 'searchParams.fullRol': 1 })
CasesShema.index({ 'scrapedData.status': 1, 'scrapedData.lastScrapedAt': 1 })
CasesShema.index({ 'movementsHistory.$**': 'text' })

module.exports = mongoose.model('Cases', CasesShema)