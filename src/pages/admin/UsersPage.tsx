import {
  createContext,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import { Link, useSearchParams } from 'react-router'
import {
  ChevronDown,
  ChevronUp,
  ChevronsUpDown,
  Search,
  UserPlus,
  Users as UsersIcon,
} from 'lucide-react'
import { cn } from 'cn'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { SegmentedControl } from '@/components/SegmentedControl'
import { DataTable, type DataTableColumnDef } from '@/components/DataTable'
import { PersonCell } from '@/components/PersonCell'
import { StatusBadge } from '@/components/status'
import { useAuth } from '@/features/auth/AuthProvider'
import { ROLE_LABELS } from '@/features/auth/session'
import type { AdminUserRow } from '@/api/users'
import { ConfigNav } from '@/features/settings/components/ConfigNav'
import { NewAdminUserSheet } from '@/features/users/components/NewAdminUserSheet'
import { RolesCapabilitiesSheet } from '@/features/users/components/RolesCapabilitiesSheet'
import { UpdatedAgo } from '@/features/users/components/UpdatedAgo'
import { UserActionsMenu } from '@/features/users/components/UserActionsMenu'
import {
  canCreateAdminUser,
  type UsersScreenActor,
} from '@/features/users/permissions'
import {
  useLastSignInsQuery,
  useUsersDirectoryQuery,
  useUsersQuery,
} from '@/features/users/queries'
import {
  applyUserList,
  buildUserListParams,
  parseUserListParams,
  USER_FILTER_ROLES,
  USER_SORT_LABELS,
  USER_STATUS_OPTIONS,
  type UserListRow,
  type UserListState,
  type UserSortDirection,
  type UserSortKey,
} from '@/features/users/userListFilters'
import type { Role } from '@/api/users'
import { avatarUrl } from '@/lib/avatarUrl'
import { userDetailPath } from '@/features/users/userNavigation'
import { formatShortDate, formatTime } from '@/lib/format'

/**
 * ADM-27 "Usuarios y roles" (USERS-008 a USERS-011, `05_Pantallas_y_
 * Navegacion.md` línea 91). Sin `<h1>` propio: `AdminShell` ya muestra
 * título/subtítulo de la ruta (`configuracion/usuarios` en `adminRoutes.tsx`)
 * en su topbar, mismo criterio que `ProfilePage`.
 */

interface UserRowView extends AdminUserRow, UserListRow {}

/** Orden actual: lo leen los encabezados sin tener que rehacer las columnas. */
const SortContext = createContext<{
  sortKey: UserSortKey
  sortDirection: UserSortDirection
  onSort: (key: UserSortKey) => void
}>({ sortKey: 'legajo', sortDirection: 'asc', onSort: () => undefined })

/** Encabezado ordenable (OG-12): Nombre, Legajo y Último ingreso. */
function SortHeader({
  columnKey,
  label,
}: {
  columnKey: UserSortKey
  label: string
}) {
  const { sortKey, sortDirection, onSort } = useContext(SortContext)
  const active = sortKey === columnKey
  const Icon = !active
    ? ChevronsUpDown
    : sortDirection === 'asc'
      ? ChevronUp
      : ChevronDown
  return (
    <button
      type="button"
      onClick={() => onSort(columnKey)}
      aria-label={`Ordenar por ${label.toLowerCase()}`}
      className="inline-flex items-center gap-[3px] text-inherit uppercase hover:text-text-2"
    >
      {label}
      <Icon
        aria-hidden="true"
        className={cn('size-3', !active && 'text-text-3/70')}
      />
    </button>
  )
}

/** Filtro de un toque (rol, «Sin ficha laboral»); `aria-pressed` para lectores de pantalla. */
function FilterChip({
  pressed,
  onClick,
  children,
}: {
  pressed: boolean
  onClick: () => void
  children: ReactNode
}) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      onClick={onClick}
      className={cn(
        'inline-flex min-h-8 items-center rounded-full border px-3 text-[12.5px] font-medium transition-colors max-md:min-h-11',
        pressed
          ? 'border-primary bg-primary-50 text-primary-800'
          : 'border-border bg-surface text-text-2 hover:bg-muted',
      )}
    >
      {children}
    </button>
  )
}

