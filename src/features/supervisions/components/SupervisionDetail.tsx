import { useState } from 'react'
import { Ban, ClipboardX, ShieldCheck, Star } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { EmptyState } from '@/components/EmptyState'
import { PersonCell } from '@/components/PersonCell'
import { StarRating } from '@/components/StarRating'
import { StatusBadge } from '@/components/status'
import { formatDateOnly } from '@/features/settings/dateOnly'
import { formatShortDate, formatTime } from '@/lib/format'
import { useAuth } from '@/features/auth/AuthProvider'
import type { SupervisionEmployeeRating } from '@/api/supervisions'
import {
  canEditRatingsAlways,
  canManageSupervisions,
  canMarkSupervisionNotDone,
} from '@/features/supervisions/permissions'
import { useSupervisionDetailQuery } from '@/features/supervisions/queries'
import { CancelSupervisionDialog } from './CancelSupervisionDialog'
import { MarkSupervisionNotDoneDialog } from './MarkSupervisionNotDoneDialog'
import { RateEmployeeDialog } from './RateEmployeeDialog'

/** `cancel_supervision`/`mark_supervision_not_done` (`0029`): solo `assigned`/`in_progress`. */
const EDITABLE_STATUSES = new Set(['assigned', 'in_progress'])
// `rate_employee` solo acepta supervisiones en curso o completadas
// (SUPERVISION_NOT_ACTIVE): en las demás no se ofrece calificar.
const RATEABLE_STATUSES = new Set(['in_progress', 'completed'])

/**
 * ADM-15 "Supervisión · detalle" (SUP-011, `05` línea 59): cabecera (turno,
 * sede, supervisor, estado, inicio y fin), criterios usados, nota general y
 * calificaciones por empleado (estrellas, comentario, quién y cuándo editó).
 * `cancel_supervision`/`mark_supervision_not_done` (motivo obligatorio) y
 * `rate_employee` (edición administrativa, capacidad `edit_ratings`).
 * `SupervisionDetailPage` decide si esto va en un drawer o en una página
 * completa, mismo criterio que `ShiftDetail`/`ShiftDetailPage`.
 */
interface SupervisionDetailProps {
  supervisionId: string
}

