import { useMemo, useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { toast } from 'sonner'
import { Search, TriangleAlert, UserPlus } from 'lucide-react'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Field, FieldError, FieldLabel } from '@/components/ui/field'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Sheet,
  SheetContent,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { EmptyState } from '@/components/EmptyState'
import { PersonCell } from '@/components/PersonCell'
import { isApiError } from '@/api/errors'
import type { AssignEmployeeWarning } from '@/api/assignments'
import {
  useAssignCandidatesQuery,
  useAssignEmployeeMutation,
} from '@/features/planning/queries'
import {
  assignmentTimeSchema,
  type AssignmentTimeFormValues,
} from '@/features/planning/schemas'

/** Mensajes de las tres advertencias de `assign_employee` (P-033, P-034, P-035): no bloquean, se muestran tal cual las devuelve la RPC. */
const WARNING_MESSAGES: Record<AssignEmployeeWarning, string> = {
  NOT_ENABLED_FOR_CLIENT:
    'Este empleado no figura habilitado para este cliente.',
  OUTSIDE_AVAILABILITY:
    'La franja no coincide con la disponibilidad que declaró.',
  ON_LEAVE: 'Este empleado tiene una licencia cargada para la fecha del turno.',
}

/**
 * ADM-08 "Asignar empleado" (ASSIGN-012, `05` línea 42): sin ruta propia
 * (drawer de ADM-06, ver el comentario de `adminRoutes.tsx`) -- se abre
 * desde `ShiftDetail` con el turno ya cargado. El `Sheet` se autoajusta a
 * pantalla completa por debajo de 768 px (`components/ui/sheet.tsx`), que es
 * el comportamiento de P-094 para esta pantalla sin ruta propia.
 */
interface AssignEmployeeSheetProps {
  shiftId: string
  clientId: string
  shiftDate: string
  shiftStartTime: string
  shiftEndTime: string
  /** Empleados con una asignación vigente en este turno: no se ofrecen de nuevo. */
  excludeEmployeeIds: string[]
  open: boolean
  onOpenChange: (open: boolean) => void
}

