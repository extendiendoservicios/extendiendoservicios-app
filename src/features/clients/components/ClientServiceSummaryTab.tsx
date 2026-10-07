import { useMemo, useState } from 'react'
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
import {
  buildClientSummarySheet,
  currentMonthRange,
  shiftEmployeeNames,
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
            className="w-44"
          />
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[11px] font-semibold text-text-2">Hasta</span>
          <DatePicker
            aria-label="Hasta"
            value={isoDateToDate(to)}
            onValueChange={(next) => next && setTo(localDateToIsoDate(next))}
            className="w-44"
          />
        </div>
        <Button
          className="ml-auto"
          variant="ghost"
          icon={FileText}
          disabled={!summary || !isRangeValid}
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
        <ClientSummarySheet
          clientName={clientName}
          cuit={cuit}
          summary={summary}
          onClose={() => setSheetOpen(false)}
        />
      )}
    </div>
  )
}

/** Hoja membretada «Resumen de servicios» (AJ-09). */
function ClientSummarySheet({
  clientName,
  cuit,
  summary,
  onClose,
  issuedAt,
}: {
  clientName: string
  cuit: string | null
  summary: ClientServiceSummary
  onClose: () => void
  issuedAt?: Date
}) {
  const sheet = useMemo(
    () => buildClientSummarySheet({ clientName, cuit, summary }),
    [clientName, cuit, summary],
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
        emptyText="No hubo turnos realizados en este período."
      />
      <PrintSignatures signers={sheet.signers} />
    </PrintSheet>
  )
}

export { ClientServiceSummaryTab, ClientSummarySheet }
