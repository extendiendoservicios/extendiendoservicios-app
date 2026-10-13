import { useMemo } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import * as mediaApi from '@/api/media'
import { mySupervisionsKeys } from '@/api/mySupervisions'
import { employeeKeys } from './queries'

/**
 * Hooks de TanStack Query de la evidencia fotográfica del celular (módulo H,
 * P21.3), compartidos por la vía del empleado (EMP-07, EMP-10, EMP-11) y la
 * del supervisor (SUP-03, SUP-04). Patrón de `src/api/README.md`.
 *
 * Después de subir o quitar se invalidan `v_my_day` y `v_my_supervisions`:
 * de ahí salen `my_photos_count` y `my_videos_count` que alimentan los
 * contadores («3 de 10 fotos») y el aviso de EMP-10.
 */

/** Las URL firmadas de las miniaturas viven 10 min: se renuevan antes de que venzan. */
const MY_MEDIA_STALE_MS = 5 * 60_000

export const mediaKeys = {
  all: ['myMedia'] as const,
  shift: (shiftId: string, userId: string) =>
    [...mediaKeys.all, shiftId, userId] as const,
}

/** Lo que subió la persona en el turno, con miniaturas firmadas. */
export function useMyShiftMediaQuery(
  shiftId: string,
  userId: string | null | undefined,
) {
  return useQuery({
    queryKey: mediaKeys.shift(shiftId, userId ?? ''),
    queryFn: () => mediaApi.fetchMyShiftMedia(shiftId, userId as string),
    enabled: Boolean(shiftId) && Boolean(userId),
    staleTime: MY_MEDIA_STALE_MS,
  })
}

/**
 * Refresca todo lo que depende de lo subido. Devuelve la promesa de la
 * recarga: `MediaCapture` espera la de `onUploaded` antes de dar la subida
 * por terminada, así el contador ya viene actualizado.
 */
export function useRefreshMyMedia() {
  const queryClient = useQueryClient()
  return useMemo(
    () => () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: mediaKeys.all }),
        queryClient.invalidateQueries({ queryKey: employeeKeys.myDay() }),
        queryClient.invalidateQueries({ queryKey: mySupervisionsKeys.all }),
      ]).then(() => undefined),
    [queryClient],
  )
}

/** Función de subida de un turno (estable mientras no cambie el turno). */
export function useShiftMediaUpload(shiftId: string) {
  return useMemo(() => mediaApi.createShiftMediaUpload(shiftId), [shiftId])
}

/** «Quitar» (H-15). */
export function useRemoveShiftMediaMutation() {
  const refresh = useRefreshMyMedia()
  return useMutation({
    mutationFn: mediaApi.removeShiftMedia,
    onSuccess: refresh,
  })
}
