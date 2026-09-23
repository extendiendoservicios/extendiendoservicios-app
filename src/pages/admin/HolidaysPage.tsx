import { useMemo, useState } from 'react'
import { CalendarDays, Download, Plus, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { DataTable, type DataTableColumnDef } from '@/components/DataTable'
import { IconButton } from '@/components/IconButton'
import { useAuth } from '@/features/auth/AuthProvider'
import { isApiError } from '@/api/errors'
import type { Holiday } from '@/api/settings'
import { ConfigNav } from '@/features/settings/components/ConfigNav'
import { HolidayFormDialog } from '@/features/settings/components/HolidayFormDialog'
import { OwnerOnlyNotice } from '@/features/settings/components/OwnerOnlyNotice'
import { SimpleConfirmDialog } from '@/features/settings/components/SimpleConfirmDialog'
import { YearPicker } from '@/features/settings/components/YearPicker'
import { formatDateOnly } from '@/features/settings/dateOnly'
import { canViewOwnerOnlyConfig } from '@/features/settings/permissions'
import {
  useDeactivateHolidayMutation,
  useHolidaysQuery,
  useLoadNationalHolidaysMutation,
} from '@/features/settings/queries'

/**
 * ADM-29 "Feriados" (USERS-014, `05` línea 93): lista por año, alta y baja
 * lógica, y "Cargar feriados nacionales de <año>" (`nationalHolidays.ts`).
 * Solo dueño (`canViewOwnerOnlyConfig`).
 */
export default function HolidaysPage() {
  const auth = useAuth()
  const isOwnerViewer = canViewOwnerOnlyConfig(auth)

  const [year, setYear] = useState(() => new Date().getFullYear())
  const holidaysQuery = useHolidaysQuery(year)
  const deactivateHoliday = useDeactivateHolidayMutation(year)
  const loadNationalHolidays = useLoadNationalHolidaysMutation(year)

  const [isNewHolidayOpen, setNewHolidayOpen] = useState(false)
  const [holidayToDeactivate, setHolidayToDeactivate] =
    useState<Holiday | null>(null)

  const activeHolidays = useMemo(
    () =>
      (holidaysQuery.data ?? []).filter((holiday) => holiday.deletedAt == null),
    [holidaysQuery.data],
  )

  async function handleDeactivate() {
    if (!holidayToDeactivate) {
      return
    }
    try {
      await deactivateHoliday.mutateAsync({
        id: holidayToDeactivate.id,
        updatedBy: auth.userId as string,
      })
      toast.success('Dimos de baja el feriado.')
      setHolidayToDeactivate(null)
    } catch (error) {
      toast.error(
        isApiError(error)
          ? error.message
          : 'No pudimos dar de baja el feriado.',
      )
    }
  }

  async function handleLoadNationalHolidays() {
    try {
      const result = await loadNationalHolidays.mutateAsync({
        createdBy: auth.userId as string,
      })
      const parts: string[] = []
      if (result.created > 0) parts.push(`${result.created} nuevos`)
      if (result.reactivated > 0)
        parts.push(`${result.reactivated} reactivados`)
      if (result.skipped > 0) parts.push(`${result.skipped} ya existían`)
      toast.success(
        parts.length > 0
          ? `Feriados nacionales de ${year}: ${parts.join(', ')}.`
          : `No agregamos feriados nuevos de ${year}.`,
      )
    } catch (error) {
      toast.error(
        isApiError(error)
          ? error.message
          : 'No pudimos cargar los feriados nacionales.',
      )
    }
  }

  const columns: DataTableColumnDef<Holiday>[] = [
    {
      id: 'date',
      header: 'Fecha',
      meta: { card: 'title' },
      cell: ({ row }) => (
        <span className="font-medium text-text">
          {formatDateOnly(row.original.holidayDate)}
        </span>
      ),
    },
    {
      id: 'name',
      header: 'Nombre',
      meta: { card: 'subtitle' },
      cell: ({ row }) => row.original.name ?? '—',
    },
    {
      id: 'actions',
      header: '',
      meta: { card: 'trailing', align: 'end' },
      cell: ({ row }) => (
        <IconButton
          icon={Trash2}
          aria-label={`Dar de baja el feriado ${row.original.name ?? ''}`}
          onClick={() => setHolidayToDeactivate(row.original)}
        />
      ),
    },
  ]

  return (
    <div className="flex flex-col gap-4">
      <ConfigNav roles={auth.roles} />

      {!isOwnerViewer ? (
        <OwnerOnlyNotice />
      ) : (
        <>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <YearPicker year={year} onYearChange={setYear} />
            <div className="flex flex-wrap items-center gap-2">
              <Button
                variant="ghost"
                icon={Download}
                size="sm"
                loading={loadNationalHolidays.isPending}
                onClick={() => void handleLoadNationalHolidays()}
              >
                Cargar feriados nacionales de {year}
              </Button>
              <Button
                icon={Plus}
                size="sm"
                onClick={() => setNewHolidayOpen(true)}
              >
                Nuevo feriado
              </Button>
            </div>
          </div>

          <DataTable
            caption={`Feriados de ${year}`}
            columns={columns}
            data={activeHolidays}
            getRowId={(row) => row.id}
            isLoading={holidaysQuery.isLoading}
            emptyState={{
              icon: CalendarDays,
              title: `No hay feriados cargados para ${year}`,
              description:
                'Agregalos a mano o usá "Cargar feriados nacionales".',
            }}
          />

          <HolidayFormDialog
            year={year}
            createdBy={auth.userId as string}
            open={isNewHolidayOpen}
            onOpenChange={setNewHolidayOpen}
          />

          <SimpleConfirmDialog
            open={holidayToDeactivate != null}
            onOpenChange={(open) => !open && setHolidayToDeactivate(null)}
            title="Dar de baja este feriado"
            description={
              holidayToDeactivate
                ? `${formatDateOnly(holidayToDeactivate.holidayDate)} · ${holidayToDeactivate.name ?? ''}. Los turnos que ya se generaron no se modifican.`
                : undefined
            }
            confirmLabel="Dar de baja"
            isLoading={deactivateHoliday.isPending}
            onConfirm={() => void handleDeactivate()}
          />
        </>
      )}
    </div>
  )
}
