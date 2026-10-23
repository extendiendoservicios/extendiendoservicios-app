import { useMemo, useState } from 'react'
import { Link } from 'react-router'
import { ShieldCheck, Star } from 'lucide-react'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { DataTable, type DataTableColumnDef } from '@/components/DataTable'
import { DatePicker } from '@/components/DatePicker'
import { PersonCell } from '@/components/PersonCell'
import { StarRating } from '@/components/StarRating'
import {
  formatDateOnly,
  localDateToIsoDate,
} from '@/features/settings/dateOnly'
import { formatMinutes, formatTime } from '@/lib/format'
import { useEmployeesQuery } from '@/features/employees/queries'
import type { SupervisionListRow } from '@/api/supervisions'
import type { RatingListRow } from '@/api/ratings'
import {
  useRatingsQuery,
  useSupervisionsAdminQuery,
} from '@/features/supervisions/queries'
import { formatShiftRange } from '@/features/shifts/openEnded'
import { SupervisionStateBadges } from './UnclosedBadge'
import { UpdatedAgo } from './UpdatedAgo'

/** "YYYY-MM-DD" → `Date` para `DatePicker` (mismo criterio que `ShiftsDayList`/`AttendanceTodayList`). */
function isoDateToDate(isoDate: string): Date {
  return new Date(`${isoDate}T00:00:00`)
}

interface Filters {
  employeeId: string
  supervisorId: string
  clientId: string
  siteId: string
  dateFrom: string
  dateTo: string
}

const EMPTY_FILTERS: Filters = {
  employeeId: 'all',
  supervisorId: 'all',
  clientId: 'all',
  siteId: 'all',
  dateFrom: '',
  dateTo: '',
}

/**
 * ADM-13 "Supervisiones · listado" (SUP-010, `05` línea 57): tabla de
 * supervisiones con filtros y pestaña "Calificaciones" con una fila por
 * calificación (CJ-11).
 *
 * P24.3 (coordinación libre): ya no hay asignación, así que se quitaron el
 * botón "Asignar supervisión" y el filtro por estado (CJ-01, CJ-26). Un
 * turno puede aparecer en varias filas, una por coordinador (CJ-05); la
 * duración es informativa (CJ-14) y las que quedaron abiertas por el cierre
 * automático llevan la marca «Sin cerrar» (CJ-31).
 *
 * Las dos pestañas comparten el mismo estado de filtros (empleado,
 * coordinador, cliente, sede, rango de fechas).
 * Las opciones de supervisor/cliente/sede del selector se arman con las
 * filas ya cargadas de las dos consultas (mismo criterio que
 * `AttendanceTodayList`); las de empleado, con la lista completa de
 * `v_employees` (`useEmployeesQuery`, ya cargada por ADM-16) porque el
 * listado de supervisiones no trae nombres de empleado por sí solo.
 * Decisión propia, documentada en el reporte del encargo.
 */
type SupervisionsAdminTab = 'supervisiones' | 'calificaciones'

interface SupervisionsAdminScreenProps {
  /** `?pestana=calificaciones` (`05` sección 5): lo controla `SupervisionsPage`. */
  tab: SupervisionsAdminTab
  onTabChange: (tab: SupervisionsAdminTab) => void
}

