import { useMemo, useState } from 'react'
import { ShieldCheck } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { DataTable, type DataTableColumnDef } from '@/components/DataTable'
import { DatePicker } from '@/components/DatePicker'
import { Combobox } from '@/components/Combobox'
import { useAuth } from '@/features/auth/AuthProvider'
import type { SecurityEvent, SecurityEventType } from '@/api/settings'
import { useUsersQuery } from '@/features/users/queries'
import { ConfigNav } from '@/features/settings/components/ConfigNav'
import { OwnerOnlyNotice } from '@/features/settings/components/OwnerOnlyNotice'
import { localDateToIsoDate } from '@/features/settings/dateOnly'
import { canViewOwnerOnlyConfig } from '@/features/settings/permissions'
import { useSecurityEventsQuery } from '@/features/settings/queries'
import {
  SECURITY_EVENT_TYPES,
  SECURITY_EVENT_TYPE_LABELS,
} from '@/features/settings/securityEventLabels'
import { formatShortDate, formatTime } from '@/lib/format'

/** Valor especial del `Select` para "todos" (Radix no admite `value=""`). */
const ALL_EVENT_TYPES = 'all'
const ALL_USERS = 'all'

/**
 * ADM-31 "Eventos de seguridad" (USERS-016, `05` línea 95): tabla filtrable
 * por tipo, usuario y fecha, solo lectura. Solo dueño.
 */
export default function SecurityEventsPage() {
  const auth = useAuth()
  const isOwnerViewer = canViewOwnerOnlyConfig(auth)

  const [eventType, setEventType] = useState<
    SecurityEventType | typeof ALL_EVENT_TYPES
  >(ALL_EVENT_TYPES)
  const [actorId, setActorId] = useState<string>(ALL_USERS)
  const [dateFrom, setDateFrom] = useState<Date | undefined>(undefined)
  const [dateTo, setDateTo] = useState<Date | undefined>(undefined)

  // Solo se pide si es dueño (mismo criterio que `fetchLastSignIns` en
  // `users.ts`): para poblar el combobox de "usuario" con nombre y apellido
  // de cualquier persona (no solo administradores), reutiliza la lista de
  // ADM-27 en vez de duplicarla.
  const usersQuery = useUsersQuery()
  const userOptions = useMemo(
    () => [
      { value: ALL_USERS, label: 'Todas las personas' },
      ...(usersQuery.data ?? []).map((user) => ({
        value: user.profileId,
        label: `${user.firstName} ${user.lastName}`,
      })),
    ],
    [usersQuery.data],
  )

  const securityEventsQuery = useSecurityEventsQuery({
    eventType: eventType === ALL_EVENT_TYPES ? undefined : eventType,
    actorId: actorId === ALL_USERS ? undefined : actorId,
    dateFrom: dateFrom ? localDateToIsoDate(dateFrom) : undefined,
    dateTo: dateTo ? localDateToIsoDate(dateTo) : undefined,
  })

  function handleClearFilters() {
    setEventType(ALL_EVENT_TYPES)
    setActorId(ALL_USERS)
    setDateFrom(undefined)
    setDateTo(undefined)
  }

  const hasActiveFilters =
    eventType !== ALL_EVENT_TYPES ||
    actorId !== ALL_USERS ||
    dateFrom != null ||
    dateTo != null

  const columns: DataTableColumnDef<SecurityEvent>[] = [
    {
      id: 'when',
      header: 'Fecha y hora',
      meta: { card: 'title' },
      cell: ({ row }) => (
        <span className="font-medium text-text">
          {formatShortDate(row.original.createdAt)},{' '}
          {formatTime(row.original.createdAt)}
        </span>
      ),
    },
    {
      id: 'type',
      header: 'Evento',
      meta: { card: 'meta', cardLabel: 'Evento' },
      cell: ({ row }) => SECURITY_EVENT_TYPE_LABELS[row.original.eventType],
    },
    {
      id: 'actor',
      header: 'Quién',
      meta: { card: 'meta', cardLabel: 'Quién' },
      cell: ({ row }) => row.original.actorName ?? '—',
    },
    {
      id: 'target',
      header: 'Sobre quién',
      meta: { card: 'meta', cardLabel: 'Sobre quién' },
      cell: ({ row }) => row.original.targetName ?? '—',
    },
  ]

  return (
    <div className="flex flex-col gap-4">
      <ConfigNav roles={auth.roles} />

      {!isOwnerViewer ? (
        <OwnerOnlyNotice />
      ) : (
        <>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Select
              value={eventType}
              onValueChange={(value) =>
                setEventType(
                  value as SecurityEventType | typeof ALL_EVENT_TYPES,
                )
              }
            >
              <SelectTrigger
                aria-label="Filtrar por tipo de evento"
                className="w-full"
              >
                <SelectValue placeholder="Tipo de evento" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL_EVENT_TYPES}>
                  Todos los tipos de evento
                </SelectItem>
                {SECURITY_EVENT_TYPES.map((type) => (
                  <SelectItem key={type} value={type}>
                    {SECURITY_EVENT_TYPE_LABELS[type]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Combobox
              options={userOptions}
              value={actorId}
              onValueChange={setActorId}
              placeholder="Usuario"
              searchPlaceholder="Buscar usuario…"
              aria-label="Filtrar por usuario"
            />

            <DatePicker
              value={dateFrom}
              onValueChange={setDateFrom}
              placeholder="Desde"
              aria-label="Filtrar desde esta fecha"
            />

            <DatePicker
              value={dateTo}
              onValueChange={setDateTo}
              placeholder="Hasta"
              aria-label="Filtrar hasta esta fecha"
            />
          </div>

          {hasActiveFilters && (
            <Button
              type="button"
              variant="link"
              size="sm"
              className="self-start"
              onClick={handleClearFilters}
            >
              Limpiar filtros
            </Button>
          )}

          <DataTable
            caption="Eventos de seguridad"
            columns={columns}
            data={securityEventsQuery.data ?? []}
            getRowId={(row) => row.id}
            isLoading={securityEventsQuery.isLoading}
            emptyState={{
              icon: ShieldCheck,
              title: 'No hay eventos para estos filtros',
            }}
          />
        </>
      )}
    </div>
  )
}
