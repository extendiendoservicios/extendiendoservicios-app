import { useMemo, useState } from 'react'
import { Link } from 'react-router'
import { Plus, Search, Users as UsersIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  DataTable,
  type DataTableColumnDef,
  type DataTablePagination,
} from '@/components/DataTable'
import { PersonCell } from '@/components/PersonCell'
import { StatusBadge, getStatusMeta } from '@/components/status'
import { avatarUrl } from '@/lib/avatarUrl'
import { useAuth } from '@/features/auth/AuthProvider'
import { ROLE_LABELS } from '@/features/auth/session'
import { useDebouncedValue } from '@/hooks/useDebouncedValue'
import type {
  EmployeeEffectiveStatus,
  EmployeeListFilters,
  EmployeeListRow,
} from '@/api/employees'
import { useClientFilterOptionsQuery } from '@/features/sites/queries'
import { UpdatedAgo } from '@/features/employees/components/UpdatedAgo'
import {
  EMPLOYEE_ROLE_FILTER_OPTIONS,
  filterEmployeesByClient,
} from '@/features/employees/employeeListFilters'
import { canManageEmployeeAccounts } from '@/features/employees/permissions'
import {
  useEmployeeClientPermissionsQuery,
  useEmployeesQuery,
} from '@/features/employees/queries'

/**
 * ADM-16 "Empleados · listado" (EMP-002, `05` línea 65): tabla con foto y
 * nombre, legajo, roles, estado efectivo (incluido "De licencia"), teléfono
 * y filtros por texto, rol, estado y cliente habilitado. Paginación en el
 * cliente: `v_employees` no trae "próximo turno" (columna que el criterio de
 * EMP-002 deja condicionada a "si `v_employees` lo trae" -- no está en la
 * vista real, ver el reporte del encargo), así que esa columna queda afuera.
 */
const PAGE_SIZE = 20

const EMPLOYEE_STATUS_FILTER_OPTIONS: {
  value: EmployeeEffectiveStatus | 'all'
  label: string
}[] = [
  { value: 'all', label: 'Todos los estados' },
  {
    value: 'active',
    label: getStatusMeta({ domain: 'employee', status: 'active' }).label,
  },
  {
    value: 'on_leave',
    label: getStatusMeta({ domain: 'employee', status: 'on_leave' }).label,
  },
  {
    value: 'terminated',
    label: getStatusMeta({ domain: 'employee', status: 'terminated' }).label,
  },
]

