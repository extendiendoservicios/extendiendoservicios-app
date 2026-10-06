// scripts/import-initial/entorno.ts — DATA-003
//
// Elección explícita del entorno de destino y verificación del proyecto antes de escribir.
// El importador nunca adivina: hace falta `IMPORT_ENTORNO` (`app_dev` o `app`) y la URL de
// Supabase tiene que ser la de ese proyecto. `app` (producción) solo se acepta con la bandera
// `--permitir-produccion-f20`, que existe para el encargo de F20 y no se usa antes.

export const REF_APP_DEV = 'anesttvrnpsaaaxaquce'
export const REF_APP = 'fysuppdadwvabrjpnnoh'

export type Entorno = 'app_dev' | 'app'

export interface Conexion {
  entorno: Entorno
  url: string
  claveServicio: string
  ref: string
}

export class ErrorDeEntorno extends Error {}

const REF_POR_ENTORNO: Record<Entorno, string> = {
  app_dev: REF_APP_DEV,
  app: REF_APP,
}

/** Saca el ref del proyecto de una URL del estilo `https://<ref>.supabase.co`. */
export function refDeUrl(url: string): string | null {
  try {
    const host = new URL(url).hostname
    const m = /^([a-z0-9]+)\.supabase\.co$/.exec(host)
    return m ? m[1] : null
  } catch {
    return null
  }
}

/** Si la clave es un JWT (formato histórico), lee el `ref` que lleva adentro; si no, `null`. */
export function refDeClave(clave: string): string | null {
  const partes = clave.split('.')
  if (partes.length !== 3) return null
  try {
    const payload = JSON.parse(
      Buffer.from(partes[1], 'base64url').toString('utf8'),
    ) as { ref?: unknown }
    return typeof payload.ref === 'string' ? payload.ref : null
  } catch {
    return null
  }
}

export function resolverConexion(
  env: Record<string, string | undefined>,
  opciones: { permitirProduccionF20: boolean },
): Conexion {
  const pedido = env.IMPORT_ENTORNO
  if (pedido !== 'app_dev' && pedido !== 'app') {
    throw new ErrorDeEntorno(
      'Falta elegir el entorno de destino. Definí la variable IMPORT_ENTORNO con "app_dev" (staging y pruebas) o "app" (producción, solo para F20). No hay valor por defecto a propósito.',
    )
  }
  if (pedido === 'app' && !opciones.permitirProduccionF20) {
    throw new ErrorDeEntorno(
      'El destino "app" es PRODUCCIÓN. El importador se niega a escribir ahí salvo con la bandera --permitir-produccion-f20, que solo corresponde al encargo de F20.',
    )
  }
  const url = env.VITE_SUPABASE_URL
  const claveServicio = env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !claveServicio) {
    throw new ErrorDeEntorno(
      'Faltan VITE_SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY en el entorno. Corré el comando con `node --env-file=.env.local` (docs/environments.md sección 4).',
    )
  }
  const entorno: Entorno = pedido
  const esperado = REF_POR_ENTORNO[entorno]
  const refUrl = refDeUrl(url)
  if (refUrl === null) {
    throw new ErrorDeEntorno(
      'VITE_SUPABASE_URL no tiene el formato https://<ref>.supabase.co: no se puede verificar a qué proyecto apunta.',
    )
  }
  if (refUrl !== esperado) {
    const aQue =
      refUrl === REF_APP
        ? 'PRODUCCIÓN (App)'
        : refUrl === REF_APP_DEV
          ? 'App_dev'
          : 'un proyecto desconocido'
    throw new ErrorDeEntorno(
      `IMPORT_ENTORNO=${entorno} no coincide con VITE_SUPABASE_URL, que apunta a ${aQue}. Se corta sin escribir nada. Revisá el archivo de entorno.`,
    )
  }
  const refClave = refDeClave(claveServicio)
  if (refClave !== null && refClave !== esperado) {
    throw new ErrorDeEntorno(
      'La clave de servicio es de otro proyecto que VITE_SUPABASE_URL. Se corta sin escribir nada.',
    )
  }
  return { entorno, url, claveServicio, ref: refUrl }
}
