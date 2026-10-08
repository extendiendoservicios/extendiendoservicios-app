// tests/e2e-ajustes-reunion/helpers/aviso.ts — P19.5h
//
// Avisos «en camino» con la hora estimada controlada. La RPC `notify_on_the_way` siempre fecha la
// estimación en el futuro (ahora + minutos), así que para probar el vencimiento (hora estimada +
// 15 min) se crea el aviso con la RPC, con la sesión del empleado, y después se corre
// `estimated_arrival_at` con la clave de servicio (mismo recurso que `jornada.ts` con
// `recorded_at`).

import { expect } from '@playwright/test'
import { getAdminDb } from '../../fixtures/accounts.ts'
import { sessionClient } from '../../fixtures/scenario.ts'

export type Empleado = 'empleado1' | 'empleado2' | 'empleado3' | 'empleado4'

export interface AvisoFechado {
  /**
   * Minutos desde ahora hasta la hora estimada (negativo: ya pasó). `null`: aviso sin
   * estimación («No sé / sin estimar»).
   */
  llegaEnMin: number | null
}

/** Crea el aviso «en camino» con la RPC y le fecha la estimación. Devuelve el id del aviso. */
export async function avisarEnCaminoFechado(
  who: Empleado,
  assignmentId: string,
  aviso: AvisoFechado,
): Promise<string> {
  const empleado = await sessionClient(who)
  const { data, error } = await empleado.rpc('notify_on_the_way', {
    p_assignment_id: assignmentId,
    p_eta_minutes: aviso.llegaEnMin === null ? undefined : 10,
  })
  expect(error, error?.message).toBeNull()
  const id = (data as { id: string }).id
  if (aviso.llegaEnMin !== null) {
    const llega = new Date(Date.now() + aviso.llegaEnMin * 60_000).toISOString()
    const { error: errorFecha } = await getAdminDb()
      .from('attendance_notices')
      .update({ estimated_arrival_at: llega })
      .eq('id', id)
    expect(errorFecha, errorFecha?.message).toBeNull()
  }
  return id
}
