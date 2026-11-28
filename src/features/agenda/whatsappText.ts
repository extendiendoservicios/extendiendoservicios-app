import { format } from 'date-fns'
import { es } from 'date-fns/locale'
import type { DailyStaffEntry } from './dailyList'

/**
 * Texto del parte diario para pegar en el grupo de WhatsApp (AG-25). Sin
 * React, para probarlo. Formato:
 *
 *     LUNES 16 DE NOVIEMBRE
 *     👏 2 0 2 6 👏
 *
 *     0️⃣2️⃣*MIGUEL CABALLINI*
 *     VENTAS Y COORDINADOR DE TRABAJOS ESPECIALES
 *     ▪️7 A 11 MERCED 1358 (VIDRIOS)
 *
 * El legajo va con emojis keycap, el nombre en mayúsculas entre asteriscos
 * (negrita de WhatsApp), el renglón fijo sin viñeta y un «▪️» por cada
 * renglón automático (turnos y licencias) o libre. Una línea en blanco entre
 * personas. La jornada y las supervisiones del coordinador no van.
 */

const KEYCAP = '️⃣'
const BULLET = '▪️'

/** «15» → «1️⃣5️⃣». */
export function keycapNumber(label: string): string {
  return [...label].map((digit) => `${digit}${KEYCAP}`).join('')
}

/** «LUNES 16 DE NOVIEMBRE» para una fecha `YYYY-MM-DD`. */
export function whatsappDateHeading(isoDate: string): string {
  const date = new Date(
    Number(isoDate.slice(0, 4)),
    Number(isoDate.slice(5, 7)) - 1,
    Number(isoDate.slice(8, 10)),
  )
  return format(date, "EEEE d 'de' MMMM", { locale: es }).toUpperCase()
}

/** «👏 2 0 2 6 👏»: el año con los dígitos separados. */
export function whatsappYearLine(isoDate: string): string {
  return `👏 ${[...isoDate.slice(0, 4)].join(' ')} 👏`
}

/** Las líneas de una persona: nombre, renglón fijo y renglones con viñeta. */
export function whatsappPersonLines(entry: DailyStaffEntry): string[] {
  const lines = [
    `${keycapNumber(entry.numberLabel)}*${entry.name.toUpperCase()}*`,
  ]
  if (entry.fixedLine) {
    lines.push(entry.fixedLine)
  }
  for (const line of entry.autoLines) {
    lines.push(`${BULLET}${line.text}`)
  }
  for (const line of entry.freeLines) {
    lines.push(`${BULLET}${line.body}`)
  }
  return lines
}

export function buildWhatsAppText(
  day: string,
  entries: DailyStaffEntry[],
): string {
  const blocks = entries.map((entry) => whatsappPersonLines(entry).join('\n'))
  return [
    `${whatsappDateHeading(day)}\n${whatsappYearLine(day)}`,
    ...blocks,
  ].join('\n\n')
}