export default function UsersPage() {
  const auth = useAuth()
  const actor: UsersScreenActor = useMemo(
    () => ({ roles: auth.roles, capabilities: auth.capabilities }),
    [auth.roles, auth.capabilities],
  )
  // `security_events` solo lo lee el owner (04 sección 7.2) -- ver el
  // comentario de `fetchLastSignIns` en `src/api/users.ts`.
  const isOwnerViewer = auth.roles.includes('owner')

  const usersQuery = useUsersQuery()
  const lastSignInsQuery = useLastSignInsQuery(isOwnerViewer)
  // OG-12: legajo, DNI y email en una query aparte; si falla, el listado
  // se muestra igual, sin esas columnas.
  const directoryQuery = useUsersDirectoryQuery()

  // OG-12: búsqueda, filtros y orden viven en la URL para no perderlos al volver de una ficha.
  const [searchParams, setSearchParams] = useSearchParams()
  const parsedState = useMemo(
    () => parseUserListParams(searchParams),
    [searchParams],
  )
  // «Último ingreso» solo lo ve la dirección: para otros, vuelve al orden por legajo.
  const listState = useMemo<UserListState>(
    () =>
      !isOwnerViewer && parsedState.sortKey === 'lastSignIn'
        ? { ...parsedState, sortKey: 'legajo', sortDirection: 'asc' }
        : parsedState,
    [parsedState, isOwnerViewer],
  )

  function updateListState(patch: Partial<UserListState>) {
    setSearchParams(
      buildUserListParams({ ...listState, ...patch }, searchParams),
      {
        replace: true,
      },
    )
  }

  function handleSort(key: UserSortKey) {
    updateListState(
      key === listState.sortKey
        ? { sortDirection: listState.sortDirection === 'asc' ? 'desc' : 'asc' }
        : {
            sortKey: key,
            sortDirection: key === 'lastSignIn' ? 'desc' : 'asc',
          },
    )
  }

  function toggleRole(role: Role) {
    updateListState({
      roles: listState.roles.includes(role)
        ? listState.roles.filter((value) => value !== role)
        : [...listState.roles, role],
    })
  }

  const [isNewUserOpen, setNewUserOpen] = useState(false)
  const [rolesUserId, setRolesUserId] = useState<string | null>(null)
  const [isRolesSheetOpen, setRolesSheetOpen] = useState(false)

  const allRows = useMemo<UserRowView[]>(() => {
    const users = usersQuery.data ?? []
    return users.map((user) => {
      const entry = directoryQuery.data?.get(user.profileId)
      return {
        ...user,
        employeeNumber: entry?.employeeNumber ?? null,
        dni: entry?.dni ?? null,
        email: entry?.email ?? null,
        lastSignInAt: lastSignInsQuery.data?.get(user.profileId) ?? null,
      }
    })
  }, [usersQuery.data, lastSignInsQuery.data, directoryQuery.data])

  // Búsqueda, filtros y orden se aplican en el cliente sobre la lista ya
  // cargada (ver `userListFilters.ts`).
  const rows = useMemo(
    () => applyUserList(allRows, listState),
    [allRows, listState],
  )

  // Se deriva de `allRows` (no de `rows`, ya filtradas por el interruptor, ni
  // de una copia guardada al hacer clic): así, si el interruptor está
  // apagado y de algún modo la fila pasa a estar desactivada mientras el
  // panel sigue abierto (otra pestaña, refresco de 60 s), el drawer no se
  // cierra solo por dejar de estar en `rows`. También permite que, si se
  // cambian los roles y la lista se refresca, el propio drawer vea de una
  // si ahora corresponde mostrar el panel de capacidades (que depende de si
  // la persona tiene rol admin) sin tener que cerrarlo y abrirlo de nuevo.
  // Se mantiene el id (no se limpia al cerrar) para no perder la animación
  // de salida del `Sheet`.
  const rolesUser = allRows.find((row) => row.profileId === rolesUserId) ?? null

  // Memorizadas: `flexRender` monta cada `cell` como un componente, así que
  // una función nueva en cada render desmonta la celda. Sin esto, el menú
  // "Acciones" (y el diálogo que abre) se cerraba solo cuando llegaban los
  // últimos ingresos o con el refresco de la lista.
  const columns = useMemo<DataTableColumnDef<UserRowView>[]>(
    () => [
      {
        id: 'name',
        header: () => <SortHeader columnKey="name" label="Nombre" />,
        enableSorting: false,
        meta: { card: 'title' },
        cell: ({ row }) => {
          // AJ2-11 y AJ2-12: foto de la persona y clic que abre su ficha.
          // El vínculo vive solo en esta celda: el menú "Acciones" queda
          // aparte y no dispara la navegación.
          const person = (
            <PersonCell
              id={row.original.profileId}
              name={`${row.original.firstName} ${row.original.lastName}`}
              subtitle={
                row.original.roles
                  .map((role) => ROLE_LABELS[role])
                  .join(', ') || 'Sin rol asignado'
              }
              avatarSrc={
                row.original.avatarPath
                  ? avatarUrl(row.original.avatarPath)
                  : null
              }
            />
          )
          const path = userDetailPath(row.original)
          return path ? (
            <Link to={path} className="hover:text-primary-800">
              {person}
            </Link>
          ) : (
            person
          )
        },
      },
      {
        id: 'legajo',
        header: () => <SortHeader columnKey="legajo" label="Legajo" />,
        enableSorting: false,
        meta: { card: 'meta', cardLabel: 'Legajo' },
        cell: ({ row }) =>
          row.original.employeeNumber != null ? (
            <span className="tabular-nums">{row.original.employeeNumber}</span>
          ) : (
            <span className="text-text-3">—</span>
          ),
      },
      {
        id: 'status',
        header: 'Estado',
        meta: { card: 'meta', cardLabel: 'Estado' },
        cell: ({ row }) => (
          <StatusBadge
            domain="user"
            status={row.original.deletedAt ? 'desactivado' : 'activo'}
          />
        ),
      },
      // Solo para el dueño: un administrador no puede leer `security_events`,
      // y una columna vacía diría "nunca entró" de gente que sí entró.
      ...(isOwnerViewer
        ? [
            {
              id: 'lastSignIn',
              header: () => (
                <SortHeader columnKey="lastSignIn" label="Último ingreso" />
              ),
              enableSorting: false,
              meta: { card: 'meta', cardLabel: 'Último ingreso' },
              cell: ({ row }) => {
                const value = row.original.lastSignInAt
                if (!value) {
                  return <span className="text-text-3">—</span>
                }
                return (
                  <span>
                    {formatShortDate(value)}, {formatTime(value)}
                  </span>
                )
              },
            } satisfies DataTableColumnDef<UserRowView>,
          ]
        : []),
      {
        id: 'actions',
        header: '',
        meta: { card: 'trailing', align: 'end' },
        cell: ({ row }) => (
          <UserActionsMenu
            user={row.original}
            actor={actor}
            onEditRolesAndCapabilities={() => {
              setRolesUserId(row.original.profileId)
              setRolesSheetOpen(true)
            }}
          />
        ),
      },
    ],
    [isOwnerViewer, actor],
  )

  return (
    <div className="flex flex-col gap-4">
      <ConfigNav roles={auth.roles} />

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-4">
          {usersQuery.dataUpdatedAt > 0 && (
            <UpdatedAgo dataUpdatedAt={usersQuery.dataUpdatedAt} />
          )}
        </div>
        {canCreateAdminUser(actor) && (
          <Button icon={UserPlus} onClick={() => setNewUserOpen(true)}>
            Nuevo administrador
          </Button>
        )}
      </div>

      <div className="flex flex-col gap-3" role="search">
        <div className="relative">
          <Search
            aria-hidden="true"
            className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-text-3"
          />
          <Input
            type="search"
            value={listState.search}
            onChange={(event) =>
              updateListState({ search: event.target.value })
            }
            placeholder="Buscar por nombre, apellido, legajo, DNI o email"
            aria-label="Buscar usuarios"
            className="pl-9"
          />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <SegmentedControl
            aria-label="Estado"
            options={USER_STATUS_OPTIONS}
            value={listState.status}
            onValueChange={(status) => updateListState({ status })}
          />
          <div
            role="group"
            aria-label="Filtrar por rol"
            className="flex flex-wrap gap-2"
          >
            {USER_FILTER_ROLES.map((role) => (
              <FilterChip
                key={role.value}
                pressed={listState.roles.includes(role.value)}
                onClick={() => toggleRole(role.value)}
              >
                {role.label}
              </FilterChip>
            ))}
          </div>
          <FilterChip
            pressed={listState.noEmployeeRecord}
            onClick={() =>
              updateListState({ noEmployeeRecord: !listState.noEmployeeRecord })
            }
          >
            Sin ficha laboral
          </FilterChip>
          {/* En el celular las tarjetas no tienen encabezados: el orden se elige acá. */}
          <div className="flex items-center gap-2 md:hidden">
            <Select
              value={listState.sortKey}
              onValueChange={(value) => handleSort(value as UserSortKey)}
            >
              <SelectTrigger aria-label="Ordenar por" className="w-44">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(Object.keys(USER_SORT_LABELS) as UserSortKey[])
                  .filter((key) => key !== 'lastSignIn' || isOwnerViewer)
                  .map((key) => (
                    <SelectItem key={key} value={key}>
                      {USER_SORT_LABELS[key]}
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              aria-label={
                listState.sortDirection === 'asc'
                  ? 'Orden ascendente'
                  : 'Orden descendente'
              }
              onClick={() => handleSort(listState.sortKey)}
            >
              {listState.sortDirection === 'asc' ? 'A→Z' : 'Z→A'}
            </Button>
          </div>
        </div>
        {!usersQuery.isLoading && (
          <p className="text-[12px] text-text-3" aria-live="polite">
            {rows.length} de {allRows.length} usuarios
          </p>
        )}
      </div>

      <SortContext.Provider
        value={{
          sortKey: listState.sortKey,
          sortDirection: listState.sortDirection,
          onSort: handleSort,
        }}
      >
        <DataTable
          caption="Usuarios y roles"
          columns={columns}
          data={rows}
          getRowId={(row) => row.profileId}
          isLoading={usersQuery.isLoading}
          emptyState={
            allRows.length === 0
              ? {
                  icon: UsersIcon,
                  title: 'Todavía no hay usuarios',
                  description: canCreateAdminUser(actor)
                    ? 'Creá el primer administrador con "Nuevo administrador".'
                    : undefined,
                }
              : {
                  icon: UsersIcon,
                  title: 'No hay usuarios con esos filtros',
                  description:
                    'Probá con otra búsqueda o cambiá los filtros de arriba.',
                }
          }
        />
      </SortContext.Provider>

      <NewAdminUserSheet open={isNewUserOpen} onOpenChange={setNewUserOpen} />

      {rolesUser && (
        <RolesCapabilitiesSheet
          user={rolesUser}
          open={isRolesSheetOpen}
          onOpenChange={setRolesSheetOpen}
        />
      )}
    </div>
  )
}
