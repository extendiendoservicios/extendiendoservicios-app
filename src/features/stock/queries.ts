import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import * as stockApi from '@/api/stock'
import { fetchEmployees, type EmployeeListRow } from '@/api/employees'
import { fetchUsers, type AdminUserRow } from '@/api/users'
import { fetchClientFilterOptions } from '@/api/sites'
import type {
  AdjustStockInput,
  ConsumptionFilters,
  StockCountInput,
  StockEntryInput,
  StockMovementFilters,
  SupplyCategoryInput,
  SupplyImageChange,
  SupplyInput,
  WithdrawalInput,
} from '@/api/stock'

/**
 * Hooks de TanStack Query de Insumos en administración (módulo E, P25.2 y P25.3).
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
  shortages: () => [...stockKeys.all, 'shortages'] as const,
  counts: () => [...stockKeys.all, 'counts'] as const,
  consumption: (filters: ConsumptionFilters) =>
    [...stockKeys.all, 'consumption', filters] as const,
  shiftOptions: () => [...stockKeys.all, 'shiftOptions'] as const,
  siteOptions: () => [...stockKeys.all, 'siteOptions'] as const,
  people: (scope: 'withdraw' | 'all') =>
    [...stockKeys.all, 'people', scope] as const,
  reviewers: () => [...stockKeys.all, 'reviewers'] as const,
  clients: () => [...stockKeys.all, 'clients'] as const,
  personWithdrawals: (personId: string, dateFrom: string, dateTo: string) =>
    [
      ...stockKeys.all,
      'personWithdrawals',
      personId,
      dateFrom,
      dateTo,
    ] as const,
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

/** Avisos de faltante (pestaña Faltantes): abiertos primero, polling de 60 s. */
export function useShortageReportsQuery() {
  return useQuery({
    queryKey: stockKeys.shortages(),
    queryFn: stockApi.fetchShortageReports,
    staleTime: LIST_POLLING_MS,
    refetchInterval: LIST_POLLING_MS,
  })
}

/** Historial de controles (pestaña Controles). */
export function useStockCountsQuery() {
  return useQuery({
    queryKey: stockKeys.counts(),
    queryFn: stockApi.fetchStockCounts,
    staleTime: LIST_POLLING_MS,
    refetchInterval: LIST_POLLING_MS,
  })
}

/** Consumo por cliente del período (pestaña Consumo por cliente). */
export function useSupplyConsumptionQuery(filters: ConsumptionFilters) {
  return useQuery({
    queryKey: stockKeys.consumption(filters),
    queryFn: () => stockApi.fetchSupplyConsumption(filters),
    staleTime: LIST_POLLING_MS,
    refetchInterval: LIST_POLLING_MS,
  })
}

/** Turnos elegibles para el retiro en nombre de otra persona (formulario: sin polling). */
export function useWithdrawalShiftOptionsQuery(enabled = true) {
  return useQuery({
    queryKey: stockKeys.shiftOptions(),
    queryFn: stockApi.fetchWithdrawalShiftOptions,
    enabled,
    staleTime: CATEGORIES_STALE_MS,
  })
}

/** Sedes elegibles (también alimenta los filtros de cliente y sede). */
export function useWithdrawalSiteOptionsQuery(enabled = true) {
  return useQuery({
    queryKey: stockKeys.siteOptions(),
    queryFn: stockApi.fetchWithdrawalSiteOptions,
    enabled,
    staleTime: CATEGORIES_STALE_MS,
  })
}

/** Clientes para los filtros de Movimientos y Consumo. */
export function useStockClientOptionsQuery() {
  return useQuery({
    queryKey: stockKeys.clients(),
    queryFn: fetchClientFilterOptions,
    staleTime: CATEGORIES_STALE_MS,
  })
}

/**
 * Quien puede retirar: empleados y coordinadores (IS-11). `withdraw` trae solo
 * los activos (formulario de retiro en nombre de); `all` también las bajas
 * (filtro de Movimientos, que tiene retiros de quien ya no está).
 */
export function useStockPeopleQuery(scope: 'withdraw' | 'all') {
  return useQuery({
    queryKey: stockKeys.people(scope),
    queryFn: async (): Promise<EmployeeListRow[]> => {
      const rows = await fetchEmployees({ role: 'all', status: 'all' })
      return rows.filter(
        (row) =>
          (row.roles.includes('employee') ||
            row.roles.includes('supervisor')) &&
          (scope === 'all' || row.effectiveStatus !== 'terminated'),
      )
    },
    staleTime: CATEGORIES_STALE_MS,
  })
}

/** Personas de la app que pueden figurar como revisor de un control (activas). */
export function useStockReviewersQuery() {
  return useQuery({
    queryKey: stockKeys.reviewers(),
    queryFn: async (): Promise<AdminUserRow[]> =>
      (await fetchUsers()).filter(
        (user) => user.isActive && user.deletedAt == null,
      ),
    staleTime: CATEGORIES_STALE_MS,
  })
}

/** Retiros de una persona en un período (pestaña «Retiros» de la ficha). */
export function usePersonWithdrawalsQuery(
  personId: string,
  dateFrom: string,
  dateTo: string,
) {
  return useQuery({
    queryKey: stockKeys.personWithdrawals(personId, dateFrom, dateTo),
    queryFn: () =>
      stockApi.fetchAllStockMovements({
        kind: 'withdrawal',
        personId,
        dateFrom: dateFrom || undefined,
        dateTo: dateTo || undefined,
      }),
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

export function useVoidStockMovementMutation() {
  const invalidate = useInvalidateStock()
  return useMutation({
    mutationFn: (vars: { movementId: string; reason: string }) =>
      stockApi.voidStockMovement(vars.movementId, vars.reason),
    onSuccess: invalidate,
  })
}

export function useRegisterWithdrawalOnBehalfMutation() {
  const invalidate = useInvalidateStock()
  return useMutation({
    mutationFn: (input: WithdrawalInput) =>
      stockApi.registerWithdrawalOnBehalf(input),
    onSuccess: invalidate,
  })
}

export function useRegisterStockCountMutation() {
  const invalidate = useInvalidateStock()
  return useMutation({
    mutationFn: (input: StockCountInput) => stockApi.registerStockCount(input),
    onSuccess: invalidate,
  })
}

export function useResolveShortageMutation() {
  const invalidate = useInvalidateStock()
  return useMutation({
    mutationFn: (vars: { reportId: string; note: string }) =>
      stockApi.resolveSupplyShortage(vars.reportId, vars.note),
    onSuccess: invalidate,
  })
}
