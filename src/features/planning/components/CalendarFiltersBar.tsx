import { useMemo, type ReactNode } from 'react'
import { Combobox } from '@/components/Combobox'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { useEmployeesQuery } from '@/features/employees/queries'
import {
  useClientFilterOptionsQuery,
  useSitesMapQuery,
} from '@/features/sites/queries'
import {
  ALL,
  STATUS_FILTER_OPTIONS,
  type CalendarFilters,
  type FilterNames,
} from '@/features/planning/calendarFilters'

/**
 * Filtros del calendario de Planificación (cliente, sede, empleado y
 * estado), los mismos en las vistas de mes, semana y día (OD-12). El estado
 * vive en la URL (`useCalendarFilters`); acá solo se dibuja.
 */
interface CalendarFiltersBarProps {
  filters: CalendarFilters
  onChange: (patch: Partial<CalendarFilters>) => void
  /** Antes de los filtros (por ejemplo la búsqueda por nombre de la semana). */
  leading?: ReactNode
  /** Después de los filtros (el selector de color, «Imprimir calendario»). */
  trailing?: ReactNode
}

/** Opciones de los filtros y nombres de lo elegido (para el encabezado impreso). */
export function useCalendarFilterOptions(filters: CalendarFilters) {
  const clientOptionsQuery = useClientFilterOptionsQuery()
  const sitesQuery = useSitesMapQuery({})
  const employeesQuery = useEmployeesQuery({ role: 'employee' })

  const clientOptions = clientOptionsQuery.data
  const siteOptions = useMemo(
    () =>
      (sitesQuery.data ?? []).filter(
        (site) =>
          filters.clientId === ALL || site.clientId === filters.clientId,
      ),
    [sitesQuery.data, filters.clientId],
  )
  const employeeOptions = employeesQuery.data

  const names: FilterNames = {
    client: clientOptions?.find((option) => option.id === filters.clientId)
      ?.name,
    site: (sitesQuery.data ?? []).find((site) => site.id === filters.siteId)
      ?.name,
    employee: (() => {
      const employee = employeeOptions?.find(
        (option) => option.profileId === filters.employeeId,
      )
      return employee ? `${employee.firstName} ${employee.lastName}` : undefined
    })(),
  }

  return { clientOptions, siteOptions, employeeOptions, names }
}

function CalendarFiltersBar({
  filters,
  onChange,
  leading,
  trailing,
}: CalendarFiltersBarProps) {
  const { clientOptions, siteOptions, employeeOptions } =
    useCalendarFilterOptions(filters)

  return (
    <div className="flex flex-wrap items-center gap-2">
      {leading}
      <Combobox
        aria-label="Filtrar por cliente"
        placeholder="Todos los clientes"
        className="w-52"
        value={filters.clientId}
        onValueChange={(value) => onChange({ clientId: value, siteId: ALL })}
        options={[
          { value: ALL, label: 'Todos los clientes' },
          ...(clientOptions ?? []).map((option) => ({
            value: option.id,
            label: option.name,
          })),
        ]}
      />
      <Combobox
        aria-label="Filtrar por sede"
        placeholder="Todas las sedes"
        className="w-52"
        value={filters.siteId}
        onValueChange={(value) => onChange({ siteId: value })}
        options={[
          { value: ALL, label: 'Todas las sedes' },
          ...siteOptions.map((option) => ({
            value: option.id,
            label: option.name,
          })),
        ]}
      />
      <Combobox
        aria-label="Filtrar por empleado"
        placeholder="Todos los empleados"
        className="w-56"
        value={filters.employeeId}
        onValueChange={(value) => onChange({ employeeId: value })}
        options={[
          { value: ALL, label: 'Todos los empleados' },
          ...(employeeOptions ?? []).map((option) => ({
            value: option.profileId,
            label: `${option.firstName} ${option.lastName}`,
          })),
        ]}
      />
      <Select
        value={filters.status}
        onValueChange={(value) => onChange({ status: value })}
      >
        <SelectTrigger aria-label="Filtrar por estado" className="w-44">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {STATUS_FILTER_OPTIONS.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {trailing}
    </div>
  )
}

export { CalendarFiltersBar }
