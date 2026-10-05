// tests/permissions/suite/defectos.ts — TEST-019 (P18.3), limpiado en P18.6
//
// Casos de la matriz que FALLAN por un defecto de la app (no de la prueba). Regla del encargo:
// no se ajusta la prueba al defecto. El caso se marca con `it.fails` (Vitest lo da por bueno
// mientras siga fallando y AVISA cuando el defecto se corrija: ahí hay que sacarlo de esta
// lista) y lleva el identificador del defecto en el título.
//
// En P18.6 (migración 0030 y Edge Function admin-users) se corrigieron los trece defectos de la
// matriz (DEF-P01 a DEF-P13, entre ellos SEG-01 = DEF-P07 y SEG-08 = DEF-P11): todos los casos
// pasaron a `it` común y esta lista quedó vacía. El mecanismo se conserva para el próximo
// defecto que aparezca: se agrega la entrada en `D`, la lista de claves en `DEFECTOS` y el caso
// vuelve a registrarse como `it.fails`.
//
// La clave es `claveCaso(...)`: `<área> · <objeto> · <operación> · <perfil>`.

import { it } from 'vitest'

export interface Defecto {
  id: string
  resumen: string
}

export function claveCaso(...partes: string[]): string {
  return partes.join(' · ')
}

/** Defectos conocidos por identificador. Vacío desde P18.6. */
export const DEFECTOS_CONOCIDOS: Record<string, Defecto> = {}

/** Clave de caso -> defecto que lo hace fallar hoy. Vacío desde P18.6. */
export const DEFECTOS: Record<string, Defecto> = {}

export function defectoDe(clave: string): Defecto | undefined {
  return DEFECTOS[clave]
}

/** Lista de los defectos conocidos (para el resumen del final de la corrida). */
export function listaDeDefectos(): Defecto[] {
  return Object.values(DEFECTOS_CONOCIDOS)
}

/** Registra un caso: `it.fails` si hay un defecto conocido para su clave, `it` si no. */
export function caso(
  clave: string,
  base: string,
  fn: () => Promise<void>,
): void {
  const d = DEFECTOS[clave]
  if (d) it.fails(`[${d.id}] ${base}`, fn)
  else it(base, fn)
}
