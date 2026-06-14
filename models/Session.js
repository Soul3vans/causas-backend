const mongoose = require('mongoose');

const sessionSchema = new mongoose.Schema({
  sessionType: {
    type: String,
    default: 'claveunica',
    enum: ['claveunica', 'invitado']
  },
  cookies: {
    type: Array,
    required: true,
    default: []
  },
  localStorage: {
    type: Object,
    default: {
      InitSitioOld: '0',
      InitSitioNew: '1',
      'logged-in': 'true',
      'acceso-invitado': 'true'
    }
  },
  sessionStorage: {
    type: Object,
    default: {
      'logged-in': 'true',
      'acceso-invitado': 'true'
    }
  },
  expiresAt: {
    type: Date,
    required: true,
    default: () => new Date(Date.now() + 5 * 60 * 1000) // 5 minutos por defecto
  },
  lastUsedAt: {
    type: Date,
    default: Date.now
  },
  createdAt: {
    type: Date,
    default: Date.now
  },
  metadata: {
    userAgent: String,
    lastUrl: String
  }
});

// Método para verificar si la sesión sigue vigente
sessionSchema.methods.isValid = function() {
  return this.expiresAt > new Date();
};

// Método para refrescar la fecha de expiración
sessionSchema.methods.refresh = function() {
  this.expiresAt = new Date(Date.now() + 5 * 60 * 1000);
  this.lastUsedAt = new Date();
  return this.save();
};

// Índices para búsquedas eficientes
sessionSchema.index({ sessionType: 1, createdAt: -1 });
sessionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 }); // TTL index

const Session = mongoose.model('Session', sessionSchema);

module.exports = Session;