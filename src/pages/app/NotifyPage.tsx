import { useRef, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { RadioGroup } from '@/components/ui/radio-group'
import { Textarea } from '@/components/ui/textarea'
import { OptionCard } from '@/components/OptionCard'
import { SegmentedControl } from '@/components/SegmentedControl'
import { Stepper } from '@/components/Stepper'
import { EmptyState } from '@/components/EmptyState'
import { ActionBar } from '@/app/shells/ActionBar'
import { CalendarX } from 'lucide-react'
import { isApiError } from '@/api/errors'
import type { NoticeKind } from '@/api/notices'
import type { MyDayAssignment } from '@/api/myDay'
import { formatCalendarDate } from '@/lib/format'
import {
  ABSENCE_REASON_OPTIONS,
  absenceReasonLabel,
  absenceReasonRequiresText,
  type AbsenceReason,
} from '@/lib/absenceReasons'
import { useOnlineStatus } from '@/features/employee/useOnlineStatus'
import {
  useMyDayQuery,
  useNotifyAbsenceMutation,
  useNotifyDelayMutation,
} from '@/features/employee/queries'
import {
  availableNoticeKinds,
  isNotifiable,
} from '@/features/employee/notifyCandidates'
import {
  absenceReasonSchema,
  delayMinutesSchema,
} from '@/features/employee/notifySchemas'
import { formatAssignmentRange } from '@/features/employee/shiftRange'

/**
 * EMP-12 · Avisar demora o ausencia (MOB-EMP-020, `05` fila EMP-12, ABS-004,
 * P-072, P-073): selector del servicio (solo los que aún no empezaron),
 * tipo de aviso, minutos u motivo, confirmación y resultado. Se entra desde
 * Hoy (EMP-03), desde el detalle (EMP-04, con `?asignacion=` ya elegida) y
 * desde Más (EMP-13, sin preselección).
 *
 * Los cinco pasos viven en un único componente con un `step` local (mismo
 * criterio que `LocationConsentPage`/`FinishPage`: son pantallas de un solo
 * uso, sin necesidad de rutas propias por paso) y una pila `history` para
 * que "Atrás" vuelva al paso justo anterior, sin importar si se saltó el
 * selector de servicio (preselección) o el de tipo (cuando la asignación ya
 * tiene una demora avisada y solo puede pasar a ausencia, P-072/P-073).
 */

type Step = 'servicio' | 'tipo' | 'detalle' | 'confirmar' | 'resultado'

export default function NotifyPage() {
  const navigate = useNavigate()
  const online = useOnlineStatus()
  const [searchParams] = useSearchParams()
  const preselectedId = searchParams.get('asignacion')

  const { data: myDay, isLoading } = useMyDayQuery()
  const notifyDelay = useNotifyDelayMutation()
  const notifyAbsence = useNotifyAbsenceMutation()

  const candidates = (myDay ?? []).filter(isNotifiable)
  const preselected = preselectedId
    ? candidates.find((a) => a.assignmentId === preselectedId)
    : undefined

  // Pila de pasos ya recorridos, para que "Atrás" vuelva al paso justo
  // anterior sin importar cuál se saltó (preselección, tipo único
  // disponible). No hace falta re-renderizar cuando cambia: un `ref`
  // alcanza (a diferencia de `step`, que sí se muestra en pantalla).
  const historyRef = useRef<Step[]>([])
  const [step, setStep] = useState<Step>('servicio')
  const [assignmentId, setAssignmentId] = useState<string | null>(null)
  const [kind, setKind] = useState<NoticeKind>('delay')
  const [minutes, setMinutes] = useState(15)
  const [delayReasonText, setDelayReasonText] = useState('')
  const [absenceReasonCode, setAbsenceReasonCode] = useState<
    AbsenceReason | ''
  >('')
  const [absenceReasonText, setAbsenceReasonText] = useState('')
  const [fieldError, setFieldError] = useState<string | null>(null)
  const [submitError, setSubmitError] = useState<string | null>(null)

  const assignment = candidates.find((a) => a.assignmentId === assignmentId)

  /**
   * La preselección (`?asignacion=`, EMP-04/EMP-13) depende de `v_my_day`,
   * que todavía no llegó en el primer render: se resuelve ajustando el
   * estado durante el render mismo (patrón "adjusting state when a prop
   * changes" que documenta React, no un efecto) apenas `myDay` llega por
   * primera vez, con `initialized` (estado, no `ref`: el linter de reglas
   * de hooks no deja leer un `ref` durante el render) asegurando que esto
   * corra una única vez — si `myDay` vuelve a cambiar más adelante (el
   * polling, o la invalidación después de un aviso), no hay que volver a
   * resolver la preselección y pisar lo que la persona ya eligió. Si la
   * asignación pedida ya no está entre las que se pueden avisar (por
   * ejemplo, alguien la abrió con un enlace viejo y ya pasó la hora), se
   * queda en el selector completo (`servicio`, el valor inicial de `step`).
   */
  const [initialized, setInitialized] = useState(false)
  if (!initialized && myDay) {
    setInitialized(true)
    if (preselected) {
      setAssignmentId(preselected.assignmentId)
      const kinds = availableNoticeKinds(preselected)
      setKind(kinds[0] ?? 'delay')
      setStep(kinds.length > 1 ? 'tipo' : 'detalle')
    }
  }

  function goTo(next: Step) {
    historyRef.current = [...historyRef.current, step]
    setFieldError(null)
    setStep(next)
  }

  function goBack() {
    setFieldError(null)
    const previousStep = historyRef.current[historyRef.current.length - 1]
    if (previousStep) {
      historyRef.current = historyRef.current.slice(0, -1)
      setStep(previousStep)
    }
  }

  /** Elegir el servicio en el paso 1 solo guarda la selección: el avance de paso lo hace "Continuar" (`handleContinueFromService`), no el radio en sí. */
  function handleSelectService(picked: MyDayAssignment) {
    setAssignmentId(picked.assignmentId)
  }

  function handleContinueFromService() {
    if (!assignment) return
    const kinds = availableNoticeKinds(assignment)
    const nextKind = kinds[0] ?? 'delay'
    setKind(nextKind)
    goTo(kinds.length > 1 ? 'tipo' : 'detalle')
  }

  function handlePickKind() {
    goTo('detalle')
  }

  function handleConfirmDetail() {
    setFieldError(null)
    if (kind === 'delay') {
      const result = delayMinutesSchema.safeParse(String(minutes))
      if (!result.success) {
        setFieldError(result.error.issues[0]?.message ?? null)
        return
      }
    } else {
      const result = absenceReasonSchema.safeParse({
        reasonCode: absenceReasonCode,
        reasonText: absenceReasonText,
      })
      if (!result.success) {
        setFieldError(result.error.issues[0]?.message ?? null)
        return
      }
    }
    goTo('confirmar')
  }

  async function handleSubmit() {
    if (!assignment) return
    setSubmitError(null)
    try {
      if (kind === 'delay') {
        await notifyDelay.mutateAsync({
          assignmentId: assignment.assignmentId,
          minutes,
          reasonText: delayReasonText || undefined,
        })
      } else {
        await notifyAbsence.mutateAsync({
          assignmentId: assignment.assignmentId,
          reasonCode: absenceReasonCode as AbsenceReason,
          reasonText: absenceReasonText || undefined,
        })
      }
      goTo('resultado')
    } catch (mutationError) {
      setSubmitError(
        isApiError(mutationError)
          ? mutationError.message
          : 'No pudimos guardar el aviso. Probá de nuevo.',
      )
    }
  }

  if (isLoading) {
    return (
      <p className="p-4 text-center text-[12.5px] text-text-3">Cargando…</p>
    )
  }

  const submitting = notifyDelay.isPending || notifyAbsence.isPending
  const isBusy = submitting

  return (
    <div className="flex flex-1 flex-col gap-4">
      {!online && step !== 'resultado' && (
        <Alert variant="warn">
          <AlertDescription>
            Estás sin conexión: no podés avisar hasta que vuelvas a tener señal.
          </AlertDescription>
        </Alert>
      )}

      {step === 'servicio' && (
        <ServiceStep
          candidates={candidates}
          selectedId={assignmentId}
          onPick={handleSelectService}
        />
      )}

      {step === 'tipo' && assignment && (
        <TypeStep assignment={assignment} kind={kind} onKindChange={setKind} />
      )}

      {step === 'detalle' && assignment && kind === 'delay' && (
        <DelayDetailStep
          minutes={minutes}
          onMinutesChange={setMinutes}
          reasonText={delayReasonText}
          onReasonTextChange={setDelayReasonText}
          error={fieldError}
        />
      )}

      {step === 'detalle' && assignment && kind === 'absence' && (
        <AbsenceDetailStep
          reasonCode={absenceReasonCode}
          onReasonCodeChange={setAbsenceReasonCode}
          reasonText={absenceReasonText}
          onReasonTextChange={setAbsenceReasonText}
          error={fieldError}
        />
      )}

      {step === 'confirmar' && assignment && (
        <ConfirmStep
          assignment={assignment}
          kind={kind}
          minutes={minutes}
          reasonText={kind === 'delay' ? delayReasonText : absenceReasonText}
          reasonCode={kind === 'absence' ? absenceReasonCode || null : null}
          error={submitError}
        />
      )}

      {step === 'resultado' && <ResultStep kind={kind} minutes={minutes} />}

      {step === 'servicio' && candidates.length === 0 && (
        <ActionBar>
          <Button asChild size="mobile" variant="ghost">
            <Link to="/app">Volver a Hoy</Link>
          </Button>
        </ActionBar>
      )}

      {step === 'servicio' && candidates.length > 0 && (
        <ActionBar>
          <Button
            size="mobile"
            disabled={!assignmentId}
            onClick={handleContinueFromService}
          >
            Continuar
          </Button>
        </ActionBar>
      )}

      {step === 'tipo' && (
        <ActionBar>
          <Button size="mobile" onClick={handlePickKind}>
            Continuar
          </Button>
          <Button size="mobile" variant="ghost" onClick={goBack}>
            Atrás
          </Button>
        </ActionBar>
      )}

      {step === 'detalle' && (
        <ActionBar>
          <Button size="mobile" onClick={handleConfirmDetail}>
            Continuar
          </Button>
          <Button size="mobile" variant="ghost" onClick={goBack}>
            Atrás
          </Button>
        </ActionBar>
      )}

      {step === 'confirmar' && (
        <ActionBar>
          <Button
            size="mobile"
            loading={isBusy}
            disabled={!online || isBusy}
            onClick={() => void handleSubmit()}
          >
            Confirmar aviso
          </Button>
          <Button
            size="mobile"
            variant="ghost"
            disabled={isBusy}
            onClick={goBack}
          >
            Atrás
          </Button>
        </ActionBar>
      )}

      {step === 'resultado' && (
        <ActionBar>
          <Button size="mobile" onClick={() => void navigate('/app')}>
            Volver a Hoy
          </Button>
        </ActionBar>
      )}
    </div>
  )
}

function ServiceStep({
  candidates,
  selectedId,
  onPick,
}: {
  candidates: MyDayAssignment[]
  selectedId: string | null
  onPick: (assignment: MyDayAssignment) => void
}) {
  if (candidates.length === 0) {
    return (
      <EmptyState
        icon={CalendarX}
        title="No tenés servicios para avisar"
        description="Todos tus servicios ya empezaron o ya avisaste que no vas."
      />
    )
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="text-[12.5px] text-text-3">
        Elegí el servicio sobre el que querés avisar.
      </p>
      <RadioGroup
        value={selectedId ?? undefined}
        onValueChange={(value) => {
          const picked = candidates.find((a) => a.assignmentId === value)
          if (picked) onPick(picked)
        }}
      >
        {candidates.map((candidate) => (
          <OptionCard
            key={candidate.assignmentId}
            value={candidate.assignmentId}
            title={`${candidate.clientName} · ${candidate.siteName}`}
            description={`${formatCalendarDate(candidate.shiftDate)} · ${formatAssignmentRange(candidate)}`}
          />
        ))}
      </RadioGroup>
    </div>
  )
}

function TypeStep({
  assignment,
  kind,
  onKindChange,
}: {
  assignment: MyDayAssignment
  kind: NoticeKind
  onKindChange: (kind: NoticeKind) => void
}) {
  return (
    <div className="flex flex-col gap-4">
      <p className="text-[12.5px] text-text-3">
        {assignment.clientName} · {assignment.siteName} ·{' '}
        {formatAssignmentRange(assignment)}
      </p>
      <SegmentedControl
        mobile
        aria-label="Tipo de aviso"
        value={kind}
        onValueChange={onKindChange}
        options={[
          { value: 'delay', label: 'Demora' },
          { value: 'absence', label: 'Ausencia', critical: true },
        ]}
      />
    </div>
  )
}

function DelayDetailStep({
  minutes,
  onMinutesChange,
  reasonText,
  onReasonTextChange,
  error,
}: {
  minutes: number
  onMinutesChange: (value: number) => void
  reasonText: string
  onReasonTextChange: (value: string) => void
  error: string | null
}) {
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col items-center gap-2 rounded-xl border border-border bg-surface px-4 py-5">
        <p className="text-[12.5px] font-semibold text-text-3">
          Minutos de demora estimados
        </p>
        <Stepper
          aria-label="Minutos de demora"
          value={minutes}
          onValueChange={onMinutesChange}
          min={1}
          max={600}
          step={5}
          formatValue={(value) => `${value} min`}
        />
      </div>
      {error && (
        <Alert variant="crit">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      <Textarea
        mobile
        rows={3}
        value={reasonText}
        onChange={(event) => onReasonTextChange(event.target.value)}
        placeholder="Contá el motivo (opcional)…"
      />
    </div>
  )
}

function AbsenceDetailStep({
  reasonCode,
  onReasonCodeChange,
  reasonText,
  onReasonTextChange,
  error,
}: {
  reasonCode: AbsenceReason | ''
  onReasonCodeChange: (value: AbsenceReason) => void
  reasonText: string
  onReasonTextChange: (value: string) => void
  error: string | null
}) {
  return (
    <div className="flex flex-col gap-4">
      <p className="text-[12.5px] text-text-3">
        Elegí el motivo. La ausencia no libera tu lugar: lo decide la
        administración.
      </p>
      {error && (
        <Alert variant="crit">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      <RadioGroup
        value={reasonCode || undefined}
        onValueChange={(value) => onReasonCodeChange(value as AbsenceReason)}
      >
        {ABSENCE_REASON_OPTIONS.map((option) => (
          <OptionCard
            key={option.value}
            value={option.value}
            title={option.label}
          />
        ))}
      </RadioGroup>
      {reasonCode && absenceReasonRequiresText(reasonCode) && (
        <Textarea
          mobile
          rows={3}
          value={reasonText}
          onChange={(event) => onReasonTextChange(event.target.value)}
          placeholder="Contanos el motivo…"
        />
      )}
    </div>
  )
}

function ConfirmStep({
  assignment,
  kind,
  minutes,
  reasonText,
  reasonCode,
  error,
}: {
  assignment: MyDayAssignment
  kind: NoticeKind
  minutes: number
  reasonText: string
  reasonCode: AbsenceReason | null
  error: string | null
}) {
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-[6px] rounded-xl border border-border bg-surface px-4 py-[14px]">
        <p className="text-[13px] font-semibold text-text">
          {assignment.clientName} · {assignment.siteName}
        </p>
        <p className="text-[12px] text-text-3">
          {formatCalendarDate(assignment.shiftDate)} ·{' '}
          {formatAssignmentRange(assignment)}
        </p>
        <p className="mt-2 text-[13px] text-text-2">
          {kind === 'delay'
            ? `Vas a avisar una demora de ${minutes} min.`
            : reasonCode && reasonCode !== 'other'
              ? `Vas a avisar que no vas: ${absenceReasonLabel(reasonCode).toLowerCase()}.`
              : 'Vas a avisar que no vas.'}
        </p>
        {reasonText && (
          <p className="text-[12px] text-text-3">"{reasonText}"</p>
        )}
      </div>
      {error && (
        <Alert variant="crit">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
    </div>
  )
}

function ResultStep({ kind, minutes }: { kind: NoticeKind; minutes: number }) {
  return (
    <Alert variant="info">
      <AlertDescription>
        {kind === 'delay'
          ? `Avisaste una demora de ${minutes} min.`
          : 'Avisaste que no vas.'}
      </AlertDescription>
    </Alert>
  )
}
