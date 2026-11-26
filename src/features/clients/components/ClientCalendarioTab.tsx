import { useMemo, useState } from 'react'
import { useLocation, useNavigate } from 'react-router'
import { useQueryClient } from '@tanstack/react-query'
import { Plus, Printer } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { MonthPicker } from '@/components/MonthPicker'
import { Skeleton } from '@/components/ui/skeleton'
import { isApiError } from '@/api/errors'
import { useAuth } from '@/features/auth/AuthProvider'
import { useSearchParamsPatch } from '@/hooks/useSearchParamsPatch'
import {
  planningKeys,
  useAssignmentsBoardRangeQuery,
  useShiftsBoardRangeQuery,
} from '@/features/planning/queries'
import { shiftsKeys } from '@/features/shifts/queries'
import { canManageShiftTime } from '@/features/shifts/permissions'
import { newShiftFromClientPath } from '@/features/shifts/returnPath'
import { conflictToastOptions } from '@/features/shifts/conflictLink'
import { AssignEmployeeSheet } from '@/features/planning/components/AssignEmployeeSheet'
import { RemoveAssignmentDialog } from '@/features/planning/components/RemoveAssignmentDialog'
import {
  ClientColorConfirmDialog,
  type ClientColorRequest,
} from '@/features/planning/components/ClientColorChange'
import { OwnerDeleteDialog } from '@/features/ownerDelete/components/OwnerDeleteDialog'
import { canOwnerDelete } from '@/features/ownerDelete/matching'
import { useClientSitesQuery } from '@/features/clients/queries'
import { useHolidaysQuery } from '@/features/settings/queries'
import { formatDateOnly } from '@/features/settings/dateOnly'
import { PrintSheet } from '@/features/print/PrintSheet'
import {
  formatMonthParam,
  monthDates,
  resolveMonth,
} from '@/features/employees/calendarioMonth'
import { monthRange } from '@/features/employees/cronograma'
import {
  runCronogramaCommand,
  type CronogramaCommand,
} from '@/features/employees/cronogramaCommands'
import type { UndoAction } from '@/features/employees/cronogramaWeek'
import { MoveDialog } from '@/features/employees/components/CalendarioDialogs'
import {
  UNDO_TOAST_DURATION_MS,
  describeWarnings,
} from '@/features/employees/components/CalendarioMonthEditor'
import {
  buildClientCalendarMonth,
  describeFilters,
  employeeOptions,
  uncoveredLabel,
  type ClientCalendarBlock,
  type ClientCalendarDay,
} from '@/features/clients/clientCalendar'
import {
  planMoveToDate,
  planTimeEdit,
  planWholeShiftChange,
  toWeekBlock,
  validFilter,
  type ClientChangePlan,
} from '@/features/clients/clientCalendarEdit'
import { ClientCalendarMonth } from '@/features/clients/components/ClientCalendarMonth'
import { ClientShiftMenu } from '@/features/clients/components/ClientShiftMenu'

const SELECT_CLASS =
  'h-9 min-w-0 rounded-md border border-border bg-surface px-2 text-[13px] text-text focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none'

/**
 * Pestaña «Calendario» de la ficha del cliente (ADM-21, P34.1, OL-01): todos
 * los turnos del cliente en todas sus sedes, mes por mes, con la misma hoja del
 * calendario del empleado pero con un bloque por turno. El mes y los filtros
 * de sede y empleado viven en la dirección (`mes=`, `sede=`, `empleado=`).
 *
 * Con `canEdit` (D-02) las horas se editan en el lugar, los turnos se arrastran
 * a otro día y tienen menú ⋮, siempre sobre el turno entero (P34.2, D-08 a
 * D-10); el «+» de cada día crea un turno nuevo (D-11).
 */
