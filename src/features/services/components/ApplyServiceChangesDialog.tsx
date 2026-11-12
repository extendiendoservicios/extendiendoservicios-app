import { useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Field, FieldLabel } from '@/components/ui/field'
import { DatePicker } from '@/components/DatePicker'
import { isApiError } from '@/api/errors'
import type {
  FixedApplyResult,
  ServiceChangesResult,
  ServicePrevious,
} from '@/api/services'
import { todayInBuenosAires } from '@/features/employees/employeeLeaveStatus'
import {
  useApplyServiceChangesMutation,
  useApplyServiceFixedEmployeesMutation,
  useServiceChangesPreviewQuery,
} from '@/features/services/queries'
import {
  describeUpdatedShift,
  isServiceChangesEmpty,
  shiftDateText,
  summarizeServiceChanges,
} from '@/features/services/serviceChanges'
import {
  describeSkipped,
  summarizeFixedApply,
} from '@/features/services/fixedApply'
import { localDateToIsoDate } from '@/features/settings/dateOnly'

/** Cuántas líneas se muestran por sección del detalle. */
const MAX_LINES = 30

function Section({
  title,
  count,
  children,
}: {
  title: string
  count: number
  children: React.ReactNode
}) {
  if (count === 0) {
    return null
  }
  return (
    <details className="rounded-md border border-border px-3 py-2">
      <summary className="cursor-pointer text-[12.5px] font-semibold text-text">
        {title} ({count})
      </summary>
      <div className="mt-2 flex flex-col gap-1 text-[12.5px] text-text-2">
        {children}
      </div>
    </details>
  )
}

function MoreLine({ total }: { total: number }) {
  return total > MAX_LINES ? <p>{`y ${total - MAX_LINES} más.`}</p> : null
}

/** Detalle desplegable de la vista previa o del resultado, con los motivos en lenguaje claro. */
function ChangesDetail({ result }: { result: ServiceChangesResult }) {
  const hasUnassigned = result.unassigned.length > 0
  return (
    <div className="flex max-h-64 flex-col gap-2 overflow-y-auto">
      <Section title="Se borran" count={result.deleted.length}>
        <ul className="list-disc pl-4">
          {result.deleted.slice(0, MAX_LINES).map((item) => (
            <li key={item.shiftId}>
              {`${shiftDateText(item.shiftDate)}: ${item.message}`}
              {item.assignments > 0 &&
                ` (se quita ${item.assignments === 1 ? 'una asignación' : `${item.assignments} asignaciones`})`}
            </li>
          ))}
        </ul>
        <MoreLine total={result.deleted.length} />
      </Section>
      <Section title="Se actualizan" count={result.updated.length}>
        <ul className="list-disc pl-4">
          {result.updated.slice(0, MAX_LINES).map((item) => (
            <li key={item.shiftId}>
              <span className="font-medium text-text">
                {shiftDateText(item.shiftDate)}
              </span>
              {describeUpdatedShift(item).map((line) => (
                <span key={line} className="block">
                  {line}
                </span>
              ))}
            </li>
          ))}
        </ul>
        <MoreLine total={result.updated.length} />
      </Section>
      <Section title="Se crean" count={result.created.length}>
        <p>
          {result.created
            .slice(0, MAX_LINES)
            .map((item) => shiftDateText(item.shiftDate))
            .join(' · ')}
        </p>
        <MoreLine total={result.created.length} />
      </Section>
      <Section title="No se tocan" count={result.skipped.length}>
        <ul className="list-disc pl-4">
          {result.skipped.slice(0, MAX_LINES).map((item) => (
            <li key={`${item.shiftId}-${item.code}-${item.scope}`}>
              {`${shiftDateText(item.shiftDate)}: ${item.message}`}
            </li>
          ))}
        </ul>
        <MoreLine total={result.skipped.length} />
      </Section>
      {hasUnassigned && (
        <Section
          title="Empleados fijos que no se pudieron asignar"
          count={result.unassigned.length}
        >
          <ul className="list-disc pl-4">
            {result.unassigned.slice(0, MAX_LINES).map((item) => (
              <li key={`${item.shiftId}-${item.employeeId ?? ''}`}>
                {`${shiftDateText(item.shiftDate)}${item.employeeName ? ` · ${item.employeeName}` : ''}: ${item.message}`}
              </li>
            ))}
          </ul>
          <MoreLine total={result.unassigned.length} />
        </Section>
      )}
    </div>
  )
}

/**
 * OF-05: al guardar un servicio con cambios que llegan a los turnos (días,
 * semanas del mes, horario, «A terminar», dotación, feriados, vigencia o
 * fotos) pregunta «¿Aplicar los cambios a los turnos desde el [fecha]?» (fecha
 * elegible, por defecto hoy) y muestra la vista previa de
 * `preview_service_changes`: cuántos turnos se borran, actualizan, crean y
 * saltean, con el detalle desplegable.
 *
 * Es el único diálogo posterior al guardado: si además cambiaron los
 * empleados fijos (`includeFixed`, OD-11), con el mismo «Aplicar» se corre
 * primero `apply_service_changes` y después `apply_service_fixed_employees`
 * con la misma fecha, y el resumen final junta las dos cosas.
 *
 * `previous` = valores del servicio antes de guardar. Con `previous = null`
 * (acción «Actualizar turnos desde…») el servidor fuerza los valores del
 * servicio en todos los turnos que siguen.
 */
