import type { ReactElement } from 'react'
import { render } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, Route, Routes } from 'react-router'
import { vi } from 'vitest'
import type {
  MyShortageReport,
  MyWithdrawal,
  SupplyCatalogItem,
  WithdrawalShiftOption,
  WithdrawalSiteOption,
} from '@/api/myStock'
import * as onlineModule from '@/features/employee/useOnlineStatus'
import * as queriesModule from './queries'

/**
 * Ayudas de los tests de las pantallas de Insumos del celular (P25.4):
 * filas de ejemplo, el reemplazo de los hooks de `queries.ts` (mismo patrón
 * que EMP-12) y el armado de la ruta.
 */
export function makeSupply(
  overrides: Partial<SupplyCatalogItem> = {},
): SupplyCatalogItem {
  return {
    id: 's1',
    code: 'QUI-001',
    name: 'Lavandina',
    presentation: '1 L',
    categoryId: 'c1',
    categoryName: 'Químicos',
    categorySortOrder: 1,
    imagePath: null,
    outOfStock: false,
    ...overrides,
  }
}

export function makeShiftOption(
  overrides: Partial<WithdrawalShiftOption> = {},
): WithdrawalShiftOption {
  return {
    shiftId: 'sh1',
    shiftDate: '2030-01-02',
    startTime: '08:00:00',
    endTime: '12:00:00',
    startsAt: null,
    openEnded: false,
    clientName: 'Limpiadora SRL',
    siteId: 'si1',
    siteName: 'Sede Centro',
    isAssigned: true,
    isPriority: false,
    ...overrides,
  }
}

export function makeSiteOption(
  overrides: Partial<WithdrawalSiteOption> = {},
): WithdrawalSiteOption {
  return {
    siteId: 'si1',
    siteName: 'Sede Centro',
    clientId: 'c1',
    clientName: 'Limpiadora SRL',
    isPriority: false,
    ...overrides,
  }
}

export function makeWithdrawal(
  overrides: Partial<MyWithdrawal> = {},
): MyWithdrawal {
  return {
    movementId: 'm1',
    recordedAt: '2026-10-26T15:07:00Z',
    note: null,
    onBehalf: false,
    registeredByName: null,
    shiftId: 'sh1',
    shiftDate: '2026-10-26',
    startTime: '08:00:00',
    endTime: '12:00:00',
    clientName: 'Limpiadora SRL',
    siteName: 'Sede Centro',
    totalQty: 2,
    voidedAt: null,
    voidReason: null,
    lines: [
      {
        supplyId: 's1',
        code: 'QUI-001',
        name: 'Lavandina',
        presentation: '1 L',
        qty: 2,
      },
    ],
    ...overrides,
  }
}

export function makeShortage(
  overrides: Partial<MyShortageReport> = {},
): MyShortageReport {
  return {
    id: 'r1',
    createdAt: '2026-10-25T10:00:00Z',
    status: 'open',
    supplyName: 'Lavandina · 1 L',
    supplyCode: 'QUI-001',
    description: null,
    shiftDate: null,
    startTime: null,
    endTime: null,
    clientName: null,
    siteName: null,
    comment: null,
    resolvedAt: null,
    resolvedByName: null,
    resolutionNote: null,
    ...overrides,
  }
}

interface QueryMocks {
  catalog?: SupplyCatalogItem[]
  shiftOptions?: WithdrawalShiftOption[]
  siteOptions?: WithdrawalSiteOption[]
  withdrawals?: MyWithdrawal[]
  shortages?: MyShortageReport[]
  online?: boolean
  register?: ReturnType<typeof vi.fn>
  report?: ReturnType<typeof vi.fn>
}

/** Reemplaza todos los hooks del módulo por datos fijos. */
export function mockStockQueries({
  catalog = [],
  shiftOptions = [],
  siteOptions = [],
  withdrawals = [],
  shortages = [],
  online = true,
  register = vi.fn(),
  report = vi.fn(),
}: QueryMocks = {}) {
  vi.spyOn(onlineModule, 'useOnlineStatus').mockReturnValue(online)
  const ok = <T,>(data: T) =>
    ({ data, isLoading: false, isError: false }) as never
  vi.spyOn(queriesModule, 'useSupplyCatalogQuery').mockReturnValue(ok(catalog))
  vi.spyOn(queriesModule, 'useSupplyImageUrls').mockReturnValue(
    ok(new Map<string, string>()),
  )
  vi.spyOn(queriesModule, 'useWithdrawalShiftOptionsQuery').mockReturnValue(
    ok(shiftOptions),
  )
  vi.spyOn(queriesModule, 'useWithdrawalSiteOptionsQuery').mockReturnValue(
    ok(siteOptions),
  )
  vi.spyOn(queriesModule, 'useMyWithdrawalsQuery').mockReturnValue(
    ok(withdrawals),
  )
  vi.spyOn(queriesModule, 'useMyShortageReportsQuery').mockReturnValue(
    ok(shortages),
  )
  vi.spyOn(queriesModule, 'useRegisterWithdrawalMutation').mockReturnValue({
    mutateAsync: register,
    isPending: false,
  } as never)
  vi.spyOn(queriesModule, 'useReportShortageMutation').mockReturnValue({
    mutateAsync: report,
    isPending: false,
  } as never)
  return { register, report }
}

export function renderStockRoute(
  ui: ReactElement,
  { path, entry }: { path: string; entry: string },
) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[entry]}>
        <Routes>
          <Route path={path} element={ui} />
          <Route path="*" element={<p>otra pantalla</p>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}
