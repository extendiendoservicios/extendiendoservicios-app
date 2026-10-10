import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import * as announcementsApi from '@/api/announcements'
import type { AnnouncementInput, AnnouncementStatus } from '@/api/announcements'

/**
 * Hooks de «Avisos y anuncios» de administración (AJ2-03). Polling de 60 s en
 * el listado, el detalle y las lecturas (cambian solas); nada en el
 * formulario. Claves bajo `['announcements', ...]` (el celular usa otras:
 * no se pisan).
 */

const LIST_POLLING_MS = 60_000

export const announcementsKeys = {
  all: ['announcements'] as const,
  list: (status: AnnouncementStatus | 'all') =>
    [...announcementsKeys.all, 'list', status] as const,
  detail: (id: string) => [...announcementsKeys.all, 'detail', id] as const,
  recipients: (id: string) =>
    [...announcementsKeys.all, 'recipients', id] as const,
  recipientIds: (id: string) =>
    [...announcementsKeys.all, 'recipientIds', id] as const,
}

export function useAnnouncementsQuery(status: AnnouncementStatus | 'all') {
  return useQuery({
    queryKey: announcementsKeys.list(status),
    queryFn: () =>
      announcementsApi.fetchAnnouncements(
        status === 'all' ? undefined : status,
      ),
    staleTime: LIST_POLLING_MS,
    refetchInterval: LIST_POLLING_MS,
  })
}

export function useAnnouncementQuery(id: string | undefined) {
  return useQuery({
    queryKey: announcementsKeys.detail(id ?? ''),
    queryFn: () => announcementsApi.fetchAnnouncement(id as string),
    enabled: id != null,
    staleTime: LIST_POLLING_MS,
    refetchInterval: LIST_POLLING_MS,
  })
}

export function useAnnouncementRecipientsQuery(id: string | undefined) {
  return useQuery({
    queryKey: announcementsKeys.recipients(id ?? ''),
    queryFn: () => announcementsApi.fetchAnnouncementRecipients(id as string),
    enabled: id != null,
    staleTime: LIST_POLLING_MS,
    refetchInterval: LIST_POLLING_MS,
  })
}

/** Personas guardadas de un anuncio `custom` (solo se pide al editar uno así). */
export function useAnnouncementRecipientIdsQuery(
  id: string | undefined,
  enabled: boolean,
) {
  return useQuery({
    queryKey: announcementsKeys.recipientIds(id ?? ''),
    queryFn: () => announcementsApi.fetchAnnouncementRecipientIds(id as string),
    enabled: id != null && enabled,
  })
}

export function useCreateAnnouncementMutation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: AnnouncementInput) =>
      announcementsApi.createAnnouncement(input),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: announcementsKeys.all }),
  })
}

export function useUpdateAnnouncementMutation(id: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: AnnouncementInput) =>
      announcementsApi.updateAnnouncement(id, input),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: announcementsKeys.all }),
  })
}

export function useArchiveAnnouncementMutation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => announcementsApi.archiveAnnouncement(id),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: announcementsKeys.all }),
  })
}
