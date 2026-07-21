const { AuthenticationError } = require('apollo-server-express')
const jwt = require('jsonwebtoken')

/**
 * Extrae el token del header Authorization, aceptando tanto
 * "Bearer <token>" como el token crudo sin prefijo.
 */
function extractToken(rawHeader) {
  if (!rawHeader) return null
  return rawHeader.startsWith('Bearer ')
    ? rawHeader.slice(7).trim()
    : rawHeader.trim()
}

/**
 * Verifica el JWT y devuelve el payload decodificado.
 * Lanza AuthenticationError si el token es inválido o expiró.
 * Devuelve null si no había token (petición anónima) — quien
 * llame a esto decide si eso es aceptable o no.
 */
async function getUserFromToken(rawHeader) {
  const token = extractToken(rawHeader)
  if (!token) return null

  try {
    return jwt.verify(token, process.env.SECRET)
  } catch (error) {
    throw new AuthenticationError(
      'Su sesión ha expirado, por favor reingrese sus credenciales'
    )
  }
}

/**
 * Envuelve un resolver para EXIGIR que exista un usuario autenticado
 * en el contexto (currentUser), sin importar de dónde vino la petición
 * (con o sin header Origin, con o sin CORS de por medio).
 *
 * Uso:
 *   getCase: requireAuth(async (_, { id }, context) => { ... })
 */
function requireAuth(resolverFn) {
  return async (parent, args, context, info) => {
    if (!context.currentUser) {
      throw new AuthenticationError(
        'Debes iniciar sesión para acceder a este recurso'
      )
    }
    return resolverFn(parent, args, context, info)
  }
}

module.exports = { requireAuth, getUserFromToken, extractToken }
