import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { ActionBar } from '@/app/shells/ActionBar'
import { PersonCell } from '@/components/PersonCell'
import { StarRating } from '@/components/StarRating'
import { StatusBadge } from '@/components/status'
import { avatarUrl } from '@/lib/avatarUrl'
import { isApiError } from '@/api/errors'
import { useAuth } from '@/features/auth/AuthProvider'
import { useOnlineStatus } from '@/features/employee/useOnlineStatus'
import { RatingCriteriaGuide } from '@/features/supervisions/components/RatingCriteriaGuide'
import {
  canRateNow,
  isRatingWindowClosed,
  useMySupervisionQuery,
  usePeopleAvatarsQuery,
  useRateEmployeeMutation,
  useSupervisionAssignmentsQuery,
  useSupervisionRatingsQuery,
  useVigentRatingCriteriaQuery,
} from '@/api/mySupervisions'

/**
 * SUP-05 · Calificar empleado (MOB-SUP-006, `05` fila SUP-05, `06` sección
 * 13, P-080, P-081, P-083): nombre y foto, estado de asistencia, estrellas
 * editables (1 a 5, `StarRating`), comentario opcional, criterios de guía
 * desplegables (`RatingCriteriaGuide`, compartido con SUP-03) y "Guardar"
 * (`rate_employee`, upsert -- mismo botón sirve para calificar por primera
 * vez o para editar).
 *
 * Tres guardas antes de mostrar el formulario, en este orden (`06` sección
 * 13, CB-13, MOB-SUP-011):
 * 1. CB-13: el propio supervisor no puede calificarse a sí mismo. Defensiva
 *    -- SUP-03 ya no ofrece este enlace para ese caso, pero un enlace viejo
 *    o escrito a mano tiene que topar con el mismo mensaje que la RPC
 *    (`SELF_RATING_NOT_ALLOWED`).
 * 2. La supervisión tiene que estar `in_progress` o `completed`
 *    (`SUPERVISION_NOT_ACTIVE` en cualquier otro estado).
 * 3. MOB-SUP-011: el plazo de P-083 no puede haber cerrado ya
 *    (`isRatingWindowClosed`, mismo cálculo que la RPC) -- se anticipa en
 *    vez de dejar que el guardado falle con `RATING_WINDOW_CLOSED`.
 */
