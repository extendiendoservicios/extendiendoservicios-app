import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  ANNOUNCEMENT_NOT_AVAILABLE,
  acknowledgeAnnouncement,
  fetchMyAnnouncements,
  type MyAnnouncement,
} from '@/api/myAnnouncements'
import { isApiError } from '@/api/errors'

/** Hooks de TanStack Query de los anuncios del celular (AJ2-03). */

export const myAnnouncementsKey = ['announcements', 'mine'] as const

const STALE_MS = 60_000

/** Anuncios vigentes de la sesión. Refresca al volver a la app. */
export function useMyAnnouncementsQuery() {
  return useQuery({
    queryKey: myAnnouncementsKey,
    queryFn: fetchMyAnnouncements,
    staleTime: STALE_MS,
    refetchOnWindowFocus: true,
    retry: 1,
  })
}

/** Los pendientes (sin "Entendido" para la versión actual del texto). */
export function pendingOf(list: MyAnnouncement[] | undefined) {
  return (list ?? []).filter((a) => a.readAt === null)
}

/**
 * "Entendido" con actualización optimista: la tarjeta sale al instante; si
 * falla se restaura la lista. Si el anuncio ya no está disponible, se lo
 * saca de la lista (no se restaura) y el error llega al llamador.
 */
export function useAcknowledgeAnnouncementMutation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => acknowledgeAnnouncement(id),
    onMutate: async (id: string) => {
      await queryClient.cancelQueries({ queryKey: myAnnouncementsKey })
      const previous =
        queryClient.getQueryData<MyAnnouncement[]>(myAnnouncementsKey)
      queryClient.setQueryData<MyAnnouncement[]>(myAnnouncementsKey, (old) =>
        (old ?? []).map((a) =>
          a.id === id ? { ...a, readAt: new Date().toISOString() } : a,
        ),
      )
      return { previous }
    },
    onError: (error, id, context) => {
      if (isApiError(error) && error.hint === ANNOUNCEMENT_NOT_AVAILABLE) {
        queryClient.setQueryData<MyAnnouncement[]>(myAnnouncementsKey, (old) =>
          (context?.previous ?? old ?? []).filter((a) => a.id !== id),
        )
      } else if (context?.previous) {
        queryClient.setQueryData(myAnnouncementsKey, context.previous)
      }
    },
    onSettled: () =>
      queryClient.invalidateQueries({ queryKey: myAnnouncementsKey }),
  })
}
