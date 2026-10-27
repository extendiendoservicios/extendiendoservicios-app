import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import * as stockApi from '@/api/stock'
import type {
  AdjustStockInput,
  StockEntryInput,
  StockMovementFilters,
  SupplyCategoryInput,
  SupplyImageChange,
  SupplyInput,
} from '@/api/stock'

/**
 * Hooks de TanStack Query de Insumos en administración (módulo E, P25.2).
 * Patrón de `src/api/README.md`.
 *
 * - Listas (stock, movimientos): polling de 60 s (regla común). Formularios,
 *   fichas y el historial de precios, sin polling: se abren a demanda y se
 *   invalidan al guardar.
 * - Las categorías casi no cambian: `staleTime` de 5 minutos.
 * - Las URL firmadas de las imágenes viven aparte de las filas y no se piden
 *   de nuevo con el polling: se renuevan antes de vencer.
 * - Toda mutación invalida `stockKeys.all` (stock, fichas, movimientos y
 *   contadores se mueven juntos).
 */
const LIST_POLLING_MS = 60_000
const CATEGORIES_STALE_MS = 5 * 60_000
/** Un poco menos que la vida de la URL firmada, para renovarla antes de que falle. */
const IMAGE_URL_STALE_MS =
  (stockApi.SUPPLY_IMAGE_URL_TTL_SECONDS - 5 * 60) * 1000

export const stockKeys = {
  all: ['stock'] as const,
  items: () => [...stockKeys.all, 'items'] as const,
  item: (id: string) => [...stockKeys.all, 'item', id] as const,
  categories: () => [...stockKeys.all, 'categories'] as const,
  priceChanges: (supplyId: string) =>
    [...stockKeys.all, 'priceChanges', supplyId] as const,
  movements: (filters: StockMovementFilters) =>
    [...stockKeys.all, 'movements', filters] as const,
  summary: () => [...stockKeys.all, 'summary'] as const,
  images: (signature: string) =>
    [...stockKeys.all, 'images', signature] as const,
}

// -------------------------------------------------------------------------
// Lecturas
// -------------------------------------------------------------------------

/** Pestaña Stock: todos los artículos (los filtros se aplican en pantalla). */
export function useStockItemsQuery() {
  return useQuery({
    queryKey: stockKeys.items(),
    queryFn: stockApi.fetchStockItems,
    staleTime: LIST_POLLING_MS,
    refetchInterval: LIST_POLLING_MS,
  })
}

/** Ficha de un artículo: lectura puntual, sin polling. */
export function useStockItemQuery(id: string | undefined) {
  return useQuery({
    queryKey: stockKeys.item(id ?? ''),
    queryFn: () => stockApi.fetchStockItem(id as string),
    enabled: id != null,
  })
}

export function useSupplyCategoriesQuery() {
  return useQuery({
    queryKey: stockKeys.categories(),
    queryFn: stockApi.fetchSupplyCategories,
    staleTime: CATEGORIES_STALE_MS,
  })
}

export function useSupplyPriceChangesQuery(supplyId: string | undefined) {
  return useQuery({
    queryKey: stockKeys.priceChanges(supplyId ?? ''),
    queryFn: () => stockApi.fetchSupplyPriceChanges(supplyId as string),
    enabled: supplyId != null,
  })
}

/** Movimientos (ficha del artículo, y Movimientos de P25.3). */
export function useStockMovementsQuery(
  filters: StockMovementFilters,
  options: { enabled?: boolean } = {},
) {
  return useQuery({
    queryKey: stockKeys.movements(filters),
    queryFn: () => stockApi.fetchStockMovements(filters),
    enabled: options.enabled ?? true,
    staleTime: LIST_POLLING_MS,
    refetchInterval: LIST_POLLING_MS,
  })
}

/** Contadores para el Resumen y la barra lateral (P25.3). */
export function useStockSummaryQuery() {
  return useQuery({
    queryKey: stockKeys.summary(),
    queryFn: stockApi.fetchStockSummary,
    staleTime: LIST_POLLING_MS,
    refetchInterval: LIST_POLLING_MS,
  })
}

/** URL firmadas de las imágenes de una lista de artículos, en una sola llamada. */
export function useSupplyImageUrls(paths: ReadonlyArray<string | null>) {
  const unique = Array.from(
    new Set(
      paths.filter((path): path is string => path != null && path !== ''),
    ),
  ).sort()
  const result = useQuery({
    queryKey: stockKeys.images(unique.join(',')),
    queryFn: () => stockApi.createSupplyImageUrls(unique),
    enabled: unique.length > 0,
    staleTime: IMAGE_URL_STALE_MS,
    gcTime: stockApi.SUPPLY_IMAGE_URL_TTL_SECONDS * 1000,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  })
  return result.data ?? new Map<string, string>()
}

// -------------------------------------------------------------------------
// Escrituras
// -------------------------------------------------------------------------

function useInvalidateStock() {
  const queryClient = useQueryClient()
  return () => {
    void queryClient.invalidateQueries({ queryKey: stockKeys.all })
  }
}

export function useSaveSupplyMutation() {
  const invalidate = useInvalidateStock()
  return useMutation({
    mutationFn: ({
      input,
      image,
    }: {
      input: SupplyInput
      image: SupplyImageChange
    }) => stockApi.saveSupply(input, image),
    onSuccess: invalidate,
  })
}

export function useSetSupplyPricesMutation() {
  const invalidate = useInvalidateStock()
  return useMutation({
    mutationFn: (vars: {
      supplyId: string
      costPrice: number
      salePrice: number
    }) =>
      stockApi.setSupplyPrices(vars.supplyId, vars.costPrice, vars.salePrice),
    onSuccess: invalidate,
  })
}

export function useSetSupplyActiveMutation() {
  const invalidate = useInvalidateStock()
  return useMutation({
    mutationFn: (vars: { supplyId: string; active: boolean }) =>
      stockApi.setSupplyActive(vars.supplyId, vars.active),
    onSuccess: invalidate,
  })
}

export function useUpsertSupplyCategoryMutation() {
  const invalidate = useInvalidateStock()
  return useMutation({
    mutationFn: (input: SupplyCategoryInput) =>
      stockApi.upsertSupplyCategory(input),
    onSuccess: invalidate,
  })
}

/** Varias categorías en secuencia (reordenar): una sola invalidación al final. */
export function useReorderSupplyCategoriesMutation() {
  const invalidate = useInvalidateStock()
  return useMutation({
    mutationFn: async (changes: SupplyCategoryInput[]) => {
      for (const change of changes) {
        await stockApi.upsertSupplyCategory(change)
      }
    },
    onSettled: invalidate,
  })
}

export function useRegisterStockEntryMutation() {
  const invalidate = useInvalidateStock()
  return useMutation({
    mutationFn: (input: StockEntryInput) => stockApi.registerStockEntry(input),
    onSuccess: invalidate,
  })
}

export function useAdjustStockMutation() {
  const invalidate = useInvalidateStock()
  return useMutation({
    mutationFn: (input: AdjustStockInput) => stockApi.adjustStock(input),
    onSuccess: invalidate,
  })
}