export default function EmployeesPage() {
  const auth = useAuth()
  const actor = useMemo(
    () => ({ roles: auth.roles, capabilities: auth.capabilities }),
    [auth.roles, auth.capabilities],
  )

  const [textFilter, setTextFilter] = useState('')
  const debouncedText = useDebouncedValue(textFilter)
  const [roleFilter, setRoleFilter] =
    useState<EmployeeListFilters['role']>('all')
  const [statusFilter, setStatusFilter] = useState<
    EmployeeEffectiveStatus | 'all'
  >('all')
  const [clientFilter, setClientFilter] = useState<string>('all')
  const [pagination, setPagination] = useState<DataTablePagination>({
    pageIndex: 0,
    pageSize: PAGE_SIZE,
  })

  const employeesQuery = useEmployeesQuery({
    text: debouncedText,
    role: roleFilter,
    status: statusFilter,
  })
  const clientPermissionsQuery = useEmployeeClientPermissionsQuery()
  const clientOptionsQuery = useClientFilterOptionsQuery()

  const filteredRows = useMemo(() => {
    const rows = employeesQuery.data ?? []
    return filterEmployeesByClient(
      rows,
      clientFilter,
      clientPermissionsQuery.data ?? new Map<string, string[]>(),
    )
  }, [employeesQuery.data, clientFilter, clientPermissionsQuery.data])

  // Cualquier cambio de filtro vuelve a la primera página (evita quedar en
  // una página vacía si el filtro nuevo trae menos resultados).
  const filtersKey = `${debouncedText}|${roleFilter}|${statusFilter}|${clientFilter}`
  const [lastFiltersKey, setLastFiltersKey] = useState(filtersKey)
  if (filtersKey !== lastFiltersKey) {
    setLastFiltersKey(filtersKey)
    if (pagination.pageIndex !== 0) {
      setPagination({ ...pagination, pageIndex: 0 })
    }
  }

  const pageRows = filteredRows.slice(
    pagination.pageIndex * pagination.pageSize,
    pagination.pageIndex * pagination.pageSize + pagination.pageSize,
  )

  const columns: DataTableColumnDef<EmployeeListRow>[] = [
    {
      id: 'name',
      header: 'Nombre',
      meta: { card: 'title' },
      cell: ({ row }) => (
        <Link
          to={`/admin/empleados/${row.original.profileId}`}
          className="hover:text-primary-800"
        >
          <PersonCell
            id={row.original.profileId}
            name={`${row.original.firstName} ${row.original.lastName}`}
            subtitle={`Legajo ${row.original.employeeNumber}`}
            avatarSrc={
              row.original.avatarPath
                ? avatarUrl(row.original.avatarPath)
                : null
            }
          />
        </Link>
      ),
    },
    {
      id: 'roles',
      header: 'Roles',
      meta: { card: 'meta', cardLabel: 'Roles' },
      cell: ({ row }) =>
        row.original.roles.map((role) => ROLE_LABELS[role]).join(', ') || '—',
    },
    {
      id: 'status',
      header: 'Estado',
      meta: { card: 'meta', cardLabel: 'Estado' },
      cell: ({ row }) => (
        <StatusBadge domain="employee" status={row.original.effectiveStatus} />
      ),
    },
    {
      id: 'phone',
      header: 'Teléfono',
      meta: { card: 'meta', cardLabel: 'Teléfono' },
      cell: ({ row }) => row.original.phone ?? '',
    },
  ]

  const hasActiveFilters =
    debouncedText.length > 0 ||
    roleFilter !== 'all' ||
    statusFilter !== 'all' ||
    clientFilter !== 'all'

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3">
          {employeesQuery.dataUpdatedAt > 0 && (
            <UpdatedAgo dataUpdatedAt={employeesQuery.dataUpdatedAt} />
          )}
          <Input
            icon={Search}
            placeholder="Buscar por nombre, DNI o legajo…"
            value={textFilter}
            onChange={(event) => setTextFilter(event.target.value)}
            className="w-64"
          />
          <Select
            value={roleFilter}
            onValueChange={(value) =>
              setRoleFilter(value as EmployeeListFilters['role'])
            }
          >
            <SelectTrigger aria-label="Filtrar por rol">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {EMPLOYEE_ROLE_FILTER_OPTIONS.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select
            value={statusFilter}
            onValueChange={(value) =>
              setStatusFilter(value as EmployeeEffectiveStatus | 'all')
            }
          >
            <SelectTrigger aria-label="Filtrar por estado">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {EMPLOYEE_STATUS_FILTER_OPTIONS.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={clientFilter} onValueChange={setClientFilter}>
            <SelectTrigger
              aria-label="Filtrar por cliente habilitado"
              className="w-56"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos los clientes</SelectItem>
              {(clientOptionsQuery.data ?? []).map((option) => (
                <SelectItem key={option.id} value={option.id}>
                  {option.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        {canManageEmployeeAccounts(actor) && (
          <Button asChild icon={Plus}>
            <Link to="/admin/empleados/nuevo">Nuevo empleado</Link>
          </Button>
        )}
      </div>

      <DataTable
        caption="Empleados y supervisores"
        columns={columns}
        data={pageRows}
        getRowId={(row) => row.profileId}
        isLoading={employeesQuery.isLoading}
        pagination={pagination}
        onPaginationChange={setPagination}
        pageCount={Math.ceil(filteredRows.length / pagination.pageSize)}
        rowCount={filteredRows.length}
        emptyState={{
          icon: UsersIcon,
          title: hasActiveFilters
            ? 'No encontramos empleados con esos filtros'
            : 'Todavía no hay empleados cargados',
          description:
            !hasActiveFilters && canManageEmployeeAccounts(actor)
              ? 'Creá el primero con "Nuevo empleado".'
              : undefined,
        }}
      />
    </div>
  )
}
