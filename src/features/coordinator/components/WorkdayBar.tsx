import { useState } from 'react'
import { Link } from 'react-router'
import { Pause, Play, RotateCcw, Square } from 'lucide-react'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Textarea } from '@/components/ui/textarea'
import { formatMinutes, formatTime } from '@/lib/format'
import { getCurrentPositionSafe } from '@/lib/geolocation'
import {
  useTodayWorkdayQuery,
  useWorkdayActionMutation,
  type MyWorkday,
  type WorkdayAction,
} from '@/api/myWorkdays'
import { useNow } from '@/features/employee/useNow'
import { useOnlineStatus } from '@/features/employee/useOnlineStatus'
import { useLocationConsent } from '@/features/employee/useLocationConsent'
import { coordinatorErrorMessage } from '../errors'
import { pauseWorkdaySchema } from '../schemas'
import {
  WORKDAY_ACTION_LABELS,
  WORKDAY_BAR_LABELS,
  WORKDAY_BAR_VARIANTS,
  availableWorkdayActions,
  currentPause,
  liveWorkedMinutes,
  openSupervisionOf,
  workdayActionBlock,
  workdayBarState,
  type WorkdayBarState,
} from '../workday'
import { LocationConsentGate } from './LocationConsentGate'

/** El contador se refresca solo cada 30 s (alcanza para minutos). */
const COUNTER_TICK_MS = 30_000

const ACTION_ICONS: Record<WorkdayAction, typeof Play> = {
  start: Play,
  pause: Pause,
  resume: Play,
  end: Square,
  reopen: RotateCcw,
}

const ACTION_ERROR_FALLBACK =
  'No pudimos registrarlo. Revisá tu conexión y probá de nuevo.'

interface PendingAction {
  action: WorkdayAction
  reason: string | null
}

/**
 * Barra de jornada de SUP-02 (P24.2, CJ-12 a CJ-17, CJ-20, CJ-29, CJ-30): el
 * contador de horas netas, el estado y los botones que corresponden (Iniciar,
 * Pausar con motivo opcional, Reanudar, Finalizar y Reabrir).
 *
 * Cada botón pide la posición con el flujo de consentimiento de B1: si falta
 * el consentimiento (o el texto cambió) se muestra primero el texto de la
 * empresa; si la persona no acepta, niega el permiso o la posición no llega a
 * tiempo, el evento se registra igual, sin coordenadas (ADR-009, CJ-21). Las
 * coordenadas no se muestran.
 *
 * La hora de cada evento y los minutos netos son los del servidor. El contador
 * solo suma lo transcurrido desde la última lectura mientras la jornada está
 * en marcha y se vuelve a anclar con cada lectura (cada 30 s).
 */
