const mongoose = require('mongoose')

const CasesUpdatedShema = new mongoose.Schema(
  {
    rol: { type: String, trim: true },
    cover: { type: String, trim: true },
    debtor: { type: String, trim: true },
    admission: { type: Date },
    estAdmin: { type: String, trim: true },
    process: { type: String, trim: true },
    location: { type: String, trim: true },
    stage: { type: String, trim: true },
    processState: { type: String, trim: true },
    court: { type: String, trim: true },
    movementsHistory: [
      {
        /**
         *  aki es string en vez de number porke hay cosas como esta en el indice
         * 1
         * 2
         * [1E]
         * [2A]
         * 3
         */
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
        book: { type: String, trim: true }
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
    extLink: { type: String, trim: true }
  },
  { timestamps: true }
)

CasesUpdatedShema.index({
  'movementsHistory.$**': 'text'
})

module.exports = mongoose.model('CasesUpdated', CasesUpdatedShema)