function SupervisionDetail({ supervisionId }: SupervisionDetailProps) {
  const auth = useAuth()
  const actor = { roles: auth.roles, capabilities: auth.capabilities }
  const canManage = canManageSupervisions(actor)
  // `mark_supervision_not_done` no exige `manage_supervisions` (`06` sección 12).
  const canMarkNotDone = canMarkSupervisionNotDone(actor)
  const canEditRatings = canEditRatingsAlways(actor)

  const detailQuery = useSupervisionDetailQuery(supervisionId)
  const [isCancelOpen, setCancelOpen] = useState(false)
  const [isNotDoneOpen, setNotDoneOpen] = useState(false)
  const [rateTarget, setRateTarget] =
    useState<SupervisionEmployeeRating | null>(null)

  if (detailQuery.isLoading) {
    return (
      <div className="flex flex-col gap-3">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-32" />
        <Skeleton className="h-32" />
      </div>
    )
  }

  const result = detailQuery.data
  if (!result) {
    return (
      <EmptyState
        icon={ShieldCheck}
        title="No encontramos esta supervisión"
        description="Puede que se haya movido o que el enlace esté roto."
      />
    )
  }

  const { detail, employeeRatings } = result
  const isEditable = EDITABLE_STATUSES.has(detail.status)
  const isRateable = RATEABLE_STATUSES.has(detail.status)

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-2 rounded-lg border border-border bg-surface p-5">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-[15px] font-semibold text-text">
            {detail.clientName} · {detail.siteName}
          </h2>
          <StatusBadge domain="supervision" status={detail.status} />
        </div>
        <p className="text-[12.5px] text-text-3 capitalize">
          {formatDateOnly(detail.shiftDate)} · {detail.startTime.slice(0, 5)}–
          {detail.endTime.slice(0, 5)}
        </p>
        <PersonCell
          id={detail.supervisorId}
          name={`${detail.supervisorFirstName} ${detail.supervisorLastName}`}
          subtitle="Supervisor"
        />
        <dl className="mt-1 grid grid-cols-2 gap-x-6 gap-y-1 text-[12px] text-text-2 sm:grid-cols-4">
          <div>
            <dt className="text-[10px] font-semibold tracking-wide text-text-3 uppercase">
              Inicio
            </dt>
            <dd>{detail.checkInAt ? formatTime(detail.checkInAt) : '—'}</dd>
          </div>
          <div>
            <dt className="text-[10px] font-semibold tracking-wide text-text-3 uppercase">
              Fin
            </dt>
            <dd>{detail.checkOutAt ? formatTime(detail.checkOutAt) : '—'}</dd>
          </div>
        </dl>
        {detail.status === 'cancelled' && detail.cancelReason && (
          <p className="text-[12px] text-danger-800">
            Motivo de la cancelación: {detail.cancelReason}
          </p>
        )}
        {detail.status === 'not_done' && detail.notDoneReason && (
          <p className="text-[12px] text-danger-800">
            Motivo: {detail.notDoneReason}
          </p>
        )}
        {(canMarkNotDone || canManage) && isEditable && (
          <div className="flex flex-wrap gap-2 pt-1">
            {canMarkNotDone && (
              <Button
                variant="ghost"
                size="sm"
                icon={ClipboardX}
                onClick={() => setNotDoneOpen(true)}
              >
                Marcar como no realizada
              </Button>
            )}
            {canManage && (
              <Button
                variant="ghost"
                size="sm"
                icon={Ban}
                onClick={() => setCancelOpen(true)}
              >
                Cancelar supervisión
              </Button>
            )}
          </div>
        )}
      </div>

      <section className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-5">
        <h3 className="text-[13px] font-semibold text-text">
          Criterios usados
        </h3>
        {detail.criteriaSnapshot.length === 0 ? (
          <p className="text-[12px] text-text-3">
            Esta supervisión todavía no registró un inicio, así que no tiene
            criterios guardados.
          </p>
        ) : (
          <ul className="flex flex-col gap-1">
            {detail.criteriaSnapshot.map((criterion) => (
              <li key={criterion.id} className="text-[12.5px] text-text-2">
                <span className="font-semibold text-text">
                  {criterion.title}
                </span>
                {criterion.description ? ` · ${criterion.description}` : ''}
              </li>
            ))}
          </ul>
        )}
      </section>

      {detail.generalNotes && (
        <section className="flex flex-col gap-2 rounded-lg border border-border bg-surface p-5">
          <h3 className="text-[13px] font-semibold text-text">Nota general</h3>
          <p className="text-[12.5px] whitespace-pre-wrap text-text-2">
            {detail.generalNotes}
          </p>
        </section>
      )}

      <section className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-5">
        <h3 className="flex items-center gap-2 text-[13px] font-semibold text-text">
          <Star aria-hidden="true" className="size-4 text-text-3" />
          Calificaciones por empleado
        </h3>
        {employeeRatings.length === 0 ? (
          <p className="text-[12px] text-text-3">
            Este turno no tiene empleados asignados.
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {employeeRatings.map((employeeRating) => (
              <li
                key={employeeRating.assignmentId}
                className="flex flex-col gap-2 rounded-md border border-border p-3"
              >
                <PersonCell
                  id={employeeRating.employeeId}
                  name={`${employeeRating.employeeFirstName} ${employeeRating.employeeLastName}`}
                />
                <div className="flex flex-col items-start gap-1">
                  {employeeRating.rating ? (
                    <>
                      <StarRating
                        value={employeeRating.rating.score}
                        readOnly
                        size="sm"
                      />
                      {employeeRating.rating.comment && (
                        <p className="max-w-xs text-[12px] text-text-2">
                          {employeeRating.rating.comment}
                        </p>
                      )}
                      {employeeRating.rating.updatedAt &&
                        employeeRating.rating.updatedByFirstName && (
                          <p className="text-[11px] text-text-3">
                            Editado por{' '}
                            {employeeRating.rating.updatedByFirstName}{' '}
                            {employeeRating.rating.updatedByLastName} el{' '}
                            {formatShortDate(employeeRating.rating.updatedAt)}{' '}
                            {formatTime(employeeRating.rating.updatedAt)}
                          </p>
                        )}
                    </>
                  ) : (
                    <p className="text-[12px] text-text-3">Sin calificar</p>
                  )}
                  {canEditRatings && isRateable && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setRateTarget(employeeRating)}
                    >
                      {employeeRating.rating
                        ? 'Editar calificación'
                        : 'Calificar'}
                    </Button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <CancelSupervisionDialog
        supervisionId={supervisionId}
        open={isCancelOpen}
        onOpenChange={setCancelOpen}
      />
      <MarkSupervisionNotDoneDialog
        supervisionId={supervisionId}
        open={isNotDoneOpen}
        onOpenChange={setNotDoneOpen}
      />
      {rateTarget && (
        <RateEmployeeDialog
          supervisionId={supervisionId}
          assignmentId={rateTarget.assignmentId}
          employeeName={`${rateTarget.employeeFirstName} ${rateTarget.employeeLastName}`}
          currentScore={rateTarget.rating?.score ?? null}
          currentComment={rateTarget.rating?.comment ?? null}
          open={rateTarget != null}
          onOpenChange={(open) => {
            if (!open) {
              setRateTarget(null)
            }
          }}
        />
      )}
    </div>
  )
}

export { SupervisionDetail }