export function WorkdayBar() {
  const {
    data: workday,
    isLoading,
    isError,
    dataUpdatedAt,
  } = useTodayWorkdayQuery()
  const mutation = useWorkdayActionMutation()
  const consent = useLocationConsent()
  const online = useOnlineStatus()
  const now = useNow(COUNTER_TICK_MS)
  const [busyAction, setBusyAction] = useState<WorkdayAction | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [consentFor, setConsentFor] = useState<PendingAction | null>(null)
  const [pauseOpen, setPauseOpen] = useState(false)
  const [pauseReason, setPauseReason] = useState('')
  const [pauseError, setPauseError] = useState<string | null>(null)

  if (isLoading) {
    return (
      <Card data-testid="workday-bar">
        <CardContent>
          <p className="text-center text-[12.5px] text-text-3">
            Cargando tu jornada…
          </p>
        </CardContent>
      </Card>
    )
  }
  if (isError) {
    return (
      <Alert variant="crit">
        <AlertDescription>
          No pudimos cargar tu jornada. Probá de nuevo en un momento.
        </AlertDescription>
      </Alert>
    )
  }

  const current = workday ?? null
  const state = workdayBarState(current)
  const actions = availableWorkdayActions(state)
  const openSupervision = openSupervisionOf(current)

  async function run(
    action: WorkdayAction,
    reason: string | null,
    withPosition: boolean,
  ) {
    setError(null)
    setBusyAction(action)
    try {
      const coords = withPosition ? await getCurrentPositionSafe() : null
      await mutation.mutateAsync({ action, coords, reason })
    } catch (mutationError) {
      setError(coordinatorErrorMessage(mutationError, ACTION_ERROR_FALLBACK))
    } finally {
      setBusyAction(null)
    }
  }

  /** Pide el consentimiento si hace falta y después registra el evento. */
  function request(action: WorkdayAction, reason: string | null = null) {
    if (consent.status === 'needs-consent') {
      setConsentFor({ action, reason })
      return
    }
    void run(action, reason, consent.status === 'granted')
  }

  function handlePauseSubmit() {
    const parsed = pauseWorkdaySchema.safeParse({ reason: pauseReason })
    if (!parsed.success) {
      setPauseError(parsed.error.issues[0]?.message ?? 'Revisá el motivo.')
      return
    }
    setPauseError(null)
    setPauseOpen(false)
    setPauseReason('')
    request('pause', parsed.data.reason || null)
  }

  function handleAction(action: WorkdayAction) {
    if (action === 'pause') {
      setPauseOpen(true)
      return
    }
    request(action)
  }

  const disabled = busyAction != null || !online || mutation.isPending

  return (
    <Card data-testid="workday-bar">
      <CardContent className="flex flex-col gap-3">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="text-[11px] font-semibold tracking-[0.4px] text-text-3 uppercase">
              Tu jornada de hoy
            </p>
            {current ? (
              <p
                className="text-[26px] leading-tight font-bold text-text tabular-nums"
                data-testid="workday-counter"
              >
                {formatMinutes(
                  liveWorkedMinutes(current, dataUpdatedAt, now.getTime()),
                )}
              </p>
            ) : (
              <p className="text-[13px] text-text-2">
                Todavía no iniciaste la jornada.
              </p>
            )}
          </div>
          <Badge variant={WORKDAY_BAR_VARIANTS[state]} dot>
            {WORKDAY_BAR_LABELS[state]}
          </Badge>
        </div>

        {current && (
          <WorkdayDetails
            workday={current}
            state={state}
            supervisionLabel={
              openSupervision
                ? `${openSupervision.clientName} · ${openSupervision.siteName}`
                : null
            }
            supervisionId={openSupervision?.supervisionId ?? null}
          />
        )}

        {state === 'auto_closed' && (
          <Alert variant="warn">
            <AlertDescription>
              Tu jornada se cerró sola
              {current?.endedAt
                ? ` a las ${formatTime(current.endedAt)}`
                : ''}{' '}
              porque no la finalizaste. Si el horario no es el correcto, pedile
              a la administración que lo corrija. Si seguís trabajando, podés
              reabrirla.
            </AlertDescription>
          </Alert>
        )}

        {error && (
          <Alert variant="crit">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
        {!online && (
          <Alert variant="warn">
            <AlertDescription>
              Estás sin conexión. Conectate para poder registrar.
            </AlertDescription>
          </Alert>
        )}

        <div
          className={
            actions.length > 1 ? 'grid grid-cols-2 gap-[9px]' : 'grid gap-[9px]'
          }
        >
          {actions.map((action) => {
            const Icon = ACTION_ICONS[action]
            const block = workdayActionBlock(state, action)
            const isPrimary =
              action === 'start' || action === 'resume' || action === 'reopen'
            return (
              <Button
                key={action}
                size="mobile"
                variant={
                  isPrimary
                    ? 'primary'
                    : action === 'end'
                      ? 'destructive'
                      : 'ghost'
                }
                onClick={() => handleAction(action)}
                loading={busyAction === action}
                disabled={disabled || block != null}
              >
                <Icon aria-hidden="true" />
                {WORKDAY_ACTION_LABELS[action]}
              </Button>
            )
          })}
        </div>
        {actions.some((action) => workdayActionBlock(state, action)) && (
          <p className="text-center text-[11.5px] text-text-3">
            {workdayActionBlock(state, 'pause')}
          </p>
        )}
      </CardContent>

      <Dialog
        open={pauseOpen}
        onOpenChange={(next) => {
          setPauseOpen(next)
          if (!next) setPauseError(null)
        }}
      >
        <DialogContent showCloseButton={false}>
          <DialogHeader>
            <DialogTitle>Pausar la jornada</DialogTitle>
            <DialogDescription>
              Mientras estés en pausa no suman horas. Contanos el motivo si
              querés (es opcional).
            </DialogDescription>
          </DialogHeader>
          <Textarea
            mobile
            rows={3}
            value={pauseReason}
            onChange={(event) => setPauseReason(event.target.value)}
            placeholder="Motivo (opcional)…"
            error={pauseError ?? undefined}
            aria-label="Motivo de la pausa"
          />
          <DialogFooter>
            <Button
              size="mobile"
              onClick={handlePauseSubmit}
              disabled={disabled}
            >
              Pausar
            </Button>
            <Button
              size="mobile"
              variant="ghost"
              onClick={() => setPauseOpen(false)}
            >
              Cancelar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <LocationConsentGate
        open={consentFor != null}
        onCancel={() => setConsentFor(null)}
        onResolved={(granted) => {
          const pending = consentFor
          setConsentFor(null)
          if (pending) void run(pending.action, pending.reason, granted)
        }}
      />
    </Card>
  )
}

function WorkdayDetails({
  workday,
  state,
  supervisionLabel,
  supervisionId,
}: {
  workday: MyWorkday
  state: WorkdayBarState
  supervisionLabel: string | null
  supervisionId: string | null
}) {
  const pause = currentPause(workday)
  return (
    <div className="flex flex-col gap-[3px] text-[12px] text-text-3">
      <p>
        Iniciada a las {formatTime(workday.startedAt)}
        {workday.endedAt &&
          ` · Finalizada a las ${formatTime(workday.endedAt)}`}
      </p>
      {state === 'supervising' && supervisionLabel && (
        <p>
          Supervisando:{' '}
          {supervisionId ? (
            <Link
              to={`/sup/supervisiones/${supervisionId}`}
              className="font-semibold text-primary underline-offset-2 hover:underline"
            >
              {supervisionLabel}
            </Link>
          ) : (
            supervisionLabel
          )}
        </p>
      )}
      {pause && (
        <p>
          En pausa desde las {formatTime(pause.startsAt)}
          {pause.reason ? ` · ${pause.reason}` : ''}
        </p>
      )}
      {workday.pauses.length > 0 && (
        <p>
          {workday.pauses.length === 1
            ? '1 pausa'
            : `${workday.pauses.length} pausas`}{' '}
          · {formatMinutes(workday.pauseMinutes)}
        </p>
      )}
    </div>
  )
}
