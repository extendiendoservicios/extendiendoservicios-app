import { useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { CalendarClock, Clock, FileText, Users } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { DatePicker } from '@/components/DatePicker'
import { DataTable, type DataTableColumnDef } from '@/components/DataTable'
import { KpiCard } from '@/components/KpiCard'
import { Skeleton } from '@/components/ui/skeleton'
import { PrintSheet } from '@/features/print/PrintSheet'
import { PrintableLetterhead } from '@/features/print/PrintableLetterhead'
import {
  PrintFacts,
  PrintSignatures,
  PrintTable,
} from '@/features/print/PrintTable'
import { isApiError } from '@/api/errors'
import type { ClientServiceSummary, ClientSummaryShift } from '@/api/clients'
import { useClientServiceSummaryQuery } from '@/features/clients/queries'
import { useClientUnstartedAssignmentsQuery } from '@/features/attendance/queries'
import { useEmployeeDnisQuery } from '@/features/employees/queries'
import type { AttendanceBoardRow } from '@/api/attendance'
import {
  buildClientSummarySheet,
  currentMonthRange,
  shiftEmployeeNames,
  summarySheetEmployeeIds,
} from '@/features/clients/serviceSummary'
import { todayInBuenosAires } from '@/features/employees/employeeLeaveStatus'
import {
  formatDateOnly,
  localDateToIsoDate,
} from '@/features/settings/dateOnly'
import { formatMinutes } from '@/lib/format'

function isoDateToDate(isoDate: string): Date {
  return new Date(`${isoDate}T00:00:00`)
}

interface ClientServiceSummaryTabProps {
  clientId: string
  clientName: string
  cuit: string | null
}

/**
 * AJ-09 · «Resumen de servicios» de la ficha del cliente: selector Desde–Hasta
 * (por defecto el mes en curso), tarjetas con turnos realizados, empleados
 * distintos y horas totales (`client_service_summary`), detalle por turno y
 * «Descargar resumen» (hoja membretada imprimible, con una sola firma: la del
 * responsable de administración). Sin polling: se abre a demanda.
 */
function ClientServiceSummaryTab({
  clientId,
  clientName,
  cuit,
}: ClientServiceSummaryTabProps) {
  const initialRange = currentMonthRange(todayInBuenosAires())
  const [from, setFrom] = useState(initialRange.from)
  const [to, setTo] = useState(initialRange.to)
  const [isSheetOpen, setSheetOpen] = useState(false)

  const isRangeValid = from <= to
  const summaryQuery = useClientServiceSummaryQuery(
    clientId,
    from,
    to,
    isRangeValid,
  )
  const summary = summaryQuery.data
  // AJ2-14 y AJ2-16: inasistencias y DNI para la hoja imprimible. Se piden
  // solo al abrir la hoja (el resto de la pestaña no los usa).
  const unstartedQuery = useClientUnstartedAssignmentsQuery(
    clientId,
    from,
    to,
    isSheetOpen && isRangeValid,
  )
  const sheetEmployeeIds = useMemo(
    () =>
      summary && unstartedQuery.data
        ? summarySheetEmployeeIds(summary, unstartedQuery.data)
        : [],
    [summary, unstartedQuery.data],
  )
  const dnisQuery = useEmployeeDnisQuery(
    sheetEmployeeIds,
    isSheetOpen && unstartedQuery.isSuccess,
  )

  const columns: DataTableColumnDef<ClientSummaryShift>[] = [
    {
      id: 'date',
      header: 'Fecha',
      meta: { card: 'title' },
      cell: ({ row }) => (
        <span className="font-semibold text-text capitalize">
          {formatDateOnly(row.original.shiftDate)}
        </span>
      ),
    },
    {
      id: 'site',
      header: 'Sede',
      meta: { card: 'subtitle' },
      cell: ({ row }) => row.original.siteName,
    },
    {
      id: 'franja',
      header: 'Franja',
      meta: { card: 'meta', cardLabel: 'Franja' },
      cell: ({ row }) =>
        `${row.original.startTime.slice(0, 5)}–${row.original.endTime.slice(0, 5)}`,
    },
    {
      id: 'employees',
      header: 'Empleados',
      meta: { card: 'meta', cardLabel: 'Empleados' },
      cell: ({ row }) => shiftEmployeeNames(row.original).join('; ') || '—',
    },
    {
      id: 'hours',
      header: 'Horas',
      meta: { card: 'meta', cardLabel: 'Horas', align: 'end' },
      cell: ({ row }) => (
        <span className="tabular-nums">
          {formatMinutes(row.original.workedMinutes)}
        </span>
      ),
    },
  ]

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex items-center gap-2">
          <span className="text-[11px] font-semibold text-text-2">Desde</span>
          <DatePicker
            aria-label="Desde"
            value={isoDateToDate(from)}
            onValueChange={(next) => next && setFrom(localDateToIsoDate(next))}
            className="w-56"
          />
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[11px] font-semibold text-text-2">Hasta</span>
          <DatePicker
            aria-label="Hasta"
            value={isoDateToDate(to)}
            onValueChange={(next) => next && setTo(localDateToIsoDate(next))}
            className="w-56"
          />
        </div>
        <Button
          className="ml-auto"
          variant="ghost"
          icon={FileText}
          disabled={!summary || !isRangeValid}
          loading={
            isSheetOpen && (unstartedQuery.isLoading || dnisQuery.isLoading)
          }
          onClick={() => setSheetOpen(true)}
        >
          Descargar resumen
        </Button>
      </div>

      {!isRangeValid ? (
        <Alert variant="crit">
          <AlertDescription>
            El rango de fechas no es válido: la fecha desde no puede ser
            posterior a la fecha hasta.
          </AlertDescription>
        </Alert>
      ) : summaryQuery.isError ? (
        <Alert variant="crit">
          <AlertDescription>
            {isApiError(summaryQuery.error)
              ? summaryQuery.error.message
              : 'No pudimos cargar el resumen. Probá de nuevo.'}
          </AlertDescription>
        </Alert>
      ) : summaryQuery.isLoading || !summary ? (
        <Skeleton className="h-40" />
      ) : (
        <>
          <section
            aria-label="Totales del período"
            className="grid grid-cols-1 gap-3 sm:grid-cols-3"
          >
            <KpiCard
              variant="accent"
              icon={CalendarClock}
              label="Turnos realizados"
              value={summary.totals.shiftsDone}
            />
            <KpiCard
              icon={Users}
              label="Empleados distintos"
              value={summary.totals.employeesCount}
            />
            <KpiCard
              icon={Clock}
              label="Horas totales"
              value={formatMinutes(summary.totals.workedMinutes)}
            />
          </section>
          <DataTable
            caption="Turnos realizados del período"
            columns={columns}
            data={summary.shifts}
            getRowId={(row) => row.shiftId}
            emptyState={{
              icon: CalendarClock,
              title: 'No hubo turnos realizados en este período',
            }}
          />
        </>
      )}

      {isSheetOpen && summary && (
        <ClientSummarySheetLoader
          clientName={clientName}
          cuit={cuit}
          summary={summary}
          absences={unstartedQuery.data}
          dnis={dnisQuery.data}
          isLoading={
            unstartedQuery.isLoading ||
            (sheetEmployeeIds.length > 0 && dnisQuery.isLoading)
          }
          hasError={unstartedQuery.isError || dnisQuery.isError}
          onClose={() => setSheetOpen(false)}
        />
      )}
    </div>
  )
}

