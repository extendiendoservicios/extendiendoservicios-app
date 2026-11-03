import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import * as ownerDeleteApi from '@/api/ownerDelete'
import type { OwnerDeleteKind } from '@/api/ownerDelete'

/**
 * Hooks del borrado del dueño (P27.7, OD-22 y OD-23). La vista previa siempre
 * se pide fresca: depende de fichajes y turnos que cambian.
 */

export const ownerDeleteKeys = {
  all: ['ownerDelete'] as const,
  preview: (kind: OwnerDeleteKind, id: string, fromDate?: string) =>
    [...ownerDeleteKeys.all, 'preview', kind, id, fromDate ?? null] as const,
}

/** Raíces de las consultas que dependen de lo que se puede borrar. */
const INVALIDATED_ROOTS = [
  'shifts',
  'services',
  'clients',
  'sites',
  'employees',
  'users',
  'planning',
  'attendance',
  'dashboard',
  'supervisions',
  'stock',
] as const

export function useOwnerDeletePreviewQuery(
  kind: OwnerDeleteKind,
  id: string,
  options: { enabled: boolean; fromDate?: string },
) {
  return useQuery({
    queryKey: ownerDeleteKeys.preview(kind, id, options.fromDate),
    queryFn: () =>
      ownerDeleteApi.fetchOwnerDeletePreview(kind, id, options.fromDate),
    enabled: options.enabled,
    staleTime: 0,
    gcTime: 0,
    retry: false,
    refetchOnWindowFocus: false,
  })
}

/** Borra y, pase lo que pase con Auth, refresca todo lo que pudo cambiar. */
export function useOwnerDeleteMutation() {
  const queryClient = useQueryClient()
  const invalidate = () => {
    for (const root of INVALIDATED_ROOTS) {
      void queryClient.invalidateQueries({ queryKey: [root] })
    }
  }
  return useMutation({
    mutationFn: (input: {
      kind: OwnerDeleteKind
      id: string
      confirmName: string
      fromDate?: string
    }) => ownerDeleteApi.ownerDelete(input),
    onSuccess: invalidate,
    onError: (error) => {
      // Si Auth falló, la base ya borró: igual hay que refrescar las listas.
      if (ownerDeleteApi.isAuthDeleteFailed(error)) {
        invalidate()
      }
    },
  })
}