export default function RateEmployeePage() {
  const { id, assignmentId } = useParams<{
    id: string
    assignmentId: string
  }>()
  const navigate = useNavigate()
  const auth = useAuth()
  const online = useOnlineStatus()
  const {
    data: supervision,
    isLoading: supervisionLoading,
    isError: supervisionError,
  } = useMySupervisionQuery(id ?? '')
  const { data: assignments, isLoading: assignmentsLoading } =
    useSupervisionAssignmentsQuery(supervision?.shiftId ?? '')
  const { data: ratings, isLoading: ratingsLoading } =
    useSupervisionRatingsQuery(id ?? '')
  const { data: vigentCriteria } = useVigentRatingCriteriaQuery()
  const rateEmployee = useRateEmployeeMutation()
  const [score, setScore] = useState<number | null>(null)
  const [comment, setComment] = useState('')
  const [initialized, setInitialized] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const matchedAssignment = assignments?.find(
    (a) => a.assignmentId === assignmentId,
  )
  const employee = matchedAssignment
    ? supervision?.assignedEmployees.find(
        (e) => e.employeeId === matchedAssignment.employeeId,
      )
    : undefined
  const existingRating = ratings?.find((r) => r.assignmentId === assignmentId)
  const { data: avatars } = usePeopleAvatarsQuery(
    employee ? [employee.employeeId] : [],
  )

  // Prellenar con la calificación ya cargada, una sola vez (mismo patrón que
  // la preselección de `NotifyPage`: ajustar el estado durante el render en
  // vez de un efecto, hasta que llegan los datos que hacen falta).
  if (!initialized && ratings) {
    setInitialized(true)
    if (existingRating) {
      setScore(existingRating.score)
      setComment(existingRating.comment ?? '')
    }
  }

  if (
    supervisionLoading ||
    assignmentsLoading ||
    ratingsLoading ||
    !initialized
  ) {
    return (
      <p className="p-4 text-center text-[12.5px] text-text-3">Cargando…</p>
    )
  }
  if (supervisionError || !supervision || !matchedAssignment || !employee) {
    return (
      <Alert variant="crit">
        <AlertDescription>
          No encontramos esa asignación. Volvé al detalle de la supervisión e
          intentá de nuevo.
        </AlertDescription>
      </Alert>
    )
  }

  const backLink = `/sup/supervisiones/${supervision.id}`
  const isSelf = employee.employeeId === auth.userId

  if (isSelf) {
    return (
      <div className="flex flex-1 flex-col gap-4">
        <Alert variant="crit">
          <AlertDescription>No podés calificarte a vos mismo.</AlertDescription>
        </Alert>
        <Button asChild size="mobile" variant="ghost">
          <Link to={backLink}>Volver a la supervisión</Link>
        </Button>
      </div>
    )
  }

  const isActive =
    supervision.status === 'in_progress' || supervision.status === 'completed'
  if (!isActive) {
    return (
      <div className="flex flex-1 flex-col gap-4">
        <Alert variant="crit">
          <AlertDescription>
            Esta supervisión no está en curso ni completada.
          </AlertDescription>
        </Alert>
        <Button asChild size="mobile" variant="ghost">
          <Link to={backLink}>Volver a la supervisión</Link>
        </Button>
      </div>
    )
  }

  const windowClosed = isRatingWindowClosed(supervision)
  if (windowClosed) {
    return (
      <div className="flex flex-1 flex-col gap-4">
        <Alert variant="crit">
          <AlertDescription>
            El plazo para editar esta calificación terminó.
          </AlertDescription>
        </Alert>
        <Button asChild size="mobile" variant="ghost">
          <Link to={backLink}>Volver a la supervisión</Link>
        </Button>
      </div>
    )
  }

  const criteria = supervision.criteriaSnapshot ?? vigentCriteria ?? []
  const name = `${employee.firstName} ${employee.lastName}`.trim()
  const canSave = canRateNow(supervision) && score != null

  async function handleSave() {
    if (score == null) return
    setError(null)
    try {
      await rateEmployee.mutateAsync({
        supervisionId: supervision!.id,
        assignmentId: assignmentId!,
        score,
        comment: comment || undefined,
      })
      void navigate(backLink)
    } catch (mutationError) {
      setError(
        isApiError(mutationError)
          ? mutationError.message
          : 'No pudimos guardar la calificación. Probá de nuevo.',
      )
    }
  }

  return (
    <div className="flex flex-1 flex-col gap-4">
      <Card>
        <CardHeader className="items-start justify-between">
          <PersonCell
            id={employee.employeeId}
            name={name}
            avatarSrc={
              avatars?.[employee.employeeId]
                ? avatarUrl(avatars[employee.employeeId]!)
                : null
            }
          />
          <StatusBadge domain="assignment" status={employee.status} />
        </CardHeader>
      </Card>

      <div className="flex flex-col items-center gap-2 rounded-xl border border-border bg-surface px-4 py-5">
        <p className="text-[12.5px] font-semibold text-text-3">Calificación</p>
        <StarRating
          value={score}
          onValueChange={setScore}
          aria-label="Calificación"
        />
      </div>

      <Textarea
        mobile
        rows={3}
        value={comment}
        onChange={(event) => setComment(event.target.value)}
        placeholder="Comentario (opcional)…"
      />

      {criteria.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Criterios de calificación</CardTitle>
          </CardHeader>
          <CardContent>
            <RatingCriteriaGuide criteria={criteria} />
          </CardContent>
        </Card>
      )}

      {error && (
        <Alert variant="crit">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      {!online && (
        <Alert variant="warn">
          <AlertDescription>
            Estás sin conexión. Conectate para poder guardar.
          </AlertDescription>
        </Alert>
      )}

      <ActionBar>
        <Button
          size="mobile"
          onClick={() => void handleSave()}
          loading={rateEmployee.isPending}
          disabled={!canSave || !online || rateEmployee.isPending}
        >
          Guardar calificación
        </Button>
        <Button asChild size="mobile" variant="ghost">
          <Link to={backLink}>Volver</Link>
        </Button>
      </ActionBar>
    </div>
  )
}
