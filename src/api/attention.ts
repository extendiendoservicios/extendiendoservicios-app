import { supabase } from '@/lib/supabase'
import { fromPostgrestError } from './errors'
import type { AttentionDismissal } from '@/features/dashboard/attention'

/**
 * `src/api/attention.ts` (P29.3, OG-02): avisos cerrados de «Requiere
 * atención» en el Resumen. El cierre es compartido por toda la dirección y la
 * administración: lo guarda `dismiss_attention` (idempotente) y lo deshace
 * `reopen_attention`. La lectura de `attention_dismissals` la permite RLS solo
 * a dueños y administradores.
 */

/** Tipos de aviso que acepta `dismiss_attention` (`0085`). */
export type AttentionDismissKind =
  | 'absence'
  | 'uncovered'
  | 'noRecord'
  | 'noCheckout'
  | 'overdue'
  | 'outsideGeo'
  | 'late'
  | 'delayNotified'

interface DismissalRaw {
  id: string
  kind: string
  shift_id: string
  assignment_id: string | null
  dismissed_by: string
  dismissed_at: string
}

function mapDismissal(row: DismissalRaw): AttentionDismissal {
  return {
    id: row.id,
    kind: row.kind,
    shiftId: row.shift_id,
    assignmentId: row.assignment_id,
    dismissedBy: row.dismissed_by,
    dismissedAt: row.dismissed_at,
  }
}

/** Cierres vigentes (la base limpia los de más de 30 días). */
export async function fetchAttentionDismissals(): Promise<
  AttentionDismissal[]
> {
  const { data, error } = await supabase
    .from('attention_dismissals')
    .select('id, kind, shift_id, assignment_id, dismissed_by, dismissed_at')
    .order('dismissed_at', { ascending: false })
    .limit(1000)
  if (error) {
    throw fromPostgrestError(error)
  }
  return (data ?? []).map((row) => mapDismissal(row))
}

/** Cierra un aviso para toda la dirección y la administración. */
export async function dismissAttention(input: {
  kind: AttentionDismissKind
  shiftId: string
  assignmentId?: string | null
}): Promise<AttentionDismissal> {
  const { data, error } = await supabase.rpc('dismiss_attention', {
    p_kind: input.kind,
    p_shift_id: input.shiftId,
    ...(input.assignmentId ? { p_assignment_id: input.assignmentId } : {}),
  })
  if (error) {
    throw fromPostgrestError(error)
  }
  return mapDismissal(data)
}

/** Vuelve a mostrar un aviso cerrado. */
export async function reopenAttention(id: string): Promise<void> {
  const { error } = await supabase.rpc('reopen_attention', { p_id: id })
  if (error) {
    throw fromPostgrestError(error)
  }
}
