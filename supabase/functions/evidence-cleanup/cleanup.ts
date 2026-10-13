// Lógica del barrido nocturno de evidencia (módulo H, H-08, P21.1). Sin dependencias: recibe un
// cliente con la forma mínima que usa (rpc + storage.remove), así se prueba con un cliente simulado.
//
// Qué hace, en lotes:
//   1. Pide a la base los archivos a borrar (RPC `evidence_cleanup_candidates`, solo service_role):
//      vencidos por plazo y tipo (salvo «Conservar»), quitados por su autor y subidas pendientes de
//      más de 24 h. La regla de vencimiento vive en SQL, con el plazo vigente de `company_settings`.
//   2. Borra los archivos y las miniaturas con la API de Storage (SQL no puede borrar objetos).
//   3. Solo si el borrado salió bien, marca las filas (RPC `evidence_cleanup_mark`: `expired_at`).
// Si algo falla corta el lote sin marcar nada: la próxima corrida reintenta lo mismo.

export type CleanupReason = 'expired' | 'removed' | 'pending_stale'

export interface CleanupCandidate {
  media_id: string
  storage_path: string
  thumb_path: string
  reason: CleanupReason
}

interface RpcResult {
  data: unknown
  error: { message: string } | null
}

export interface CleanupClient {
  rpc(fn: string, args?: Record<string, unknown>): PromiseLike<RpcResult>
  storage: {
    from(bucket: string): {
      remove(paths: string[]): PromiseLike<RpcResult>
    }
  }
}

export interface CleanupSummary {
  batches: number
  expired: number
  removed: number
  pending_stale: number
  files_requested: number
  rows_marked: number
  invalid_paths: number
  errors: string[]
  /** true si ya no quedan candidatos (o se llegó al final de la lista) */
  complete: boolean
}

export const EVIDENCE_BUCKET = 'evidence'

// {shift_id}/{media_id}.{jpg|mp4|webm} y {shift_id}/{media_id}_thumb.jpg. Defensa en profundidad: la
// función nunca borra algo que no tenga la forma de una ruta de evidencia.
const PATH_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(_thumb\.jpg|\.jpg|\.mp4|\.webm)$/

export function isEvidencePath(path: unknown): path is string {
  return typeof path === 'string' && PATH_PATTERN.test(path)
}

const MAX_IDS_IN_ERROR = 10

// Registra un error del barrido. La respuesta HTTP (que lee el workflow y queda en sus logs) solo lleva
// la etapa, un mensaje genérico y los ids de las filas afectadas; el detalle interno (texto de Postgres o
// de Storage, que puede traer rutas) va únicamente al log de la función.
function fail(
  summary: CleanupSummary,
  stage: string,
  message: string,
  detail?: string,
  mediaIds: string[] = [],
): void {
  console.error(`[evidence-cleanup] ${stage}: ${detail ?? message}`, {
    media_ids: mediaIds,
  })
  const ids = mediaIds.slice(0, MAX_IDS_IN_ERROR)
  const more = mediaIds.length - ids.length
  const suffix = ids.length
    ? ` Filas: ${ids.join(', ')}${more > 0 ? ` y ${more} más` : ''}.`
    : ''
  summary.errors.push(`${stage}: ${message}${suffix}`)
}

export async function runCleanup(
  client: CleanupClient,
  options: { batchSize?: number; maxBatches?: number } = {},
): Promise<CleanupSummary> {
  const batchSize = options.batchSize ?? 200
  const maxBatches = options.maxBatches ?? 20
  const summary: CleanupSummary = {
    batches: 0,
    expired: 0,
    removed: 0,
    pending_stale: 0,
    files_requested: 0,
    rows_marked: 0,
    invalid_paths: 0,
    errors: [],
    complete: false,
  }

  for (let i = 0; i < maxBatches; i++) {
    const { data, error } = await client.rpc('evidence_cleanup_candidates', {
      p_limit: batchSize,
    })
    if (error) {
      fail(
        summary,
        'READ_CANDIDATES',
        'No se pudieron leer los candidatos.',
        error.message,
      )
      return summary
    }
    const rows = (Array.isArray(data) ? data : []) as CleanupCandidate[]
    if (rows.length === 0) {
      summary.complete = true
      return summary
    }
    summary.batches++

    // Solo las filas con rutas válidas se borran y se marcan.
    const valid = rows.filter(
      (r) => isEvidencePath(r.storage_path) && isEvidencePath(r.thumb_path),
    )
    summary.invalid_paths += rows.length - valid.length
    if (valid.length === 0) {
      fail(
        summary,
        'INVALID_PATHS',
        'Todos los candidatos del lote tienen rutas inválidas; no se borró nada.',
        undefined,
        rows.map((r) => r.media_id),
      )
      return summary
    }

    const paths = valid.flatMap((r) => [r.storage_path, r.thumb_path])
    const removal = await client.storage.from(EVIDENCE_BUCKET).remove(paths)
    if (removal.error) {
      fail(
        summary,
        'STORAGE_REMOVE',
        'No se pudieron borrar los archivos de Storage.',
        removal.error.message,
        valid.map((r) => r.media_id),
      )
      return summary
    }
    summary.files_requested += paths.length

    const marked = await client.rpc('evidence_cleanup_mark', {
      p_ids: valid.map((r) => r.media_id),
    })
    if (marked.error) {
      fail(
        summary,
        'MARK_ROWS',
        'Se borraron los archivos pero no se pudieron marcar las filas.',
        marked.error.message,
        valid.map((r) => r.media_id),
      )
      return summary
    }
    const count = typeof marked.data === 'number' ? marked.data : 0
    summary.rows_marked += count

    for (const r of valid) summary[r.reason]++

    if (count === 0) {
      fail(
        summary,
        'MARK_NONE',
        'El lote no marcó ninguna fila; se corta para no repetirlo.',
        undefined,
        valid.map((r) => r.media_id),
      )
      return summary
    }
    if (rows.length < batchSize) {
      summary.complete = true
      return summary
    }
  }
  return summary
}
