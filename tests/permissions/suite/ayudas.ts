// tests/permissions/suite/ayudas.ts — TEST-019 (P18.3)
//
// Utilidades de la matriz: acceso a tablas por nombre (sin `any`), el criterio de "denegado" y
// el de "pasó la puerta de rol".

import type { PostgrestError } from '@supabase/supabase-js'
import type { Db } from './contexto.ts'

export interface Resultado {
  data: unknown
  error: PostgrestError | null
}

export interface Consulta extends PromiseLike<Resultado> {
  select(columnas?: string): Consulta
  eq(columna: string, valor: unknown): Consulta
  in(columna: string, valores: readonly unknown[]): Consulta
  limit(cantidad: number): Consulta
}

export interface Tabla {
  select(columnas?: string): Consulta
  insert(fila: Record<string, unknown>): Consulta
  update(parche: Record<string, unknown>): Consulta
  delete(): Consulta
}

/** Tabla o vista por nombre: la matriz se arma con los nombres del inventario. */
export function tabla(db: Db, nombre: string): Tabla {
  return db.from(nombre as 'profiles') as unknown as Tabla
}

export type Fila = Record<string, unknown>

export function filas(res: Resultado): Fila[] {
  return Array.isArray(res.data) ? (res.data as Fila[]) : []
}

/**
 * La operación fue rechazada: error de permisos (`42501`, tanto "permission denied" por grants
 * como "violates row-level security"), `FORBIDDEN` de una RPC o del trigger de columnas, o una
 * respuesta sin ninguna fila afectada (RLS filtra `update`/`delete` sin error).
 */
export function denegado(res: Resultado): boolean {
  if (res.error) {
    return (
      res.error.code === '42501' ||
      res.error.hint === 'FORBIDDEN' ||
      /permission denied|row-level security/i.test(res.error.message)
    )
  }
  return filas(res).length === 0
}

/** Describe el resultado para el mensaje de falla (sin imprimir filas completas). */
export function describir(res: Resultado): string {
  if (res.error) {
    return `error ${res.error.code} hint=${res.error.hint ?? '-'}: ${res.error.message}`
  }
  return `${filas(res).length} fila(s)`
}

/** Una columna de las filas devueltas, como conjunto de textos. */
export function claves(res: Resultado, columna: string): Set<string> {
  return new Set(filas(res).map((f) => String(f[columna])))
}