/**
 * Espera los datos extra de la hoja (inasistencias y DNI, AJ2-14 y AJ2-16)
 * antes de armarla, para que lo que se imprime esté completo. Si alguna de
 * las dos consultas falla, avisa en lugar de imprimir una hoja incompleta.
 */
function ClientSummarySheetLoader({
  isLoading,
  hasError,
  onClose,
  ...sheetProps
}: {
  clientName: string
  cuit: string | null
  summary: ClientServiceSummary
  absences: AttendanceBoardRow[] | undefined
  dnis: Map<string, string> | undefined
  isLoading: boolean
  hasError: boolean
  onClose: () => void
}) {
  useEffect(() => {
    if (hasError) {
      toast.error(
        'No pudimos preparar la hoja con las inasistencias y los DNI. Probá de nuevo.',
      )
      onClose()
    }
  }, [hasError, onClose])

  if (isLoading || hasError) {
    return null
  }
  return <ClientSummarySheet {...sheetProps} onClose={onClose} />
}

/** Hoja membretada «Resumen de servicios» (AJ-09). */
function ClientSummarySheet({
  clientName,
  cuit,
  summary,
  absences,
  dnis,
  onClose,
  issuedAt,
}: {
  clientName: string
  cuit: string | null
  summary: ClientServiceSummary
  absences?: AttendanceBoardRow[]
  dnis?: Map<string, string>
  onClose: () => void
  issuedAt?: Date
}) {
  const sheet = useMemo(
    () =>
      buildClientSummarySheet({ clientName, cuit, summary, absences, dnis }),
    [clientName, cuit, summary, absences, dnis],
  )
  const emittedAt = useMemo(() => issuedAt ?? new Date(), [issuedAt])

  return (
    <PrintSheet documentTitle={sheet.documentTitle} onClose={onClose}>
      <PrintableLetterhead title={sheet.title} issuedAt={emittedAt} />
      <PrintFacts facts={sheet.facts} />
      <PrintTable
        columns={sheet.columns}
        rows={sheet.rows}
        footer={sheet.footer}
        emptyText="No hubo turnos realizados ni inasistencias en este período."
      />
      <PrintSignatures signers={sheet.signers} />
    </PrintSheet>
  )
}

export { ClientServiceSummaryTab, ClientSummarySheet }
