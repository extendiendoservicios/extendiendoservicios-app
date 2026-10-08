// tests/e2e-ajustes-reunion/helpers/jornada.ts — P19.5d
//
// Jornadas con horas reales controladas: el empleado ficha de verdad (RPC con su sesión, para que
// la asignación y el turno cambien de estado como en producción) y después se corren los
// `recorded_at` a la hora de pared que pide el caso. Así los minutos trabajados no dependen de
// cuándo corre la prueba ni de cuánto tarda (mismo recurso que `asistencia-cierre.admin.ts`).

import { getAdminDb, type FixedAccountKey } from '../../fixtures/accounts.ts'
import { todayAR } from '../../fixtures/dates.ts'
import { fichar } from '../../fixtures/movil.ts'

export interface Jornada {
  /** Hora de pared del inicio, `HH:MM:SS` (Argentina, hoy). */
  entrada: string
  /** Hora de pared del fin, `HH:MM:SS`; sin ella la jornada queda «en curso». */
  salida?: string
}

async function fecharRegistro(
  assignmentId: string,
  kind: 'check_in' | 'check_out',
  horaPared: string,
): Promise<void> {
  const { error } = await getAdminDb()
    .from('attendance_records')
    .update({ recorded_at: `${todayAR()}T${horaPared}-03:00` })
    .eq('assignment_id', assignmentId)
    .eq('kind', kind)
  if (error) {
    throw new Error(`No se pudo fechar el ${kind}: ${error.message}`)
  }
}

/** Ficha inicio (y fin, si hay) con la sesión del empleado y deja las horas pedidas. */
export async function registrarJornada(
  who: FixedAccountKey,
  assignmentId: string,
  jornada: Jornada,
): Promise<void> {
  await fichar(who, assignmentId, 'inicio')
  if (jornada.salida) {
    await fichar(who, assignmentId, 'fin')
  }
  // Primero el inicio: el fin real quedó "ahora" y el inicio nuevo es anterior.
  await fecharRegistro(assignmentId, 'check_in', jornada.entrada)
  if (jornada.salida) {
    await fecharRegistro(assignmentId, 'check_out', jornada.salida)
  }
}
