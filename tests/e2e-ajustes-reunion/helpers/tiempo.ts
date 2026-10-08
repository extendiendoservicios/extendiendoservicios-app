// tests/e2e-ajustes-reunion/helpers/tiempo.ts — P19.5d
//
// Turnos de HOY armados "desde ahora" (hora de Argentina) y recortados al día del turno, porque
// los estados que se prueban acá (En camino, Llegada tarde, Sin registro) dependen de cuánto falta
// o cuánto pasó desde el inicio. Un turno no cruza la medianoche (`shifts_time_range_check`):
// cada caso declara qué franja horaria necesita y, si la hora de la corrida no lo permite, el test
// se saltea con un motivo explícito (nunca se inventa un reloj falso).

import { minutesSinceMidnightAR } from '../../fixtures/dates.ts'
import { hhmm } from '../../fixtures/movil.ts'

const ULTIMO_MINUTO = 23 * 60 + 59

export interface FranjaDesdeAhora {
  start: string
  end: string
  /** Minutos desde las 0:00 de Argentina cuando se armó la franja. */
  ahora: number
}

/**
 * Franja de hoy que empieza `inicioOffset` minutos desde ahora (negativo: ya empezó) y dura
 * `duracion` minutos, con el fin recortado a las 23:59. Corta si el inicio cae fuera de hoy.
 */
export function franjaDesdeAhora(
  inicioOffset: number,
  duracion: number,
): FranjaDesdeAhora {
  const ahora = minutesSinceMidnightAR()
  const inicio = ahora + inicioOffset
  if (inicio < 0 || inicio >= ULTIMO_MINUTO) {
    throw new Error(
      `La franja con inicio a ${inicioOffset} min de ahora (${hhmm(ahora)}) cae fuera de hoy: el test tendría que haberse salteado antes.`,
    )
  }
  const fin = Math.min(ULTIMO_MINUTO, inicio + duracion)
  return { start: hhmm(inicio), end: hhmm(fin), ahora }
}

/** Motivo de salteo si a esta hora no se puede armar un turno que empiece dentro de `minutos` (y dure `duracion`). */
export function faltaMargenHaciaAdelante(
  minutos: number,
  duracion = 30,
): string | null {
  const ahora = minutesSinceMidnightAR()
  return ahora + minutos + duracion > ULTIMO_MINUTO - 6
    ? `Son las ${hhmm(ahora)} en Argentina: no queda margen en el día para un turno que empiece dentro de ${minutos} min y dure ${duracion} (un turno no cruza la medianoche). Se saltea explícito.`
    : null
}

/** Motivo de salteo si a esta hora no se puede armar un turno que empezó hace `minutos`. */
export function faltaMargenHaciaAtras(minutos: number): string | null {
  const ahora = minutesSinceMidnightAR()
  return ahora - minutos < 1
    ? `Son las ${hhmm(ahora)} en Argentina: todavía no pasaron ${minutos} min desde las 0:00, así que un turno que empezó hace ${minutos} min tendría que empezar ayer. Se saltea explícito.`
    : ahora > ULTIMO_MINUTO - 6
      ? `Son las ${hhmm(ahora)} en Argentina: faltan menos de 6 min para la medianoche y el "hoy" de las pantallas cambia durante la corrida. Se saltea explícito.`
      : null
}

/** `HH:MM` en hora de Argentina de un instante ISO (para comparar con lo que muestra la pantalla). */
export function horaArgentina(iso: string): string {
  return new Intl.DateTimeFormat('es-AR', {
    timeZone: 'America/Argentina/Buenos_Aires',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(iso))
}
