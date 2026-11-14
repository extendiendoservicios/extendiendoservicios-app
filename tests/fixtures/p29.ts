// tests/fixtures/p29.ts — P29.6
//
// Piezas compartidas por las pruebas de las observaciones de la dirección del 14 nov (P29).

import { sessionClient } from './scenario.ts'

/**
 * Carga o cambia la observación del turno como lo hace la app (`update_shift_details` con la
 * sesión del dueño): queda en `shift_observations`, nunca en `shifts.notes` (migración 0086).
 * `texto` vacío la borra. La dotación se manda igual a la que ya tiene el turno.
 */
export async function ponerObservacion(
  shiftId: string,
  texto: string,
  requiredStaff = 1,
): Promise<void> {
  const owner = await sessionClient('owner')
  const { error } = await owner.rpc('update_shift_details', {
    p_shift_id: shiftId,
    p_required_staff: requiredStaff,
    p_notes: texto,
  })
  if (error) {
    throw new Error(`No se pudo cargar la observación: ${error.message}`)
  }
}

/**
 * Franja de HOY que arranca dentro de `minutosDesdeAhora` y termina a las 23:59: sirve para los
 * avisos que solo se pueden hacer antes del inicio («Estoy en camino», demora). Devuelve `null`
 * cuando ya no queda margen en el día (el test se saltea: no es un defecto de la app).
 */
export function franjaPorComenzar(
  minutosAhora: number,
  minutosDesdeAhora = 40,
): { start: string; end: string } | null {
  // Redondea hacia arriba a múltiplos de 5 para que el horario sea legible.
  const inicio = Math.ceil((minutosAhora + minutosDesdeAhora) / 5) * 5
  if (inicio > 22 * 60) return null
  const hh = (n: number) =>
    `${String(Math.floor(n / 60)).padStart(2, '0')}:${String(n % 60).padStart(2, '0')}`
  return { start: hh(inicio), end: '23:59' }
}
