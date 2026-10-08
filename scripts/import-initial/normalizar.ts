// scripts/import-initial/normalizar.ts — DATA-003
//
// Funciones puras de lectura de celdas: texto, números, fechas, horas, Sí/No, listas, CUIT/CUIL.
// Sin dependencias: se prueban sin Excel ni base (ver `normalizar.test.ts`).

import type { Celda } from './tipos.ts'

const MS_POR_DIA = 86_400_000

/** Texto para comparar claves: sin espacios de más y sin distinguir mayúsculas. */
export function claveNorm(texto: string): string {
  return texto.normalize('NFC').trim().replace(/\s+/g, ' ').toLowerCase()
}

/** Igual que `claveNorm` pero además sin tildes (encabezados y listas desplegables). */
export function claveSinTildes(texto: string): string {
  return claveNorm(texto).normalize('NFD').replace(/[̀-ͯ]/g, '')
}

/** Texto de la celda sin espacios de más; `null` si está vacía. Los números enteros no llevan decimales. */
export function texto(celda: Celda): string | null {
  if (celda === null || celda === undefined) return null
  if (typeof celda === 'string') {
    const t = celda.trim()
    return t === '' ? null : t
  }
  if (typeof celda === 'number') {
    return Number.isFinite(celda) ? String(celda) : null
  }
  if (typeof celda === 'boolean') return celda ? 'Sí' : 'No'
  return formatearFecha(celda)
}

function formatearFecha(fecha: Date): string {
  const dd = String(fecha.getUTCDate()).padStart(2, '0')
  const mm = String(fecha.getUTCMonth() + 1).padStart(2, '0')
  return `${dd}/${mm}/${fecha.getUTCFullYear()}`
}

/** Quita puntos, guiones y espacios. */
export function soloDigitos(valor: string): string {
  return valor.replace(/[\s.-]/g, '')
}

export function esSoloDigitos(valor: string): boolean {
  return /^\d+$/.test(valor)
}

// -------------------------------------------------------------------------------------------
// Fechas y horas
// -------------------------------------------------------------------------------------------

function fechaIso(anio: number, mes: number, dia: number): string | null {
  if (anio < 1900 || anio > 2100) return null
  const f = new Date(Date.UTC(anio, mes - 1, dia))
  if (
    f.getUTCFullYear() !== anio ||
    f.getUTCMonth() !== mes - 1 ||
    f.getUTCDate() !== dia
  ) {
    return null
  }
  return `${anio}-${String(mes).padStart(2, '0')}-${String(dia).padStart(2, '0')}`
}

export type ResultadoParseo<T> = { ok: true; valor: T | null } | { ok: false }

/** Fecha como `AAAA-MM-DD`. Acepta fechas de Excel, números de serie y texto `DD/MM/AAAA`. */
export function parsearFecha(celda: Celda): ResultadoParseo<string> {
  if (celda === null || celda === undefined) return { ok: true, valor: null }
  if (celda instanceof Date) {
    if (Number.isNaN(celda.getTime())) return { ok: false }
    const iso = fechaIso(
      celda.getUTCFullYear(),
      celda.getUTCMonth() + 1,
      celda.getUTCDate(),
    )
    return iso ? { ok: true, valor: iso } : { ok: false }
  }
  if (typeof celda === 'number') {
    // Número de serie de Excel (días desde el 30/12/1899).
    if (!Number.isFinite(celda) || celda < 1 || celda > 100_000) {
      return { ok: false }
    }
    return parsearFecha(
      new Date(Date.UTC(1899, 11, 30) + Math.floor(celda) * MS_POR_DIA),
    )
  }
  if (typeof celda === 'boolean') return { ok: false }
  const t = celda.trim()
  if (t === '') return { ok: true, valor: null }
  let m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(t)
  if (m) {
    const iso = fechaIso(Number(m[3]), Number(m[2]), Number(m[1]))
    return iso ? { ok: true, valor: iso } : { ok: false }
  }
  m = /^(\d{4})-(\d{2})-(\d{2})(?:[T ].*)?$/.exec(t)
  if (m) {
    const iso = fechaIso(Number(m[1]), Number(m[2]), Number(m[3]))
    return iso ? { ok: true, valor: iso } : { ok: false }
  }
  return { ok: false }
}

