import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import * as categoriesApi from '@/api/clientCategories'
import * as clientsApi from '@/api/clients'
import { clientsKeys } from '@/features/clients/queries'

/**
 * Hooks de las categorías de clientes (P27.7, OD-20) y del total de clientes
 * activos (OD-21). Las categorías cambian muy poco: sin polling. El total de
 * activos sí se refresca cada 60 s, como el listado.
 */

const LIST_POLLING_MS = 60_000

export const clientCategoriesKeys = {
  all: ['clients', 'categories'] as const,
  list: () => [...clientCategoriesKeys.all, 'list'] as const,
  counts: () => [...clientCategoriesKeys.all, 'counts'] as const,
}

/** Categorías vigentes, en el orden de la empresa. */
export function useClientCategoriesQuery() {
  return useQuery({
    queryKey: clientCategoriesKeys.list(),
    queryFn: categoriesApi.fetchClientCategories,
    staleTime: 5 * 60_000,
  })
}

/** Cuántos clientes tiene cada categoría (para avisar antes de la baja). */
export function useClientCountsByCategoryQuery() {
  return useQuery({
    queryKey: clientCategoriesKeys.counts(),
    queryFn: categoriesApi.fetchClientCountsByCategory,
    staleTime: 0,
  })
}

/** OD-21: total de clientes activos, sin filtros. */
export function useActiveClientsCountQuery() {
  return useQuery({
    queryKey: [...clientsKeys.all, 'activeCount'] as const,
    queryFn: clientsApi.fetchActiveClientsCount,
    staleTime: LIST_POLLING_MS,
    refetchInterval: LIST_POLLING_MS,
  })
}

/** Alta, nombre, orden y baja: todo refresca categorías y clientes (el listado agrupa por categoría). */
function useCategoryMutationOptions() {
  const queryClient = useQueryClient()
  return {
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: clientsKeys.all })
    },
  }
}

export function useCreateClientCategoryMutation() {
  const options = useCategoryMutationOptions()
  return useMutation({
    mutationFn: (name: string) => categoriesApi.createClientCategory(name),
    ...options,
  })
}

export function useRenameClientCategoryMutation() {
  const options = useCategoryMutationOptions()
  return useMutation({
    mutationFn: ({ id, name }: { id: string; name: string }) =>
      categoriesApi.renameClientCategory(id, name),
    ...options,
  })
}

export function useReorderClientCategoriesMutation() {
  const options = useCategoryMutationOptions()
  return useMutation({
    mutationFn: (ids: string[]) => categoriesApi.reorderClientCategories(ids),
    ...options,
  })
}

export function useRemoveClientCategoryMutation() {
  const options = useCategoryMutationOptions()
  return useMutation({
    mutationFn: (id: string) => categoriesApi.removeClientCategory(id),
    ...options,
  })
}
