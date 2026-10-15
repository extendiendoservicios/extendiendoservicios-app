import {
  keepPreviousData,
  useInfiniteQuery,
  useMutation,
  useQueries,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query'
import * as mediaApi from '@/api/mediaAdmin'
import type { ShiftMediaFilters, ShiftMediaRow } from '@/api/mediaAdmin'

/**
 * Hooks de TanStack Query de la evidencia fotográfica (módulo H, P21.4).
 * Patrón de `src/api/README.md`.
 *
 * - Listas: polling de 60 s (regla común); formularios, sin polling.
 * - Las URL firmadas viven aparte de las filas y NO se vuelven a pedir con el
 *   polling: si cambiaran cada minuto, el navegador volvería a bajar todas
 *   las miniaturas. Se renuevan solas antes de vencer (`THUMB_URL_TTL_SECONDS`).
 */
const LIST_POLLING_MS = 60_000
/** Un poco menos que la vida de la URL firmada, para renovarla antes de que falle. */
const THUMB_STALE_MS = (mediaApi.THUMB_URL_TTL_SECONDS - 5 * 60) * 1000

export const mediaKeys = {
  all: ['media'] as const,
  list: (filters: ShiftMediaFilters) =>
    [...mediaKeys.all, 'list', filters] as const,
  byShift: (shiftId: string) => [...mediaKeys.all, 'shift', shiftId] as const,
  bySupervision: (supervisionId: string) =>
    [...mediaKeys.all, 'supervision', supervisionId] as const,
  thumbs: (signature: string) =>
    [...mediaKeys.all, 'thumbs', signature] as const,
  shiftTimes: (ids: string) => [...mediaKeys.all, 'shiftTimes', ids] as const,
  usage: () => [...mediaKeys.all, 'usage'] as const,
  retention: () => [...mediaKeys.all, 'retention'] as const,
}

/** ADM-32: filas por páginas ("Ver más"), de la más reciente a la más antigua. */
export function useShiftMediaListQuery(filters: ShiftMediaFilters) {
  return useInfiniteQuery({
    queryKey: mediaKeys.list(filters),
    queryFn: ({ pageParam }) =>
      mediaApi.fetchShiftMediaPage(filters, pageParam),
    initialPageParam: 0,
    getNextPageParam: (last) => (last.hasMore ? last.page + 1 : undefined),
    placeholderData: keepPreviousData,
    refetchInterval: LIST_POLLING_MS,
  })
}

/** ADM-06: todo lo del turno. */
export function useShiftMediaByShiftQuery(shiftId: string | undefined) {
  return useQuery({
    queryKey: mediaKeys.byShift(shiftId ?? ''),
    queryFn: () => mediaApi.fetchShiftMediaByShift(shiftId as string),
    enabled: shiftId != null,
    refetchInterval: LIST_POLLING_MS,
  })
}

/** ADM-15: lo que subió el supervisor. */
export function useShiftMediaBySupervisionQuery(
  supervisionId: string | undefined,
) {
  return useQuery({
    queryKey: mediaKeys.bySupervision(supervisionId ?? ''),
    queryFn: () =>
      mediaApi.fetchShiftMediaBySupervision(supervisionId as string),
    enabled: supervisionId != null,
    refetchInterval: LIST_POLLING_MS,
  })
}

/** Cuántas rutas se firman por llamada: una por página de ADM-32. */
export const THUMB_CHUNK_SIZE = mediaApi.MEDIA_PAGE_SIZE

/**
 * URL firmadas de las miniaturas, de a `THUMB_CHUNK_SIZE` por llamada. La
 * clave depende de los ids del grupo, no de un nuevo pedido por cada
 * refresco de las filas, así que la misma miniatura mantiene su URL.
 */
export function useThumbUrls(rows: readonly ShiftMediaRow[]) {
  const withFile = rows.filter((row) => row.hasFile)
  const chunks: ShiftMediaRow[][] = []
  for (let i = 0; i < withFile.length; i += THUMB_CHUNK_SIZE) {
    chunks.push(withFile.slice(i, i + THUMB_CHUNK_SIZE))
  }
  const results = useQueries({
    queries: chunks.map((chunk) => ({
      queryKey: mediaKeys.thumbs(chunk.map((row) => row.id).join(',')),
      queryFn: () => mediaApi.createThumbSignedUrls(chunk),
      staleTime: THUMB_STALE_MS,
      gcTime: mediaApi.THUMB_URL_TTL_SECONDS * 1000,
      refetchOnWindowFocus: false,
      refetchOnReconnect: false,
    })),
  })
  const merged: mediaApi.SignedUrlMap = new Map()
  for (const result of results) {
    for (const [path, url] of result.data ?? []) merged.set(path, url)
  }
  return merged
}

/**
 * Franjas horarias de los turnos de las filas, en una sola consulta en lote.
 * Las horas de un turno casi no cambian: se cachean 5 minutos.
 */
export function useShiftTimes(rows: readonly ShiftMediaRow[]) {
  const ids = Array.from(new Set(rows.map((row) => row.shiftId))).sort()
  return useQuery({
    queryKey: mediaKeys.shiftTimes(ids.join(',')),
    queryFn: () => mediaApi.fetchShiftTimes(ids),
    enabled: ids.length > 0,
    staleTime: 5 * 60_000,
    select: (data) => new Map(data.map((times) => [times.shiftId, times])),
  })
}

/** Medidor de espacio. `poll`: ADM-32 lo actualiza cada 60 s; el aviso del Resumen, también. */
export function useStorageUsageQuery(options: { poll?: boolean } = {}) {
  return useQuery({
    queryKey: mediaKeys.usage(),
    queryFn: mediaApi.fetchStorageUsage,
    staleTime: LIST_POLLING_MS,
    refetchInterval: options.poll ? LIST_POLLING_MS : false,
  })
}

/** Plazos vigentes (ADM-28). */
export function useMediaRetentionQuery() {
  return useQuery({
    queryKey: mediaKeys.retention(),
    queryFn: mediaApi.fetchMediaRetention,
  })
}

export function useSetMediaRetentionMutation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: Partial<mediaApi.MediaRetention>) =>
      mediaApi.setMediaRetention(input),
    // Un plazo nuevo cambia el «vence el» de todo lo guardado (H-17).
    onSuccess: () =>
      void queryClient.invalidateQueries({ queryKey: mediaKeys.all }),
  })
}