/** Hora como `HH:MM`. Acepta horas de Excel (fracción del día) y texto `H:MM` o `HH:MM`. */
export function parsearHora(celda: Celda): ResultadoParseo<string> {
  if (celda === null || celda === undefined) return { ok: true, valor: null }
  let minutos: number | null = null
  if (celda instanceof Date) {
    if (Number.isNaN(celda.getTime())) return { ok: false }
    const msDelDia = ((celda.getTime() % MS_POR_DIA) + MS_POR_DIA) % MS_POR_DIA
    minutos = Math.round(msDelDia / 60_000)
  } else if (typeof celda === 'number') {
    if (!Number.isFinite(celda) || celda < 0 || celda >= 1) return { ok: false }
    minutos = Math.round(celda * 1440)
  } else if (typeof celda === 'string') {
    const t = celda.trim()
    if (t === '') return { ok: true, valor: null }
    const m = /^(\d{1,2}):(\d{2})(?::\d{2})?$/.exec(t)
    if (!m) return { ok: false }
    const h = Number(m[1])
    const mi = Number(m[2])
    if (h > 23 || mi > 59) return { ok: false }
    minutos = h * 60 + mi
  } else {
    return { ok: false }
  }
  if (minutos >= 1440) return { ok: false } // 24:00 no existe (no se cruza la medianoche).
  const hh = String(Math.floor(minutos / 60)).padStart(2, '0')
  const mm = String(minutos % 60).padStart(2, '0')
  return { ok: true, valor: `${hh}:${mm}` }
}

// -------------------------------------------------------------------------------------------
// Números, Sí/No y listas
// -------------------------------------------------------------------------------------------

/** Número; acepta coma decimal. */
export function parsearNumero(celda: Celda): ResultadoParseo<number> {
  if (celda === null || celda === undefined) return { ok: true, valor: null }
  if (typeof celda === 'number') {
    return Number.isFinite(celda) ? { ok: true, valor: celda } : { ok: false }
  }
  if (typeof celda !== 'string') return { ok: false }
  const t = celda.trim().replace(',', '.')
  if (t === '') return { ok: true, valor: null }
  if (!/^-?\d+(\.\d+)?$/.test(t)) return { ok: false }
  return { ok: true, valor: Number(t) }
}

export function parsearEntero(celda: Celda): ResultadoParseo<number> {
  const r = parsearNumero(celda)
  if (!r.ok || r.valor === null) return r
  return Number.isInteger(r.valor) ? r : { ok: false }
}

/** `Sí` / `No` (también `Si`, `S`, `N`, `true`, `false`); vacío = `null`. */
export function parsearSiNo(celda: Celda): ResultadoParseo<boolean> {
  if (celda === null || celda === undefined) return { ok: true, valor: null }
  if (typeof celda === 'boolean') return { ok: true, valor: celda }
  if (typeof celda !== 'string') return { ok: false }
  const t = claveSinTildes(celda)
  if (t === '') return { ok: true, valor: null }
  if (['si', 's', 'true', 'verdadero'].includes(t))
    return { ok: true, valor: true }
  if (['no', 'n', 'false', 'falso'].includes(t))
    return { ok: true, valor: false }
  return { ok: false }
}

/** Elige un valor de una lista cerrada por su etiqueta en español (sin distinguir mayúsculas ni tildes). */
export function parsearLista<T extends string>(
  celda: Celda,
  etiquetas: Record<string, T>,
): ResultadoParseo<T> {
  const t = texto(celda)
  if (t === null) return { ok: true, valor: null }
  const valor = etiquetas[claveSinTildes(t)]
  return valor ? { ok: true, valor } : { ok: false }
}

// -------------------------------------------------------------------------------------------
// CUIT y CUIL
// -------------------------------------------------------------------------------------------

/**
 * Dígito verificador de un CUIT/CUIL de 11 dígitos (módulo 11 con pesos 5,4,3,2,7,6,5,4,3,2).
 * Cuando el cálculo da 10 la AFIP asigna el prefijo 23 y el dígito 9 (hombres) o 4 (mujeres): se
 * acepta ese caso. Es una ayuda para detectar errores de tipeo, no un requisito de la base.
 */
export function verificadorValido(cuit: string): boolean {
  if (!/^\d{11}$/.test(cuit)) return false
  const pesos = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2]
  const suma = pesos.reduce((acc, p, i) => acc + p * Number(cuit[i]), 0)
  const resto = suma % 11
  const digito = Number(cuit[10])
  if (resto === 0) return digito === 0
  if (resto === 1)
    return cuit.startsWith('23') && (digito === 9 || digito === 4)
  return digito === 11 - resto
}

/** Un email razonable: algo@dominio.ext, sin espacios. */
export function emailValido(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
}