function SupervisionsAdminScreen({
  tab,
  onTabChange,
}: SupervisionsAdminScreenProps) {
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS)

  const apiFilters = {
    employeeId: filters.employeeId === 'all' ? undefined : filters.employeeId,
    supervisorId:
      filters.supervisorId === 'all' ? undefined : filters.supervisorId,
    clientId: filters.clientId === 'all' ? undefined : filters.clientId,
    siteId: filters.siteId === 'all' ? undefined : filters.siteId,
    dateFrom: filters.dateFrom || undefined,
    dateTo: filters.dateTo || undefined,
  }

  const supervisionsQuery = useSupervisionsAdminQuery(apiFilters)
  const ratingsQuery = useRatingsQuery(apiFilters, tab === 'calificaciones')
  const employeesQuery = useEmployeesQuery({ status: 'all' })

  const supervisionRows = useMemo(
    () => supervisionsQuery.data ?? [],
    [supervisionsQuery.data],
  )
  const ratingRows = useMemo(() => ratingsQuery.data ?? [], [ratingsQuery.data])

  const employeeOptions = useMemo(
    () =>
      (employeesQuery.data ?? []).map((employee) => ({
        id: employee.profileId,
        name: `${employee.firstName} ${employee.lastName}`,
      })),
    [employeesQuery.data],
  )

  const supervisorOptions = useMemo(() => {
    const map = new Map<string, string>()
    for (const row of supervisionRows) {
      map.set(
        row.supervisorId,
        `${row.supervisorFirstName} ${row.supervisorLastName}`,
      )
    }
    for (const row of ratingRows) {
      map.set(
        row.supervisorId,
        `${row.supervisorFirstName} ${row.supervisorLastName}`,
      )
    }
    return Array.from(map, ([id, name]) => ({ id, name }))
  }, [supervisionRows, ratingRows])

  const clientOptions = useMemo(() => {
    const map = new Map<string, string>()
    for (const row of supervisionRows) {
      map.set(row.clientId, row.clientName)
    }
    return Array.from(map, ([id, name]) => ({ id, name }))
  }, [supervisionRows])

  const siteOptions = useMemo(() => {
    const map = new Map<string, string>()
    for (const row of supervisionRows) {
      map.set(row.siteId, row.siteName)
    }
    for (const row of ratingRows) {
      map.set(row.siteId, row.siteName)
    }
    return Array.from(map, ([id, name]) => ({ id, name }))
  }, [supervisionRows, ratingRows])

  const supervisionColumns: DataTableColumnDef<SupervisionListRow>[] = [
    {
      id: 'date',
      header: 'Fecha',
      meta: { card: 'title' },
      cell: ({ row }) => (
        <Link
          to={`/admin/supervisiones/${row.original.id}`}
          className="font-semibold text-text capitalize hover:text-primary-800"
        >
          {formatDateOnly(row.original.shiftDate)}
        </Link>
      ),
    },
    {
      id: 'shift',
      header: 'Turno',
      meta: { card: 'subtitle' },
      cell: ({ row }) => (
        <span>
          {row.original.clientName} · {row.original.siteName} ·{' '}
          {formatShiftRange(
            row.original.startTime,
            row.original.endTime,
            row.original.shiftOpenEnded,
          )}
        </span>
      ),
    },
    {
      id: 'supervisor',
      header: 'Coordinador',
      meta: { card: 'meta', cardLabel: 'Coordinador' },
      cell: ({ row }) => (
        <PersonCell
          id={row.original.supervisorId}
          name={`${row.original.supervisorFirstName} ${row.original.supervisorLastName}`}
        />
      ),
    },
    {
      id: 'status',
      header: 'Estado',
      meta: { card: 'meta', cardLabel: 'Estado' },
      cell: ({ row }) => (
        <SupervisionStateBadges
          status={row.original.status}
          unclosed={row.original.unclosed}
        />
      ),
    },
    {
      id: 'checkIn',
      header: 'Inicio',
      meta: { card: 'meta', cardLabel: 'Inicio' },
      cell: ({ row }) =>
        row.original.checkInAt ? formatTime(row.original.checkInAt) : '—',
    },
    {
      id: 'checkOut',
      header: 'Fin',
      meta: { card: 'meta', cardLabel: 'Fin' },
      cell: ({ row }) =>
        row.original.checkOutAt ? formatTime(row.original.checkOutAt) : '—',
    },
    {
      id: 'duration',
      header: 'Duración',
      meta: { card: 'meta', cardLabel: 'Duración' },
      cell: ({ row }) =>
        row.original.durationMinutes != null
          ? formatMinutes(row.original.durationMinutes)
          : '—',
    },
    {
      id: 'ratings',
      header: 'Calificaciones cargadas',
      meta: { card: 'meta', cardLabel: 'Calificaciones cargadas' },
      cell: ({ row }) =>
        `${row.original.ratingsCount}/${row.original.assignedEmployeesCount}`,
    },
  ]

  const ratingColumns: DataTableColumnDef<RatingListRow>[] = [
    {
      id: 'date',
      header: 'Fecha',
      meta: { card: 'title' },
      cell: ({ row }) => (
        <Link
          to={`/admin/supervisiones/${row.original.supervisionId}`}
          className="font-semibold text-text capitalize hover:text-primary-800"
        >
          {formatDateOnly(row.original.shiftDate)}
        </Link>
      ),
    },
    {
      id: 'employee',
      header: 'Empleado',
      meta: { card: 'subtitle' },
      cell: ({ row }) => (
        <PersonCell
          id={row.original.employeeId}
          name={`${row.original.employeeFirstName} ${row.original.employeeLastName}`}
        />
      ),
    },
    {
      id: 'site',
      header: 'Sede',
      meta: { card: 'meta', cardLabel: 'Sede' },
      cell: ({ row }) => row.original.siteName,
    },
    {
      id: 'supervisor',
      header: 'Coordinador',
      meta: { card: 'meta', cardLabel: 'Coordinador' },
      cell: ({ row }) => (
        <PersonCell
          id={row.original.supervisorId}
          name={`${row.original.supervisorFirstName} ${row.original.supervisorLastName}`}
        />
      ),
    },
    {
      id: 'score',
      header: 'Puntaje',
      meta: { card: 'meta', cardLabel: 'Puntaje' },
      cell: ({ row }) => (
        <StarRating value={row.original.score} readOnly size="sm" />
      ),
    },
    {
      id: 'comment',
      header: 'Comentario',
      meta: { card: 'meta', cardLabel: 'Comentario' },
      cell: ({ row }) => row.original.comment ?? '—',
    },
  ]

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        {tab === 'supervisiones' && supervisionsQuery.dataUpdatedAt > 0 && (
          <UpdatedAgo dataUpdatedAt={supervisionsQuery.dataUpdatedAt} />
        )}
        {tab === 'calificaciones' && ratingsQuery.dataUpdatedAt > 0 && (
          <UpdatedAgo dataUpdatedAt={ratingsQuery.dataUpdatedAt} />
        )}
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <Select
          value={filters.employeeId}
          onValueChange={(value) =>
            setFilters((prev) => ({ ...prev, employeeId: value }))
          }
        >
          <SelectTrigger aria-label="Filtrar por empleado" className="w-52">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos los empleados</SelectItem>
            {employeeOptions.map((option) => (
              <SelectItem key={option.id} value={option.id}>
                {option.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select
          value={filters.supervisorId}
          onValueChange={(value) =>
            setFilters((prev) => ({ ...prev, supervisorId: value }))
          }
        >
          <SelectTrigger aria-label="Filtrar por coordinador" className="w-52">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos los coordinadores</SelectItem>
            {supervisorOptions.map((option) => (
              <SelectItem key={option.id} value={option.id}>
                {option.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select
          value={filters.clientId}
          onValueChange={(value) =>
            setFilters((prev) => ({ ...prev, clientId: value }))
          }
        >
          <SelectTrigger aria-label="Filtrar por cliente" className="w-52">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos los clientes</SelectItem>
            {clientOptions.map((option) => (
              <SelectItem key={option.id} value={option.id}>
                {option.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select
          value={filters.siteId}
          onValueChange={(value) =>
            setFilters((prev) => ({ ...prev, siteId: value }))
          }
        >
          <SelectTrigger aria-label="Filtrar por sede" className="w-52">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todas las sedes</SelectItem>
            {siteOptions.map((option) => (
              <SelectItem key={option.id} value={option.id}>
                {option.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <div className="flex items-center gap-2">
          <span className="text-[11px] font-semibold text-text-2">Desde</span>
          <DatePicker
            aria-label="Desde"
            value={
              filters.dateFrom ? isoDateToDate(filters.dateFrom) : undefined
            }
            onValueChange={(next) =>
              setFilters((prev) => ({
                ...prev,
                dateFrom: next ? localDateToIsoDate(next) : '',
              }))
            }
            className="w-44"
          />
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[11px] font-semibold text-text-2">Hasta</span>
          <DatePicker
            aria-label="Hasta"
            value={filters.dateTo ? isoDateToDate(filters.dateTo) : undefined}
            onValueChange={(next) =>
              setFilters((prev) => ({
                ...prev,
                dateTo: next ? localDateToIsoDate(next) : '',
              }))
            }
            className="w-44"
          />
        </div>
      </div>

      <Tabs
        value={tab}
        onValueChange={(value) => onTabChange(value as SupervisionsAdminTab)}
      >
        <TabsList>
          <TabsTrigger value="supervisiones">Supervisiones</TabsTrigger>
          <TabsTrigger value="calificaciones">Calificaciones</TabsTrigger>
        </TabsList>

        <TabsContent value="supervisiones" className="pt-3">
          <DataTable
            caption="Supervisiones"
            columns={supervisionColumns}
            data={supervisionRows}
            getRowId={(row) => row.id}
            isLoading={supervisionsQuery.isLoading}
            emptyState={{
              icon: ShieldCheck,
              title: 'No hay supervisiones para mostrar con estos filtros',
            }}
          />
        </TabsContent>

        <TabsContent value="calificaciones" className="pt-3">
          <DataTable
            caption="Calificaciones"
            columns={ratingColumns}
            data={ratingRows}
            getRowId={(row) => row.id}
            isLoading={ratingsQuery.isLoading}
            emptyState={{
              icon: Star,
              title: 'No hay calificaciones para mostrar con estos filtros',
            }}
          />
        </TabsContent>
      </Tabs>
    </div>
  )
}

export { SupervisionsAdminScreen }
export type { SupervisionsAdminTab }