export function useSetMediaKeepMutation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ mediaId, keep }: { mediaId: string; keep: boolean }) =>
      mediaApi.setShiftMediaKeep(mediaId, keep),
    onSuccess: () =>
      void queryClient.invalidateQueries({
        queryKey: mediaKeys.all,
        // Las URL firmadas siguen valiendo: no se piden de nuevo.
        predicate: (query) => query.queryKey[1] !== 'thumbs',
      }),
  })
}

/**
 * Después de eliminar o cambiar «Conservar» de a varias: se refrescan la
 * galería, el detalle del turno y el medidor (`usage`, que cuelga de
 * `mediaKeys.all`). Las URL firmadas siguen valiendo y no se piden de nuevo.
 */
function invalidateMedia(queryClient: ReturnType<typeof useQueryClient>) {
  return queryClient.invalidateQueries({
    queryKey: mediaKeys.all,
    predicate: (query) => query.queryKey[1] !== 'thumbs',
  })
}

export function useSetMediaKeepManyMutation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ ids, keep }: { ids: readonly string[]; keep: boolean }) =>
      mediaApi.setShiftMediaKeepMany(ids, keep),
    onSuccess: () => void invalidateMedia(queryClient),
  })
}

export function useDeleteShiftMediaMutation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (ids: readonly string[]) => mediaApi.deleteShiftMedia(ids),
    // También si falló a la mitad de varios lotes: lo ya eliminado no vuelve.
    onSettled: () => void invalidateMedia(queryClient),
  })
}
