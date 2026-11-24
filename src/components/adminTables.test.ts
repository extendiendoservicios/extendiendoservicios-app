import { describe, expect, it } from 'vitest'

/**
 * P31.2 (D-12): todas las tablas de administración recuerdan sus anchos y se
 * pueden ajustar. Cada una tiene su `persistKey` estable y única.
 * `minSortable` es la cantidad mínima de columnas con `accessorFn` (orden por
 * clic en el encabezado) que cada archivo tiene que declarar.
 */
const TABLES: { file: string; keys: string[]; minSortable: number }[] = [
  {
    file: 'pages/admin/ClientsPage.tsx',
    keys: ['tabla:clientes'],
    minSortable: 7,
  },
  {
    file: 'pages/admin/EmployeesPage.tsx',
    keys: ['tabla:empleados'],
    minSortable: 5,
  },
  {
    file: 'pages/admin/HolidaysPage.tsx',
    keys: ['tabla:feriados'],
    minSortable: 2,
  },
  {
    file: 'pages/admin/RatingCriteriaPage.tsx',
    keys: ['tabla:criterios-calificacion'],
    minSortable: 0,
  },
  {
    file: 'pages/admin/SecurityEventsPage.tsx',
    keys: ['tabla:eventos-seguridad'],
    minSortable: 5,
  },
  {
    file: 'pages/admin/UsersPage.tsx',
    keys: ['tabla:usuarios'],
    minSortable: 0,
  },
  {
    file: 'features/announcements/components/AnnouncementDetail.tsx',
    keys: ['tabla:anuncio-lecturas'],
    minSortable: 3,
  },
  {
    file: 'features/announcements/components/AnnouncementsList.tsx',
    keys: ['tabla:anuncios'],
    minSortable: 5,
  },
  {
    file: 'features/attendance/components/AttendanceTodayList.tsx',
    keys: ['tabla:asistencia-hoy'],
    minSortable: 8,
  },
  {
    file: 'features/attendance/components/EmployeeAttendanceHistoryTab.tsx',
    keys: ['tabla:empleado-historial-asistencia'],
    minSortable: 8,
  },
  {
    file: 'features/clients/components/ClientServiceSummaryTab.tsx',
    keys: ['tabla:cliente-resumen-servicio'],
    minSortable: 5,
  },
  {
    file: 'features/employees/components/EmployeeRatingsTab.tsx',
    keys: ['tabla:empleado-calificaciones'],
    minSortable: 5,
  },
  {
    file: 'features/employees/components/EmployeeUpcomingShiftsTab.tsx',
    keys: ['tabla:empleado-proximos-turnos'],
    minSortable: 4,
  },
  {
    file: 'features/shifts/components/ShiftsDayList.tsx',
    keys: ['tabla:calendario-dia'],
    minSortable: 6,
  },
  {
    file: 'features/stock/components/CategoriesTab.tsx',
    keys: ['tabla:insumos-categorias'],
    minSortable: 0,
  },
  {
    file: 'features/stock/components/PriceHistorySection.tsx',
    keys: ['tabla:insumos-historial-precios'],
    minSortable: 5,
  },
  {
    file: 'features/stock/components/StockTab.tsx',
    keys: ['tabla:insumos-stock'],
    minSortable: 8,
  },
  {
    file: 'features/stock/components/SupplyMovementsSection.tsx',
    keys: ['tabla:insumos-movimientos'],
    minSortable: 7,
  },
  {
    file: 'features/supervisions/components/SupervisionsAdminScreen.tsx',
    keys: ['tabla:supervisiones', 'tabla:supervisiones-calificaciones'],
    minSortable: 14,
  },
]

/** Código fuente de las pantallas (solo texto, no se ejecuta). */
const SOURCES = import.meta.glob<string>(
  ['../pages/admin/*.tsx', '../features/*/components/*.tsx', '!**/*.test.tsx'],
  { query: '?raw', import: 'default', eager: true },
)

describe('tablas de administración (P31.2, D-12)', () => {
  it.each(TABLES)(
    '$file: anchos ajustables, persistKey y columnas ordenables',
    ({ file, keys, minSortable }) => {
      const source = SOURCES[`../${file}`]
      expect(source).toBeDefined()
      for (const key of keys) {
        expect(source).toContain(`persistKey="${key}"`)
      }
      expect(
        source!.match(/^\s*resizableColumns$/gm)?.length ?? 0,
      ).toBeGreaterThanOrEqual(keys.length)
      expect(
        source!.match(/accessorFn:|accessorKey:/g)?.length ?? 0,
      ).toBeGreaterThanOrEqual(minSortable)
    },
  )

  it('las persistKey son únicas entre tablas distintas', () => {
    const all = TABLES.flatMap((table) => table.keys)
    expect(new Set(all).size).toBe(all.length)
  })
})
