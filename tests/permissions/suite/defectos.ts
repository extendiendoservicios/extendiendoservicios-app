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

/** Defectos conocidos por identificador (DEF-P14 se agregó y se corrigió en P21.6c, 0050). */
export const DEFECTOS_CONOCIDOS: Record<string, Defecto> = {
  // P22.5 (módulo B1, 0056/0057 y 0052). Misma familia que DEF-P14: la puerta de la RPC mira
  // `auth.uid()` pero no `is_active`, así que una cuenta desactivada con el token vigente entra.
  'DEF-B1-02': {
    id: 'DEF-B1-02',
    resumen:
      '`accept_location_consent` y `revoke_location_consent` (0056/0057) no miran `is_active`: una cuenta desactivada con el token vigente cambia su consentimiento (CB-18). Gravedad menor.',
  },
  // P25.5c (módulo E, 0070). Las RPC de Insumos prometen errores `P0001` en español con `hint`
  // (database.md, «Insumos y control de stock»), pero un número fuera de rango pasa derecho al motor.
  'DEF-P25-01': {
    id: 'DEF-P25-01',
    resumen:
      'Valores fuera de rango o con formato inválido en `register_stock_entry` (costo unitario), `upsert_supply` (precios y mínimo), `adjust_stock` (delta y motivo) y `register_stock_count` (fecha) devuelven el error crudo del motor (22003, 22P02, 22007, en inglés y sin `hint`) en vez de un `P0001` en español con código. La interfaz los frena antes, así que solo se ve por API directa. Gravedad menor.',
  },
  // P25.5c (módulo E, 0070). El celular limita la descripción del aviso a 200 caracteres, pero el
  // servidor no pone tope a ningún texto libre: un empleado puede guardar cientos de miles de
  // caracteres por API y la administración los carga en Faltantes y Movimientos.
  'DEF-P25-02': {
    id: 'DEF-P25-02',
    resumen:
      '`report_supply_shortage` (descripción y comentario) y `register_withdrawal` (observación) aceptan textos de cualquier largo por API directa; solo la interfaz limita (200 caracteres en la descripción). Sin tope del lado servidor un empleado puede cargar textos enormes. Gravedad menor.',
  },
  'DEF-B1-03': {
    id: 'DEF-B1-03',
    resumen:
      '`geo_distance_m` y `geo_evaluate` (0052) las puede llamar una cuenta desactivada con el token vigente (CB-18). Son funciones puras, no leen ni escriben datos: gravedad informativa; confirmar si es por diseño.',
  },
}

const PERFILES_DESACTIVADOS = ['empleado', 'supervisor', 'admin'] as const

/** Casos de contrato de errores de Insumos (95) que hoy fallan: DEF-P25-01. */
export const CASOS_CONTRATO_INSUMOS = [
  'register_stock_entry · costo unitario fuera de rango',
  'upsert_supply · precio fuera de rango',
  'upsert_supply · mínimo fuera de rango',
  'adjust_stock · cantidad fuera de rango',
  'adjust_stock · motivo inexistente',
  'register_stock_count · fecha inválida',
  'report_supply_shortage · descripción sin tope de largo',
  'report_supply_shortage · comentario sin tope de largo',
] as const

/** Clave de caso -> defecto que lo hace fallar hoy. */
export const DEFECTOS: Record<string, Defecto> = Object.fromEntries([
  ...CASOS_CONTRATO_INSUMOS.map(
    (caso) =>
      [
        claveCaso('insumos', 'contrato', caso),
        DEFECTOS_CONOCIDOS[
          caso.includes('sin tope de largo') ? 'DEF-P25-02' : 'DEF-P25-01'
        ],
      ] as const,
  ),
  ...PERFILES_DESACTIVADOS.flatMap((perfil) => [
    ...['accept_location_consent', 'revoke_location_consent'].map(
      (rpc) =>
        [
          claveCaso('desactivado', 'rpc', rpc, perfil),
          DEFECTOS_CONOCIDOS['DEF-B1-02'],
        ] as const,
    ),
    ...['geo_distance_m', 'geo_evaluate'].map(
      (rpc) =>
        [
          claveCaso('desactivado', 'rpc', rpc, perfil),
          DEFECTOS_CONOCIDOS['DEF-B1-03'],
        ] as const,
    ),
  ]),
])

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
