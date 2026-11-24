import type { OwnerDeleteResult } from '@/api/ownerDelete'
import type { ServiceStatus } from '@/api/services'
import { todayInBuenosAires } from '@/features/employees/employeeLeaveStatus'
import { addDaysToIsoDate } from '@/features/settings/dateOnly'

/**
 * Finalizar o pausar un servicio (P31.3, D-03): lógica sin React de lo que
 * pasa con sus turnos futuros. Solo la dirección los elimina (OD-22); el
 * administrador ve cuántos quedan.
 */

/** Fecha por omisión de «Eliminar los turnos desde»: mañana (hora de Buenos Aires). */
export function defaultDeleteFromDate(now: Date = new Date()): string {
  return addDaysToIsoDate(todayInBuenosAires(now), 1)
}

/** El estado nuevo deja de generar turnos, así que ofrece limpiar los que ya existen. */
export function statusOffersShiftCleanup(status: ServiceStatus): boolean {
  return status === 'paused' || status === 'ended'
}

/**
 * Texto de efecto de cada estado. «Pausado» y «Finalizado» no dicen que los
 * turnos no se tocan cuando la dirección va a eliminarlos.
 */
export function statusEffectDescription(
  status: ServiceStatus,
  deletingShifts: boolean,
): string {
  switch (status) {
    case 'active':
      return 'El servicio vuelve a generar turnos nuevos al ejecutar "Generar turnos del mes". Los turnos ya generados no cambian.'
    case 'paused':
      return deletingShifts
        ? 'Deja de generar turnos nuevos hasta que se reactive. Se eliminan los turnos sin historia desde la fecha elegida; los que tienen fichajes u otros registros quedan.'
        : 'Deja de generar turnos nuevos hasta que se reactive. Los turnos ya generados quedan como están.'
    case 'ended':
      return deletingShifts
        ? 'El servicio se da por finalizado y no genera turnos nuevos. Se eliminan los turnos sin historia desde la fecha elegida; los que tienen fichajes u otros registros quedan.'
        : 'El servicio se da por finalizado y no genera turnos nuevos. Los turnos ya generados quedan como están.'
  }
}

/** Aviso del administrador: quedan turnos futuros que solo la dirección puede eliminar. */
export function futureShiftsNotice(count: number): string | null {
  if (count <= 0) {
    return null
  }
  return count === 1
    ? 'Queda 1 turno futuro. La dirección puede eliminarlo.'
    : `Quedan ${count} turnos futuros. La dirección puede eliminarlos.`
}

/** Resultado de la eliminación: cuántos se eliminaron y cuántos quedaron por tener historia. */
export function shiftCleanupMessage(result: OwnerDeleteResult): string {
  const deleted = result.deleted.shifts ?? 0
  const kept = result.skippedCount
  const first = `Eliminamos ${deleted} ${deleted === 1 ? 'turno' : 'turnos'}.`
  if (kept <= 0) {
    return first
  }
  return `${first} ${
    kept === 1
      ? 'Quedó 1 turno por tener historia.'
      : `Quedaron ${kept} turnos por tener historia.`
  }`
}
