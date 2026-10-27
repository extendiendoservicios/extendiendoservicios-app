import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  fetchMyShortageReports,
  fetchMyWithdrawals,
  fetchSupplyCatalog,
  fetchWithdrawalShiftOptions,
  fetchWithdrawalSiteOptions,
  registerWithdrawal,
  reportSupplyShortage,
  signSupplyImages,
  SUPPLY_IMAGE_TTL_SECONDS,
  type ShortageInput,
  type SupplyCatalogItem,
  type WithdrawalInput,
} from '@/api/myStock'

/**
 * Hooks de TanStack Query de Insumos en el celular (P25.4). Patrón de
 * `src/api/README.md`. Sin polling: el catálogo y las listas se releen al
 * abrir la pantalla y después de cada retiro o aviso. Sin conexión no hay
 * cola (es del módulo C).
 */

export const myStockKeys = {
  all: ['myStock'] as const,
  catalog: () => [...myStockKeys.all, 'catalog'] as const,
  images: (paths: readonly string[]) =>
    [...myStockKeys.all, 'images', ...paths] as const,
  shiftOptions: () => [...myStockKeys.all, 'shiftOptions'] as const,
  siteOptions: () => [...myStockKeys.all, 'siteOptions'] as const,
  withdrawals: () => [...myStockKeys.all, 'withdrawals'] as const,
  shortages: () => [...myStockKeys.all, 'shortages'] as const,
}

export function useSupplyCatalogQuery() {
  return useQuery({
    queryKey: myStockKeys.catalog(),
    queryFn: fetchSupplyCatalog,
  })
}

/**
 * URL firmadas de las imágenes del catálogo (bucket privado). Se firman todas
 * juntas y se reutilizan hasta la mitad de su vida.
 */
export function useSupplyImageUrls(items: readonly SupplyCatalogItem[]) {
  const paths = Array.from(
    new Set(items.flatMap((item) => (item.imagePath ? [item.imagePath] : []))),
  ).sort()
  return useQuery({
    queryKey: myStockKeys.images(paths),
    queryFn: () => signSupplyImages(paths),
    enabled: paths.length > 0,
    staleTime: (SUPPLY_IMAGE_TTL_SECONDS * 1000) / 2,
  })
}

/** Turnos para retirar: los del empleado, o todos los del coordinador (IS-28). */
export function useWithdrawalShiftOptionsQuery() {
  return useQuery({
    queryKey: myStockKeys.shiftOptions(),
    queryFn: fetchWithdrawalShiftOptions,
  })
}

export function useWithdrawalSiteOptionsQuery(enabled = true) {
  return useQuery({
    queryKey: myStockKeys.siteOptions(),
    queryFn: fetchWithdrawalSiteOptions,
    enabled,
  })
}

export function useMyWithdrawalsQuery() {
  return useQuery({
    queryKey: myStockKeys.withdrawals(),
    queryFn: () => fetchMyWithdrawals(),
  })
}

export function useMyShortageReportsQuery() {
  return useQuery({
    queryKey: myStockKeys.shortages(),
    queryFn: () => fetchMyShortageReports(),
  })
}

/**
 * Registra el retiro. Después se relee el catálogo (un artículo puede haber
 * quedado en cero) y mis retiros; si falla por stock o por un artículo dado de
 * baja, también se relee el catálogo para que el «Sin stock» se vea al volver.
 */
export function useRegisterWithdrawalMutation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: WithdrawalInput) => registerWithdrawal(input),
    onSuccess: () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: myStockKeys.catalog() }),
        queryClient.invalidateQueries({ queryKey: myStockKeys.withdrawals() }),
      ]),
    onError: () =>
      queryClient.invalidateQueries({ queryKey: myStockKeys.catalog() }),
  })
}

export function useReportShortageMutation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: ShortageInput) => reportSupplyShortage(input),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: myStockKeys.shortages() }),
  })
}
