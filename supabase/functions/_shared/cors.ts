// Orígenes permitidos para llamar a las Edge Functions del proyecto (USERS-001).
//
// Lista base: staging y producción, iguales en todos los entornos. `App` (producción) todavía no
// tiene usuarios (F20), así que `https://app.extendiendoservicios.com` hoy no se ejerce en la
// práctica, pero se declara para no tener que volver a tocar este archivo cuando F20 la habilite.
//
// SEG-07 (P18.6): `http://localhost:5173` (Vite local y `vite preview` de las pruebas e2e) YA NO
// está en la lista base: en producción no tiene que aparecer. Se agrega solo donde se configure
// el secreto de la función `ALLOWED_ORIGINS_EXTRA` (lista separada por comas). Hoy está cargado
// únicamente en `App_dev`; en `App` el secreto no existe.
export const ALLOWED_ORIGINS = [
  'https://dev.extendiendoservicios.com',
  'https://app.extendiendoservicios.com',
]

// Defensa en profundidad: aunque alguien cargue el secreto por error en producción, solo se
// aceptan orígenes locales (localhost o 127.0.0.1, http, con puerto opcional). Cualquier otro
// valor se ignora en silencio.
const EXTRA_ORIGIN_PATTERN = /^http:\/\/(localhost|127\.0\.0\.1)(:\d{1,5})?$/

/**
 * Orígenes extra de este entorno (secreto `ALLOWED_ORIGINS_EXTRA`, separados por comas),
 * filtrados para que sean solo locales. Se lee en cada llamada y no al cargar el módulo, así los
 * tests pueden cambiar la variable.
 */
export function extraAllowedOrigins(): string[] {
  const raw = Deno.env.get('ALLOWED_ORIGINS_EXTRA') ?? ''
  return raw
    .split(',')
    .map((o) => o.trim())
    .filter((o) => EXTRA_ORIGIN_PATTERN.test(o))
}

/** Lista base más los orígenes extra locales de este entorno. */
export function getAllowedOrigins(): string[] {
  return [...ALLOWED_ORIGINS, ...extraAllowedOrigins()]
}

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
  if (origin && getAllowedOrigins().includes(origin)) {
    headers['Access-Control-Allow-Origin'] = origin
  }
  return headers
}
