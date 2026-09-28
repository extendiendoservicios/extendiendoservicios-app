import { useState } from 'react'
import { Link, Navigate, useNavigate, useParams } from 'react-router'
import { Card, CardContent } from '@/components/ui/card'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { ActionBar } from '@/app/shells/ActionBar'
import { SegmentedControl } from '@/components/SegmentedControl'
import { isApiError } from '@/api/errors'
import { useAuth } from '@/features/auth/AuthProvider'
import { useOnlineStatus } from '@/features/employee/useOnlineStatus'
import {
  useCompleteSupervisionMutation,
  useMarkSupervisionNotDoneMutation,
  useMySupervisionQuery,
  useSupervisionRatingsQuery,
} from '@/api/mySupervisions'

/** Estados en los que ya no hay nada para cerrar en esta pantalla. */
const CLOSED_STATUSES = new Set(['completed', 'not_done', 'cancelled'])

type Tab = 'complete' | 'not_done'

/**
 * SUP-06 · Cerrar supervisión (MOB-SUP-007, `05` fila SUP-06, `06` sección
 * 12, P-082): dos alternativas en un `SegmentedControl` --
 *
 * - "Completar" (`complete_supervision`): nota general opcional, con
 *   advertencia si faltan empleados por calificar (se permite completar
 *   igual, la propia RPC no lo bloquea, `0029_rpc_supervisions.sql`: "se
 *   permite completar sin calificar a todos"). Exige el fin registrado
 *   (`CHECK_OUT_REQUIRED`): sin fin, esta pestaña muestra el aviso y un
 *   enlace a SUP-04 en vez del botón de completar.
 * - "No se pudo realizar" (`mark_supervision_not_done`): motivo
 *   obligatorio. A diferencia de completar, no exige el fin registrado
 *   (`06` sección 12: solo pide `assigned`/`in_progress`) -- por eso esta
 *   pantalla es accesible desde SUP-03 tanto antes de registrar el inicio
 *   como después, no solo con los dos registros hechos.
 *
 * La pestaña inicial es "Completar" si ya hay fin registrado y "No se pudo
 * realizar" si no -- la alternativa más simple de completar en cada caso,
 * sin impedir cambiar de pestaña.
 */
export default function CloseSupervisionPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const auth = useAuth()
  const online = useOnlineStatus()
  const {
    data: supervision,
    isLoading,
    isError,
  } = useMySupervisionQuery(id ?? '')
  const { data: ratings } = useSupervisionRatingsQuery(id ?? '')
  const complete = useCompleteSupervisionMutation()
  const markNotDone = useMarkSupervisionNotDoneMutation()
  const [tab, setTab] = useState<Tab | null>(null)
  const [generalNotes, setGeneralNotes] = useState('')
  const [reason, setReason] = useState('')
  const [fieldError, setFieldError] = useState<string | null>(null)
  const [submitError, setSubmitError] = useState<string | null>(null)

  if (isLoading) {
    return (
      <p className="p-4 text-center text-[12.5px] text-text-3">Cargando…</p>
    )
  }
  if (isError || !supervision) {
    return (
      <Alert variant="crit">
        <AlertDescription>
          No encontramos esa supervisión. Volvé a Hoy e intentá de nuevo.
        </AlertDescription>
      </Alert>
    )
  }
  if (CLOSED_STATUSES.has(supervision.status)) {
    return <Navigate to={`/sup/supervisiones/${supervision.id}`} replace />
  }

  const hasCheckOut = supervision.checkOutAt != null
  const activeTab: Tab = tab ?? (hasCheckOut ? 'complete' : 'not_done')

  const totalToRate = supervision.assignedEmployees.filter(
    (e) => e.employeeId !== auth.userId,
  ).length
  const ratedCount = ratings?.length ?? 0
  const missing = Math.max(0, totalToRate - ratedCount)

  const busy = complete.isPending || markNotDone.isPending

  async function handleComplete() {
    setSubmitError(null)
    try {
      await complete.mutateAsync({
        supervisionId: supervision!.id,
        generalNotes: generalNotes || undefined,
      })
      void navigate('/sup', { replace: true })
    } catch (mutationError) {
      setSubmitError(
        isApiError(mutationError)
          ? mutationError.message
          : 'No pudimos completar la supervisión. Probá de nuevo.',
      )
    }
  }

  async function handleMarkNotDone() {
    setFieldError(null)
    setSubmitError(null)
    if (reason.trim() === '') {
      setFieldError('Indicá el motivo.')
      return
    }
    try {
      await markNotDone.mutateAsync({
        supervisionId: supervision!.id,
        reason,
      })
      void navigate('/sup', { replace: true })
    } catch (mutationError) {
      setSubmitError(
        isApiError(mutationError)
          ? mutationError.message
          : 'No pudimos guardar. Probá de nuevo.',
      )
    }
  }

  return (
    <div className="flex flex-1 flex-col gap-4">
      <SegmentedControl
        mobile
        aria-label="Cómo cerrar la supervisión"
        value={activeTab}
        onValueChange={setTab}
        options={[
          { value: 'complete', label: 'Completar' },
          { value: 'not_done', label: 'No se pudo realizar', critical: true },
        ]}
      />

      {activeTab === 'complete' ? (
        !hasCheckOut ? (
          <div className="flex flex-col gap-4">
            <Alert variant="warn">
              <AlertDescription>
                Todavía no registraste el fin de la supervisión. Registralo para
                poder completarla.
              </AlertDescription>
            </Alert>
            <Button asChild size="mobile">
              <Link to={`/sup/supervisiones/${supervision.id}/registro`}>
                Registrar fin de supervisión
              </Link>
            </Button>
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            <Card>
              <CardContent className="flex flex-col gap-1">
                <p className="text-[13px] text-text-2">
                  Calificaste a {ratedCount} de {totalToRate}{' '}
                  {totalToRate === 1 ? 'empleado' : 'empleados'}.
                </p>
              </CardContent>
            </Card>
            {missing > 0 && (
              <Alert variant="warn">
                <AlertDescription>
                  {missing === 1
                    ? 'Falta 1 empleado por calificar'
                    : `Faltan ${missing} empleados por calificar`}
                  . Podés completar igual.
                </AlertDescription>
              </Alert>
            )}
            <Textarea
              mobile
              rows={3}
              value={generalNotes}
              onChange={(event) => setGeneralNotes(event.target.value)}
              placeholder="Nota general (opcional)…"
            />
          </div>
        )
      ) : (
        <div className="flex flex-col gap-4">
          <p className="text-[12.5px] text-text-3">
            Contá por qué no se pudo realizar la supervisión.
          </p>
          <Textarea
            mobile
            rows={3}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            placeholder="Motivo…"
            error={fieldError ?? undefined}
          />
        </div>
      )}

      {submitError && (
        <Alert variant="crit">
          <AlertDescription>{submitError}</AlertDescription>
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
        {activeTab === 'complete' ? (
          <Button
            size="mobile"
            onClick={() => void handleComplete()}
            loading={complete.isPending}
            disabled={!hasCheckOut || !online || busy}
          >
            Completar supervisión
          </Button>
        ) : (
          <Button
            size="mobile"
            variant="destructive"
            onClick={() => void handleMarkNotDone()}
            loading={markNotDone.isPending}
            disabled={!online || busy}
          >
            Marcar como no realizada
          </Button>
        )}
        <Button asChild size="mobile" variant="ghost" disabled={busy}>
          <Link to={`/sup/supervisiones/${supervision.id}`}>Volver</Link>
        </Button>
      </ActionBar>
    </div>
  )
}