function ClientCalendarioTab({
  clientId,
  clientName,
  canEdit = false,
}: {
  clientId: string
  clientName: string
  /** Dueño o administrador con permiso sobre turnos y horarios (D-02). */
  canEdit?: boolean
}) {
  const [params, updateParams] = useSearchParamsPatch({
    mes: '',
    sede: '',
    empleado: '',
  })
  const { year, month: monthNumber } = resolveMonth(
    params.mes || null,
    new Date(),
  )
  const monthDate = useMemo(
    () => new Date(year, monthNumber - 1, 1),
    [year, monthNumber],
  )
  const { from, to } = monthRange(year, monthNumber)

  const navigate = useNavigate()
  const location = useLocation()
  const queryClient = useQueryClient()
  const auth = useAuth()
  const canAddShift = canManageShiftTime({
    roles: auth.roles,
    capabilities: auth.capabilities,
  })
  const canDeleteShifts = canOwnerDelete(auth)

  const [printing, setPrinting] = useState(false)
  const [highlightUncovered, setHighlightUncovered] = useState(false)
  const [busy, setBusy] = useState(false)
  const [moveDialog, setMoveDialog] = useState<ClientCalendarBlock | null>(null)
  const [assigning, setAssigning] = useState<ClientCalendarBlock | null>(null)
  const [removing, setRemoving] = useState<{
    assignmentId: string
    employeeName: string
  } | null>(null)
  const [colorRequest, setColorRequest] = useState<ClientColorRequest | null>(
    null,
  )
  const [deleteShiftId, setDeleteShiftId] = useState<string | null>(null)

  const sitesQuery = useClientSitesQuery(clientId)
  // Un `sede=` o `empleado=` que no está en las listas cargadas se ignora.
  const siteId = validFilter(
    params.sede,
    sitesQuery.data?.map((site) => site.id),
  )
  const assignmentsQuery = useAssignmentsBoardRangeQuery(from, to, {
    clientId,
    siteId,
    onlyActive: true,
  })
  const assignments = useMemo(
    () => assignmentsQuery.data ?? [],
    [assignmentsQuery.data],
  )
  const employees = useMemo(() => employeeOptions(assignments), [assignments])
  const employeeId = validFilter(
    params.empleado,
    assignmentsQuery.data
      ? employees.map((employee) => employee.employeeId)
      : undefined,
  )
  const shiftsQuery = useShiftsBoardRangeQuery(from, to, {
    clientId,
    siteId,
    employeeId,
  })
  const holidaysQuery = useHolidaysQuery(year)

  const month = useMemo(
    () =>
      buildClientCalendarMonth({
        year,
        month: monthNumber,
        shifts: shiftsQuery.data ?? [],
        assignments,
        holidays: holidaysQuery.data ?? [],
      }),
    [year, monthNumber, shiftsQuery.data, assignments, holidaysQuery.data],
  )

  const isLoading =
    shiftsQuery.isLoading ||
    assignmentsQuery.isLoading ||
    holidaysQuery.isLoading
  const hasError =
    shiftsQuery.isError || assignmentsQuery.isError || holidaysQuery.isError

  const sites = sitesQuery.data ?? []
  const filtersText = describeFilters({
    siteName: sites.find((site) => site.id === siteId)?.name ?? null,
    employeeName:
      employees.find((employee) => employee.employeeId === employeeId)?.name ??
      null,
  })

  const client = { id: clientId, name: clientName }
  const openPath = (path: string) => void navigate(path)

  function refresh() {
    void queryClient.invalidateQueries({ queryKey: planningKeys.all })
    void queryClient.invalidateQueries({ queryKey: shiftsKeys.all })
    // Cambiar el horario de un turno finalizado recalcula horas y asistencia.
    void queryClient.invalidateQueries({ queryKey: ['attendance'] })
    void queryClient.invalidateQueries({ queryKey: ['dashboard'] })
  }

  async function execute(
    command: CronogramaCommand,
    block: ClientCalendarBlock,
  ) {
    setBusy(true)
    try {
      const result = await runCronogramaCommand(
        command,
        toWeekBlock(block, client),
      )
      refresh()
      const warning = describeWarnings([
        ...result.warnings,
        ...(result.shiftWarnings ?? []),
      ])
      const options = result.undo
        ? {
            duration: UNDO_TOAST_DURATION_MS,
            action: {
              label: 'Deshacer',
              onClick: () => void undo(result.undo as UndoAction),
            },
          }
        : undefined
      const message = 'Cambiamos el horario del turno.'
      if (warning) {
        toast.warning(`${message} Con advertencias: ${warning}`, options)
      } else {
        toast.success(message, options)
      }
    } catch (error) {
      toast.error(
        isApiError(error) ? error.message : 'No pudimos hacer el cambio.',
        conflictToastOptions(error, openPath),
      )
    } finally {
      setBusy(false)
    }
  }

  async function undo(action: UndoAction) {
    try {
      await runCronogramaCommand(action)
      toast.success('Deshicimos el cambio.')
    } catch (error) {
      toast.error(
        isApiError(error) ? error.message : 'No pudimos deshacer el cambio.',
        conflictToastOptions(error, openPath),
      )
    } finally {
      refresh()
    }
  }

  function runPlan(plan: ClientChangePlan, block: ClientCalendarBlock) {
    if (plan.kind === 'blocked') {
      toast.error(plan.message)
    } else if (plan.kind === 'apply') {
      void execute(plan.command, block)
    }
  }

  function commitTime(
    block: ClientCalendarBlock,
    edge: 'start' | 'end',
    value: string,
  ) {
    runPlan(planTimeEdit(block, client, edge, value), block)
  }

  function moveBlock(block: ClientCalendarBlock, date: string) {
    runPlan(planMoveToDate(block, client, date), block)
  }

  function renderActions(block: ClientCalendarBlock) {
    if (!canEdit) {
      return null
    }
    return (
      <ClientShiftMenu
        block={block}
        clientId={clientId}
        clientName={clientName}
        canDelete={canDeleteShifts}
        disabled={busy}
        onOpen={(target) => openPath(`/admin/turnos/${target.shiftId}`)}
        onMove={setMoveDialog}
        onAssign={setAssigning}
        onRemove={(_target, person) =>
          setRemoving({
            assignmentId: person.assignmentId,
            employeeName: person.shortName,
          })
        }
        onColorRequest={setColorRequest}
        onDelete={(target) => setDeleteShiftId(target.shiftId)}
      />
    )
  }

  function renderDayAction(day: ClientCalendarDay) {
    if (!canAddShift) {
      return null
    }
    return (
      <button
        type="button"
        aria-label={`Agregar un turno el ${formatDateOnly(day.date)}`}
        className="flex items-center justify-center rounded-sm border border-dashed border-neutral-400 px-1 text-neutral-500 hover:bg-neutral-100 max-md:min-h-6 print:hidden"
        onClick={() =>
          openPath(
            newShiftFromClientPath({
              date: day.date,
              clientId,
              siteId,
              employeeId,
              pathname: location.pathname,
              search: location.search,
              monthKey: formatMonthParam(year, monthNumber),
            }),
          )
        }
      >
        <Plus className="size-3" />
      </button>
    )
  }

  function changeMonth(date: Date) {
    updateParams({
      mes: formatMonthParam(date.getFullYear(), date.getMonth() + 1),
    })
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <MonthPicker
          value={monthDate}
          onValueChange={changeMonth}
          aria-label="Mes del calendario"
        />
        <select
          aria-label="Sede"
          className={SELECT_CLASS}
          value={siteId ?? ''}
          onChange={(event) => updateParams({ sede: event.target.value })}
        >
          <option value="">Todas las sedes</option>
          {sites.map((site) => (
            <option key={site.id} value={site.id}>
              {site.name}
            </option>
          ))}
        </select>
        <select
          aria-label="Empleado"
          className={SELECT_CLASS}
          value={employeeId ?? ''}
          onChange={(event) => updateParams({ empleado: event.target.value })}
        >
          <option value="">Todos los empleados</option>
          {employees.map((employee) => (
            <option key={employee.employeeId} value={employee.employeeId}>
              {employee.name}
            </option>
          ))}
        </select>
        <Button
          icon={Printer}
          variant="dark"
          disabled={isLoading || hasError}
          onClick={() => setPrinting(true)}
        >
          Imprimir
        </Button>
      </div>

      {canEdit && (
        <p className="text-[12px] text-text-2">
          Tocá una hora para editarla (Enter confirma, Esc cancela) o arrastrá
          un turno a otro día: el cambio es del turno entero. En el celular usá
          el menú del turno.
        </p>
      )}

      {hasError ? (
        <p role="alert" className="text-[13px] text-danger">
          No pudimos cargar el calendario. Probá de nuevo en un momento.
        </p>
      ) : isLoading ? (
        <Skeleton className="h-64 w-full" />
      ) : (
        <>
          {month.uncoveredCount > 0 && (
            <button
              type="button"
              aria-pressed={highlightUncovered}
              className="self-start text-[13px] font-semibold text-danger hover:underline"
              onClick={() => setHighlightUncovered((current) => !current)}
            >
              {uncoveredLabel(month.uncoveredCount)}
            </button>
          )}
          <div className="min-w-0 overflow-x-auto rounded-md border border-border bg-white p-3">
            <ClientCalendarMonth
              month={month}
              canEdit={canEdit && !busy}
              highlightUncovered={highlightUncovered}
              onTimeCommit={commitTime}
              onMoveBlock={moveBlock}
              renderActions={renderActions}
              renderDayAction={renderDayAction}
            />
          </div>
        </>
      )}

      {canEdit && moveDialog && (
        <MoveDialog
          block={toWeekBlock(moveDialog, client)}
          days={monthDates(year, monthNumber)}
          onClose={() => setMoveDialog(null)}
          onConfirm={(next) => {
            const block = moveDialog
            setMoveDialog(null)
            runPlan(
              planWholeShiftChange(toWeekBlock(block, client), next),
              block,
            )
          }}
        />
      )}

      {canEdit && assigning && (
        <AssignEmployeeSheet
          shiftId={assigning.shiftId}
          clientId={clientId}
          shiftDate={assigning.date}
          shiftStartTime={assigning.start}
          shiftEndTime={assigning.endTime}
          shiftOpenEnded={assigning.openEnded}
          excludeEmployeeIds={assigning.people.map(
            (person) => person.employeeId,
          )}
          open
          onOpenChange={(open) => {
            if (!open) {
              setAssigning(null)
            }
          }}
          onAssigned={refresh}
        />
      )}

      {canEdit && removing && (
        <RemoveAssignmentDialog
          assignmentId={removing.assignmentId}
          employeeName={removing.employeeName}
          open
          onOpenChange={(open) => {
            if (!open) {
              setRemoving(null)
            }
          }}
          onRemoved={refresh}
        />
      )}

      {canEdit && (
        <ClientColorConfirmDialog
          request={colorRequest}
          onClose={() => setColorRequest(null)}
        />
      )}

      {canEdit && deleteShiftId && (
        <OwnerDeleteDialog
          kind="shift"
          id={deleteShiftId}
          open
          onOpenChange={(open) => {
            if (!open) {
              setDeleteShiftId(null)
            }
          }}
          onDeleted={() => {
            setDeleteShiftId(null)
            refresh()
          }}
        />
      )}

      {printing && (
        <PrintSheet
          documentTitle={`Calendario - ${clientName} - ${month.title}`}
          onClose={() => setPrinting(false)}
          orientation="landscape"
        >
          <p className="mb-1 text-[12px] font-bold text-black">
            {clientName} · {filtersText}
          </p>
          <ClientCalendarMonth month={month} printing />
        </PrintSheet>
      )}
    </div>
  )
}

export { ClientCalendarioTab }
