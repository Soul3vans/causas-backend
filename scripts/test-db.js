const mongoose = require('mongoose');

const uri = "mongodb+srv://caussian_user:TU_CONTRASEÑA@cluster0.bx5u4i8.mongodb.net/?retryWrites=true&w=majority";

mongoose.connect(uri, { useNewUrlParser: true, useUnifiedTopology: true });

const db = mongoose.connection;

db.on('error', console.error.bind(console, 'Error de conexión:'));
db.once('open', async function() {
  console.log('✅ Conectado a MongoDB');
  
  // Listar todas las colecciones
  const collections = await mongoose.connection.db.listCollections().toArray();
  console.log('Colecciones:', collections.map(c => c.name));
  
  process.exit(0);
});