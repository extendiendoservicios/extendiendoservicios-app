import { useMemo, useState } from 'react'
import { UserPlus, Users as UsersIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { DataTable, type DataTableColumnDef } from '@/components/DataTable'
import { PersonCell } from '@/components/PersonCell'
import { StatusBadge } from '@/components/status'
import { useAuth } from '@/features/auth/AuthProvider'
import { ROLE_LABELS } from '@/features/auth/session'
import type { AdminUserRow } from '@/api/users'
import { NewAdminUserSheet } from '@/features/users/components/NewAdminUserSheet'
import { RolesCapabilitiesSheet } from '@/features/users/components/RolesCapabilitiesSheet'
import { UpdatedAgo } from '@/features/users/components/UpdatedAgo'
import { UserActionsMenu } from '@/features/users/components/UserActionsMenu'
import {
  canCreateAdminUser,
  type UsersScreenActor,
} from '@/features/users/permissions'
import { useLastSignInsQuery, useUsersQuery } from '@/features/users/queries'
import { formatShortDate, formatTime } from '@/lib/format'

/**
 * ADM-27 "Usuarios y roles" (USERS-008 a USERS-011, `05_Pantallas_y_
 * Navegacion.md` línea 91). Sin `<h1>` propio: `AdminShell` ya muestra
 * título/subtítulo de la ruta (`configuracion/usuarios` en `adminRoutes.tsx`)
 * en su topbar, mismo criterio que `ProfilePage`.
 */

interface UserRowView extends AdminUserRow {
  lastSignInAt: string | null
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

  const [isNewUserOpen, setNewUserOpen] = useState(false)
  const [rolesUserId, setRolesUserId] = useState<string | null>(null)
  const [isRolesSheetOpen, setRolesSheetOpen] = useState(false)

  function openRolesSheet(user: AdminUserRow) {
    setRolesUserId(user.profileId)
    setRolesSheetOpen(true)
  }

  const rows = useMemo<UserRowView[]>(() => {
    const users = usersQuery.data ?? []
    return users.map((user) => ({
      ...user,
      lastSignInAt: lastSignInsQuery.data?.get(user.profileId) ?? null,
    }))
  }, [usersQuery.data, lastSignInsQuery.data])

  // Se deriva de `rows` (no de una copia guardada al hacer clic) para que,
  // si se cambian los roles y la lista se refresca, el propio drawer vea de
  // una si ahora corresponde mostrar el panel de capacidades (que depende
  // de si la persona tiene rol admin) sin tener que cerrarlo y abrirlo de
  // nuevo. Se mantiene el id (no se limpia al cerrar) para no perder la
  // animación de salida del `Sheet`.
  const rolesUser = rows.find((row) => row.profileId === rolesUserId) ?? null

  const columns: DataTableColumnDef<UserRowView>[] = [
    {
      id: 'name',
      header: 'Nombre',
      meta: { card: 'title' },
      cell: ({ row }) => (
        <PersonCell
          id={row.original.profileId}
          name={`${row.original.firstName} ${row.original.lastName}`}
          subtitle={
            row.original.roles.map((role) => ROLE_LABELS[role]).join(', ') ||
            'Sin rol asignado'
          }
        />
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
            header: 'Último ingreso',
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
          onEditRolesAndCapabilities={() => openRolesSheet(row.original)}
        />
      ),
    },
  ]

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
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

      <DataTable
        caption="Usuarios y roles"
        columns={columns}
        data={rows}
        getRowId={(row) => row.profileId}
        isLoading={usersQuery.isLoading}
        emptyState={{
          icon: UsersIcon,
          title: 'Todavía no hay usuarios',
          description: canCreateAdminUser(actor)
            ? 'Creá el primer administrador con "Nuevo administrador".'
            : undefined,
        }}
      />

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