function AssignEmployeeSheet({
  shiftId,
  clientId,
  shiftDate,
  shiftStartTime,
  shiftEndTime,
  excludeEmployeeIds,
  open,
  onOpenChange,
}: AssignEmployeeSheetProps) {
  const [search, setSearch] = useState('')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [lastWarnings, setLastWarnings] = useState<
    AssignEmployeeWarning[] | null
  >(null)

  const candidatesQuery = useAssignCandidatesQuery(
    open
      ? {
          shiftId,
          clientId,
          shiftDate,
          startTime: shiftStartTime,
          endTime: shiftEndTime,
          excludeEmployeeIds,
        }
      : undefined,
  )
  const assignEmployee = useAssignEmployeeMutation()

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<AssignmentTimeFormValues>({
    resolver: zodResolver(assignmentTimeSchema),
    defaultValues: { startTime: '', endTime: '' },
  })

  // Reinicia búsqueda, selección, advertencias y franja propia cada vez que
  // se abre (mismo patrón que `ConfirmDialog`/`HolidayFormDialog`: ajuste de
  // estado durante el render, no un `useEffect`).
  const [wasOpen, setWasOpen] = useState(open)
  if (open !== wasOpen) {
    setWasOpen(open)
    if (open) {
      setSearch('')
      setSelectedId(null)
      setLastWarnings(null)
      reset({ startTime: '', endTime: '' })
    }
  }

  const filteredCandidates = useMemo(() => {
    const text = search.trim().toLowerCase()
    const all = candidatesQuery.data ?? []
    if (!text) {
      return all
    }
    return all.filter((candidate) =>
      `${candidate.firstName} ${candidate.lastName}`
        .toLowerCase()
        .includes(text),
    )
  }, [candidatesQuery.data, search])

  async function onSubmit(values: AssignmentTimeFormValues) {
    if (!selectedId) {
      return
    }
    try {
      const result = await assignEmployee.mutateAsync({
        shiftId,
        employeeId: selectedId,
        start: values.startTime || undefined,
        end: values.endTime || undefined,
      })
      if (result.warnings.length > 0) {
        // No bloquean (P-034, P-035, P-033): la asignación ya se creó, se
        // deja el panel abierto para que las advertencias se vean antes de
        // cerrar (regla común de la capa).
        setLastWarnings(result.warnings)
        setSelectedId(null)
        toast.warning('Asignamos igual, con advertencias: revisalas abajo.')
      } else {
        toast.success('Asignamos al empleado.')
        onOpenChange(false)
      }
    } catch (error) {
      toast.error(
        isApiError(error) ? error.message : 'No pudimos asignar al empleado.',
      )
    }
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="gap-0 overflow-y-auto">
        <SheetHeader>
          <SheetTitle>Asignar empleado</SheetTitle>
        </SheetHeader>
        <div className="flex flex-1 flex-col gap-4 overflow-y-auto px-6 pb-6">
          {lastWarnings && lastWarnings.length > 0 && (
            <Alert variant="warn">
              <TriangleAlert />
              <AlertDescription>
                <ul className="list-disc pl-4">
                  {lastWarnings.map((warning) => (
                    <li key={warning}>{WARNING_MESSAGES[warning]}</li>
                  ))}
                </ul>
              </AlertDescription>
            </Alert>
          )}

          <Input
            icon={Search}
            placeholder="Buscar empleado…"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            aria-label="Buscar empleado"
          />

          {candidatesQuery.isLoading ? (
            <div className="flex flex-col gap-2">
              <Skeleton className="h-16" />
              <Skeleton className="h-16" />
              <Skeleton className="h-16" />
            </div>
          ) : filteredCandidates.length === 0 ? (
            <EmptyState
              icon={UserPlus}
              title="No encontramos candidatos"
              description="Probá con otro texto de búsqueda, o revisá la dotación activa."
            />
          ) : (
            <ul
              className="flex flex-col gap-2"
              role="radiogroup"
              aria-label="Candidatos"
            >
              {filteredCandidates.map((candidate) => {
                const isSelected = candidate.employeeId === selectedId
                const isRecommended =
                  candidate.enabledForClient &&
                  candidate.availableThatDay &&
                  !candidate.onLeave
                return (
                  <li key={candidate.employeeId}>
                    <button
                      type="button"
                      role="radio"
                      aria-checked={isSelected}
                      data-testid="assign-candidate"
                      onClick={() => setSelectedId(candidate.employeeId)}
                      className={`w-full rounded-lg border p-3 text-left outline-none focus-visible:ring-3 focus-visible:ring-ring ${
                        isSelected
                          ? 'border-primary bg-primary-100/40'
                          : 'border-border bg-surface hover:bg-bg'
                      }`}
                    >
                      <PersonCell
                        id={candidate.employeeId}
                        name={`${candidate.firstName} ${candidate.lastName}`}
                      />
                      <div className="mt-2 flex flex-wrap gap-1">
                        {isRecommended ? (
                          <Badge variant="success" className="text-[10.5px]">
                            Habilitado y disponible
                          </Badge>
                        ) : (
                          <>
                            {!candidate.enabledForClient && (
                              <Badge
                                variant="warning"
                                className="text-[10.5px]"
                              >
                                No habilitado para el cliente
                              </Badge>
                            )}
                            {!candidate.availableThatDay && (
                              <Badge
                                variant="warning"
                                className="text-[10.5px]"
                              >
                                Fuera de su disponibilidad
                              </Badge>
                            )}
                            {candidate.onLeave && (
                              <Badge variant="danger" className="text-[10.5px]">
                                De licencia
                              </Badge>
                            )}
                          </>
                        )}
                        {candidate.conflicts.map((conflict) => (
                          <Badge
                            key={conflict.shiftId}
                            variant={conflict.overlaps ? 'danger' : 'neutral'}
                            className="text-[10.5px]"
                          >
                            {conflict.overlaps
                              ? 'Se superpone con'
                              : 'También en'}{' '}
                            {conflict.siteName} {conflict.startTime.slice(0, 5)}
                            –{conflict.endTime.slice(0, 5)}
                          </Badge>
                        ))}
                      </div>
                    </button>
                  </li>
                )
              })}
            </ul>
          )}

          <form
            onSubmit={(event) => void handleSubmit(onSubmit)(event)}
            className="flex flex-col gap-4 border-t border-border pt-4"
          >
            <p className="text-[11px] font-semibold text-text-2">
              Franja propia (opcional)
            </p>
            <div className="grid grid-cols-2 gap-4">
              <Field data-invalid={Boolean(errors.startTime) || undefined}>
                <FieldLabel htmlFor="assign-start-time">Desde</FieldLabel>
                <Input
                  id="assign-start-time"
                  type="time"
                  aria-invalid={Boolean(errors.startTime)}
                  {...register('startTime')}
                />
                {errors.startTime && (
                  <FieldError>{errors.startTime.message}</FieldError>
                )}
              </Field>
              <Field data-invalid={Boolean(errors.endTime) || undefined}>
                <FieldLabel htmlFor="assign-end-time">Hasta</FieldLabel>
                <Input
                  id="assign-end-time"
                  type="time"
                  aria-invalid={Boolean(errors.endTime)}
                  {...register('endTime')}
                />
                {errors.endTime && (
                  <FieldError>{errors.endTime.message}</FieldError>
                )}
              </Field>
            </div>
            <SheetFooter className="p-0">
              <Button
                type="submit"
                disabled={!selectedId}
                loading={assignEmployee.isPending}
              >
                Asignar
              </Button>
            </SheetFooter>
          </form>
        </div>
      </SheetContent>
    </Sheet>
  )
}

export { AssignEmployeeSheet, WARNING_MESSAGES }
