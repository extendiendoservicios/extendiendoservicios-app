import { useState } from 'react'
import { Navigation } from 'lucide-react'
import { cn } from 'cn'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import type { MyDayAssignment } from '@/api/myDay'
import { useNotifyOnTheWayMutation } from '@/features/employee/queries'
import { useNow } from '@/features/employee/useNow'
import { useOnlineStatus } from '@/features/employee/useOnlineStatus'
import {
  ETA_QUICK_OPTIONS,
  onTheWayAction,
  onTheWayErrorMessage,
  validateEtaMinutes,
} from '@/features/employee/onTheWay'

/**
 * P19.5c · «Estoy en camino»: botón de la tarjeta del próximo servicio
 * (Hoy) y del detalle del servicio, más la hoja «¿En cuánto llegás?».
 * Visible solo dentro de la ventana (desde 3 h antes del inicio efectivo
 * hasta el fin) y mientras no haya inicio ni ausencia avisada; si ya avisó,
 * ofrece «Cambiar hora estimada». El estado («Avisaste que estás en camino
 * · llegás ~HH:MM») lo muestra `getNoticeMessage` en la tarjeta.
 *
 * La visibilidad usa el reloj del dispositivo solo para no ofrecer un botón
 * que seguro fallaría; el servidor valida con el suyo (`ON_THE_WAY_TOO_*`).
 */
export function OnTheWayAction({
  assignment,
  className,
}: {
  assignment: MyDayAssignment
  className?: string
}) {
  const now = useNow(30_000)
  const online = useOnlineStatus()
  const [open, setOpen] = useState(false)
  const action = onTheWayAction(assignment, now)

  if (action === 'none') return null

  return (
    <div className={className}>
      <Button
        size="mobile"
        variant={action === 'notify' ? 'primary' : 'ghost'}
        disabled={!online}
        onClick={() => setOpen(true)}
      >
        <Navigation aria-hidden="true" />
        {action === 'notify' ? 'Estoy en camino' : 'Cambiar hora estimada'}
      </Button>
      <OnTheWaySheet
        assignmentId={assignment.assignmentId}
        open={open}
        onOpenChange={setOpen}
        changing={action === 'change'}
        online={online}
      />
    </div>
  )
}

/** `undefined` = todavía no eligió; `null` = «No sé / sin estimar». */
type Choice = number | null | undefined

function OnTheWaySheet({
  assignmentId,
  open,
  onOpenChange,
  changing,
  online,
}: {
  assignmentId: string
  open: boolean
  onOpenChange: (open: boolean) => void
  changing: boolean
  online: boolean
}) {
  const mutation = useNotifyOnTheWayMutation()
  const [choice, setChoice] = useState<Choice>(undefined)
  const [error, setError] = useState<string | null>(null)

  function handleOpenChange(next: boolean) {
    if (!next) {
      setChoice(undefined)
      setError(null)
    }
    onOpenChange(next)
  }

  async function handleConfirm() {
    if (choice === undefined) return
    const validation = validateEtaMinutes(choice)
    if (validation) {
      setError(validation)
      return
    }
    setError(null)
    try {
      await mutation.mutateAsync({ assignmentId, etaMinutes: choice })
      handleOpenChange(false)
    } catch (mutationError) {
      setError(onTheWayErrorMessage(mutationError))
    }
  }

  return (
    <Sheet open={open} onOpenChange={handleOpenChange}>
      <SheetContent
        side="bottom"
        className="pb-[env(safe-area-inset-bottom)] md:mx-auto md:max-w-[480px]"
      >
        <SheetHeader>
          <SheetTitle>¿En cuánto llegás?</SheetTitle>
          <SheetDescription>
            {changing
              ? 'Elegí la nueva estimación: reemplaza a la que avisaste antes.'
              : 'Es un cálculo aproximado, no hace falta que sea exacto.'}
          </SheetDescription>
        </SheetHeader>
        <div className="flex flex-col gap-3 px-6">
          {!online && (
            <Alert variant="warn">
              <AlertDescription>
                Estás sin conexión: no podés avisar hasta que vuelvas a tener
                señal.
              </AlertDescription>
            </Alert>
          )}
          <div
            role="group"
            aria-label="Minutos hasta llegar"
            className="grid grid-cols-3 gap-2"
          >
            {ETA_QUICK_OPTIONS.map((minutes) => (
              <ChoiceButton
                key={minutes}
                selected={choice === minutes}
                onClick={() => setChoice(minutes)}
              >
                {minutes} min
              </ChoiceButton>
            ))}
          </div>
          <ChoiceButton
            selected={choice === null}
            onClick={() => setChoice(null)}
          >
            No sé / sin estimar
          </ChoiceButton>
          {error && (
            <Alert variant="crit">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
        </div>
        <SheetFooter>
          <Button
            size="mobile"
            loading={mutation.isPending}
            disabled={!online || choice === undefined || mutation.isPending}
            onClick={() => void handleConfirm()}
          >
            Confirmar
          </Button>
          <Button
            size="mobile"
            variant="ghost"
            disabled={mutation.isPending}
            onClick={() => handleOpenChange(false)}
          >
            Cancelar
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  )
}

function ChoiceButton({
  selected,
  onClick,
  children,
}: {
  selected: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onClick}
      className={cn(
        'flex min-h-11 items-center justify-center rounded-lg border px-3 text-[13px] font-semibold transition-colors',
        selected
          ? 'border-primary bg-primary-50 text-primary-800'
          : 'border-border bg-surface text-text-2',
      )}
    >
      {children}
    </button>
  )
}
