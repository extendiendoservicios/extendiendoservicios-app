// Orígenes permitidos para llamar a las Edge Functions del proyecto (USERS-001).
//
// Mismo criterio que `supabase/config.toml` -> `[auth] additional_redirect_urls`: local (Vite),
// staging y producción. `App` (producción) todavía no tiene usuarios (F20), así que
// `https://app.extendiendoservicios.com` hoy no se ejerce en la práctica, pero se declara para
// no tener que volver a tocar este archivo cuando F20 la habilite.
export const ALLOWED_ORIGINS = [
  'http://localhost:5173',
  'https://dev.extendiendoservicios.com',
  'https://app.extendiendoservicios.com',
]

/**
 * Cabeceras CORS para una respuesta. Si `origin` no es uno de los permitidos, no se agrega
 * `Access-Control-Allow-Origin`: el navegador va a bloquear la respuesta igual, aunque el status
 * ya haya sido 200 (defensa en profundidad -- la verificación real, que corta con
 * ORIGIN_NOT_ALLOWED antes de hacer nada, vive en `index.ts`).
 */
export function corsHeaders(origin: string | null): HeadersInit {
  const headers: Record<string, string> = {
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers':
      'authorization, x-client-info, apikey, content-type',
    Vary: 'Origin',
  }
  if (origin && ALLOWED_ORIGINS.includes(origin)) {
    headers['Access-Control-Allow-Origin'] = origin
  }
  return headers
}