function ApplyServiceChangesDialog({
  serviceId,
  previous,
  includeFixed = false,
  onFinish,
}: {
  serviceId: string
  previous: ServicePrevious | null
  includeFixed?: boolean
  onFinish: () => void
}) {
  const [date, setDate] = useState<Date>(
    () => new Date(`${todayInBuenosAires()}T00:00:00`),
  )
  const fromDate = localDateToIsoDate(date)
  const preview = useServiceChangesPreviewQuery(serviceId, fromDate, previous)
  const applyChanges = useApplyServiceChangesMutation()
  const applyFixed = useApplyServiceFixedEmployeesMutation()
  const [result, setResult] = useState<ServiceChangesResult | null>(null)
  const [fixedResult, setFixedResult] = useState<FixedApplyResult | null>(null)
  const [fixedError, setFixedError] = useState<string | null>(null)
  const [applying, setApplying] = useState(false)

  const previewData = preview.data
  const empty = previewData ? isServiceChangesEmpty(previewData) : false

  // Guardó un cambio que no toca ningún turno: no se interrumpe con un diálogo vacío.
  const autoClosed = useRef(false)
  useEffect(() => {
    if (!autoClosed.current && previewData && empty && !includeFixed) {
      autoClosed.current = true
      if (previous !== null) {
        toast.info('Los turnos ya estaban al día: no hubo nada para cambiar.')
        onFinish()
      }
    }
  }, [previewData, empty, includeFixed, previous, onFinish])

  async function handleApply() {
    setApplying(true)
    try {
      const changes = await applyChanges.mutateAsync({
        serviceId,
        fromDate,
        previous,
      })
      setResult(changes)
    } catch {
      // El mensaje del servidor se muestra debajo.
      setApplying(false)
      return
    }
    if (includeFixed) {
      try {
        setFixedResult(await applyFixed.mutateAsync({ serviceId, fromDate }))
      } catch (error) {
        setFixedError(
          isApiError(error)
            ? error.message
            : 'No pudimos aplicar los empleados fijos a los turnos.',
        )
      }
    }
    setApplying(false)
  }

  const errorMessage = (error: unknown, fallback: string) =>
    isApiError(error) ? error.message : fallback

  const fixedSkipped = fixedResult?.skipped.slice(0, MAX_LINES) ?? []

  return (
    <Dialog open onOpenChange={(open) => !open && !applying && onFinish()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {result
              ? 'Resultado'
              : `¿Aplicar los cambios a los turnos desde el ${shiftDateText(fromDate)}?`}
          </DialogTitle>
          <DialogDescription>
            {result
              ? summarizeServiceChanges(result, true)
              : 'Se borran los turnos que ya no corresponden, se actualizan los que siguen (horario, dotación y fotos) y se crean los que faltan en los meses que ya tenían turnos. No se tocan los turnos cancelados, los cambiados a mano, los que ya empezaron ni los que tienen historia.'}
          </DialogDescription>
        </DialogHeader>

        {!result && (
          <>
            <Field>
              <FieldLabel>Aplicar a los turnos desde el</FieldLabel>
              <DatePicker
                aria-label="Aplicar a los turnos desde el"
                value={date}
                onValueChange={(next) => next && setDate(next)}
                disabled={applying}
              />
            </Field>

            {preview.isLoading && (
              <p className="text-[12.5px] text-text-3">
                Calculando qué turnos cambian…
              </p>
            )}
            {preview.isError && (
              <p role="alert" className="text-[12.5px] text-danger">
                {errorMessage(
                  preview.error,
                  'No pudimos calcular la vista previa.',
                )}
              </p>
            )}
            {previewData && (
              <div className="flex flex-col gap-2">
                <p className="text-[13px] font-medium text-text">
                  {summarizeServiceChanges(previewData, false)}
                </p>
                {includeFixed && (
                  <p className="text-[12.5px] text-text-2">
                    Después se aplican los cambios de los empleados fijos a los
                    mismos turnos (se quitan los fijos anteriores y se asignan
                    los nuevos).
                  </p>
                )}
                <ChangesDetail result={previewData} />
              </div>
            )}
            {applyChanges.error && (
              <p role="alert" className="text-[12.5px] text-danger">
                {errorMessage(
                  applyChanges.error,
                  'No pudimos aplicar los cambios a los turnos.',
                )}
              </p>
            )}
          </>
        )}

        {result && (
          <div className="flex flex-col gap-2 text-[12.5px] text-text-2">
            <p>
              {`Asignaciones quitadas: ${result.assignmentsRemoved}. Asignaciones de fijos en los turnos nuevos: ${result.assignmentsAdded}.`}
            </p>
            <ChangesDetail result={result} />
            {includeFixed && fixedResult && (
              <>
                <p className="font-semibold text-text">Empleados fijos</p>
                <p>{summarizeFixedApply(fixedResult)}</p>
                <p>
                  {`Asignaciones quitadas: ${fixedResult.assignmentsRemoved}. Asignaciones nuevas: ${fixedResult.assignmentsAdded}.`}
                </p>
                {fixedSkipped.length > 0 && (
                  <ul className="list-disc pl-4">
                    {fixedSkipped.map((item) => (
                      <li key={`${item.shiftId}-${item.employeeId ?? 'turno'}`}>
                        {describeSkipped(item)}
                      </li>
                    ))}
                  </ul>
                )}
              </>
            )}
            {fixedError && (
              <p role="alert" className="text-danger">
                {`Se aplicaron los cambios del servicio, pero no los empleados fijos: ${fixedError}`}
              </p>
            )}
          </div>
        )}

        <DialogFooter>
          {result ? (
            <Button type="button" onClick={onFinish} disabled={applying}>
              Listo
            </Button>
          ) : (
            <>
              <Button
                type="button"
                variant="ghost"
                onClick={onFinish}
                disabled={applying}
              >
                No aplicar
              </Button>
              <Button
                type="button"
                loading={applying}
                disabled={!previewData || (empty && !includeFixed)}
                onClick={() => void handleApply()}
              >
                Aplicar
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export { ApplyServiceChangesDialog }
