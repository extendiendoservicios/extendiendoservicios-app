import { useState } from 'react'
import { useNavigate } from 'react-router'
import { toast } from 'sonner'
import { TriangleAlert, UserPlus } from 'lucide-react'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Field, FieldError, FieldLabel } from '@/components/ui/field'
import { Skeleton } from '@/components/ui/skeleton'
import { DatePicker } from '@/components/DatePicker'
import { EmptyState } from '@/components/EmptyState'
import { isApiError } from '@/api/errors'
import type { SupervisionWarning } from '@/api/supervisions'
import { localDateToIsoDate } from '@/features/settings/dateOnly'
import { todayInBuenosAires } from '@/features/employees/employeeLeaveStatus'
import { formatShiftRange } from '@/features/shifts/openEnded'
import { useShiftsByDateQuery } from '@/features/shifts/queries'
import {
  useAssignSupervisionMutation,
  useSupervisorCandidatesQuery,
} from '@/features/supervisions/queries'

/** Mensaje de la única advertencia de `assign_supervision` (ratificada 27 sep 2026, P15.0): no bloquea. */
const WARNING_MESSAGES: Record<SupervisionWarning, string> = {
  SUPERVISES_OWN_SHIFT:
    'Este supervisor también está asignado como empleado en este turno.',
}

/** Estados de turno que `assign_supervision` acepta (`0029`: "scheduled, assigned o in_progress"). */
const SUPERVISABLE_SHIFT_STATUSES = new Set([
  'scheduled',
  'assigned',
  'in_progress',
])

/**
 * ADM-14 "Asignar supervisión" (SUP-009, `05` línea 58): fecha, turno (no
 * cancelado ni completado de esa fecha) y supervisor (rol vigente y
 * activo), con la advertencia de `assign_supervision` antes de confirmar
 * (no bloquea, P15.0). Mismo patrón que `AssignEmployeeSheet` (ADM-08) para
 * las advertencias, pero como página/drawer propio con ruta
 * (`/admin/supervisiones/nueva`, `05` sección 7: drawer de 452 px en
 * escritorio) en vez de un `Sheet` embebido en otra pantalla.
 */
interface AssignSupervisionFormProps {
  /** Cierra el panel (vuelve a ADM-13) cuando termina bien o se cancela. */
  onDone: () => void
  /** Precarga fecha y turno cuando se abre desde ADM-06 (`ShiftDetail`, SUP-012). */
  initialDate?: string
  initialShiftId?: string
}

function AssignSupervisionForm({
  onDone,
  initialDate,
  initialShiftId,
}: AssignSupervisionFormProps) {
  const navigate = useNavigate()
  const [date, setDate] = useState(initialDate ?? todayInBuenosAires())
  const [shiftId, setShiftId] = useState(initialShiftId ?? '')
  const [supervisorId, setSupervisorId] = useState('')
  // Id de la supervisión ya creada cuando volvió con advertencias: el panel
  // queda abierto para leerlas, pero no se puede volver a asignar.
  const [assignedId, setAssignedId] = useState<string | null>(null)
  const [lastWarnings, setLastWarnings] = useState<SupervisionWarning[] | null>(
    null,
  )

  const shiftsQuery = useShiftsByDateQuery(date, false)
  const supervisableShifts = (shiftsQuery.data ?? []).filter((shift) =>
    SUPERVISABLE_SHIFT_STATUSES.has(shift.status),
  )
  const candidatesQuery = useSupervisorCandidatesQuery()
  const assignSupervision = useAssignSupervisionMutation()

  function handleDateChange(next: Date | undefined) {
    if (!next) return
    setDate(localDateToIsoDate(next))
    setShiftId('')
  }

  async function handleSubmit() {
    if (!shiftId || !supervisorId) {
      return
    }
    try {
      const result = await assignSupervision.mutateAsync({
        shiftId,
        supervisorId,
      })
      if (result.warnings.length > 0) {
        // No bloquea (P15.0): la supervisión ya se creó, se deja el panel
        // abierto para que la advertencia se vea antes de cerrar (misma
        // regla que `AssignEmployeeSheet`).
        setLastWarnings(result.warnings)
        setAssignedId(result.supervision.id)
        toast.warning('Asignamos igual, con una advertencia: revisá el aviso.')
      } else {
        toast.success('Asignamos al supervisor.')
        // Sin `onDone()`: su `navigate(-1)` pisaría este `replace`.
        void navigate(`/admin/supervisiones/${result.supervision.id}`, {
          replace: true,
        })
      }
    } catch (error) {
      toast.error(
        isApiError(error) ? error.message : 'No pudimos asignar al supervisor.',
      )
    }
  }

  return (
    <div className="flex flex-col gap-4">
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

      <Field>
        <FieldLabel htmlFor="assign-supervision-date">Fecha</FieldLabel>
        <DatePicker
          aria-label="Fecha del turno"
          value={new Date(`${date}T00:00:00`)}
          onValueChange={handleDateChange}
        />
      </Field>

      <Field>
        <FieldLabel htmlFor="assign-supervision-shift">Turno</FieldLabel>
        {shiftsQuery.isLoading ? (
          <Skeleton className="h-9" />
        ) : supervisableShifts.length === 0 ? (
          <EmptyState
            icon={UserPlus}
            title="No hay turnos para supervisar en esta fecha"
            description="Elegí otro día, o revisá que el turno no esté cancelado ni completado."
          />
        ) : (
          <Select value={shiftId} onValueChange={setShiftId}>
            <SelectTrigger id="assign-supervision-shift">
              <SelectValue placeholder="Elegí un turno" />
            </SelectTrigger>
            <SelectContent>
              {supervisableShifts.map((shift) => (
                <SelectItem key={shift.id} value={shift.id}>
                  {shift.clientName} · {shift.siteName} ·{' '}
                  {formatShiftRange(
                    shift.startTime,
                    shift.endTime,
                    shift.openEnded,
                  )}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </Field>

      <Field>
        <FieldLabel htmlFor="assign-supervision-supervisor">
          Supervisor
        </FieldLabel>
        {candidatesQuery.isLoading ? (
          <Skeleton className="h-9" />
        ) : (candidatesQuery.data ?? []).length === 0 ? (
          <FieldError>
            No hay personas con el rol de supervisor activas. Cargalas desde
            «Empleados».
          </FieldError>
        ) : (
          <Select value={supervisorId} onValueChange={setSupervisorId}>
            <SelectTrigger id="assign-supervision-supervisor">
              <SelectValue placeholder="Elegí un supervisor" />
            </SelectTrigger>
            <SelectContent>
              {(candidatesQuery.data ?? []).map((candidate) => (
                <SelectItem
                  key={candidate.profileId}
                  value={candidate.profileId}
                >
                  {candidate.firstName} {candidate.lastName}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </Field>

      <div className="flex justify-end gap-2 border-t border-border pt-4">
        {assignedId ? (
          <Button
            onClick={() => {
              void navigate(`/admin/supervisiones/${assignedId}`, {
                replace: true,
              })
            }}
          >
            Ver supervisión
          </Button>
        ) : (
          <>
            <Button variant="ghost" onClick={onDone}>
              Cancelar
            </Button>
            <Button
              disabled={!shiftId || !supervisorId}
              loading={assignSupervision.isPending}
              onClick={() => void handleSubmit()}
            >
              Asignar supervisión
            </Button>
          </>
        )}
      </div>
    </div>
  )
}

export { AssignSupervisionForm }
