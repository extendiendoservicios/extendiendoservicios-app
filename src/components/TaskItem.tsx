import * as React from 'react'
import { cn } from 'cn'
import { Check, X } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { formatTime, type DateInput } from '@/lib/format'
import type { TaskStatus } from '@/components/status'

/**
 * TaskItem (DS-012): `07` sección 2.4 — `.task` con casilla 22 px, variante
 * `done` atenuada y `next` resaltada, estado "no realizada" con motivo
 * (`Mockup/assets/ds2.css` `.task`/`.tbox`; ejemplo de pantalla M10).
 *
 * No llama a ninguna API: solo avisa por callback (`onComplete`,
 * `onMarkNotDone`, `onUndo`) — quien lo usa decide qué RPC llamar y qué
 * hacer si falla.
 */
interface TaskItemProps {
  id: string
  title: string
  description?: string
  status: TaskStatus
  /** `shift_tasks.is_required`. Default `true` — sin etiqueta "opcional". */
  isRequired?: boolean
  /** `shift_tasks.not_done_reason`, obligatorio cuando `status` es `not_done`. */
  notDoneReason?: string
  /** Cuándo se completó (se muestra como "Completada HH:mm"). */
  completedAt?: DateInput
  /**
   * La marca `TaskList` en la primera tarea todavía no resuelta (`07`:
   * variante "next" resaltada) — ver `TaskList.tsx`.
   */
  isNext?: boolean
  /** Para el supervisor o antes de que arranque el turno: sin acciones. */
  readOnly?: boolean
  /** pending/in_progress → done. */
  onComplete?: (id: string) => void
  /** Confirmado el motivo obligatorio → not_done. */
  onMarkNotDone?: (id: string, reason: string) => void
  /** Deshacer una tarea done/not_done (vuelve a pending). Opcional. */
  onUndo?: (id: string) => void
  className?: string
}

function TaskItem({
  id,
  title,
  description,
  status,
  isRequired = true,
  notDoneReason,
  completedAt,
  isNext = false,
  readOnly = false,
  onComplete,
  onMarkNotDone,
  onUndo,
  className,
}: TaskItemProps) {
  const [notDoneDialogOpen, setNotDoneDialogOpen] = React.useState(false)
  const isDone = status === 'done'
  const isNotDone = status === 'not_done'
  const isActionable =
    !readOnly && (status === 'pending' || status === 'in_progress')

  function handleCheckboxClick() {
    if (readOnly) {
      return
    }
    if (isDone || isNotDone) {
      onUndo?.(id)
      return
    }
    onComplete?.(id)
  }

  function handleConfirmNotDone(reason: string) {
    onMarkNotDone?.(id, reason)
    setNotDoneDialogOpen(false)
  }

  const subtitle = getSubtitle({
    status,
    isNext,
    notDoneReason,
    completedAt,
  })

  return (
    <div
      className={cn(
        'flex items-start gap-[11px] py-[11px]',
        // ".task.next" (ds2.css): resaltada, con el margen negativo del
        // mockup para que el casillero quede alineado con los demás ítems
        // (sin él, la fila resaltada quedaba corrida 11 px). Todos los
        // contenedores actuales tienen al menos 14 px de padding lateral.
        isNext && '-mx-[11px] rounded-sm bg-primary-50 px-[11px]',
        className,
      )}
    >
      <button
        type="button"
        role="checkbox"
        aria-checked={isDone}
        aria-label={getCheckboxLabel(status, title, readOnly)}
        disabled={readOnly}
        onClick={handleCheckboxClick}
        className={cn(
          'relative mt-[1px] grid size-[22px] shrink-0 place-items-center rounded-[var(--r-task-box)] border-2 outline-none transition-colors focus-visible:ring-3 focus-visible:ring-ring disabled:pointer-events-none',
          // Área táctil ≥44 px sin cambiar el tamaño visual (07 sección 5).
          "after:absolute after:-inset-[11px] after:content-['']",
          isDone && 'border-success bg-success',
          isNotDone && 'border-danger bg-danger',
          !isDone && !isNotDone && 'border-border-strong bg-surface',
        )}
      >
        {isDone && (
          <Check
            aria-hidden="true"
            className="size-[12px] stroke-[3.2] text-white"
          />
        )}
        {isNotDone && (
          <X
            aria-hidden="true"
            className="size-[12px] stroke-[3.2] text-white"
          />
        )}
      </button>

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-[6px]">
          <p
            className={cn(
              'text-[14px] leading-[1.3] font-semibold',
              isDone ? 'text-text-3' : 'text-text',
            )}
          >
            {title}
          </p>
          {!isRequired && (
            <Badge variant="neutral" className="shrink-0">
              Opcional
            </Badge>
          )}
        </div>
        {description && (
          <p className="mt-[2px] text-[11.5px] text-text-2">{description}</p>
        )}
        <p
          className={cn(
            'mt-[2px] text-[11.5px] leading-[1.4]',
            isNotDone ? 'text-danger-800' : 'text-text-3',
          )}
        >
          {subtitle}
        </p>
      </div>

      {isActionable && onMarkNotDone && (
        <Button
          type="button"
          variant="link"
          className="shrink-0 self-start text-[11px]"
          onClick={() => setNotDoneDialogOpen(true)}
        >
          No realizada
        </Button>
      )}

      <ConfirmDialog
        open={notDoneDialogOpen}
        onOpenChange={setNotDoneDialogOpen}
        title={`Marcar "${title}" como no realizada`}
        reasonLabel="Motivo"
        reasonPlaceholder="Contá por qué no se pudo hacer…"
        confirmLabel="Marcar no realizada"
        variant="destructive"
        onConfirm={handleConfirmNotDone}
      />
    </div>
  )
}

function getCheckboxLabel(
  status: TaskStatus,
  title: string,
  readOnly: boolean,
): string {
  if (readOnly) {
    // En solo lectura el lector de pantalla no debe invitar a tocar.
    const label = {
      done: 'completada',
      not_done: 'no realizada',
      in_progress: 'en curso',
      pending: 'pendiente',
    }[status]
    return `"${title}" ${label}`
  }
  if (status === 'done') {
    return `"${title}" completada. Tocá para deshacer.`
  }
  if (status === 'not_done') {
    return `"${title}" no realizada. Tocá para deshacer.`
  }
  return `Marcar "${title}" como completada`
}

function getSubtitle({
  status,
  isNext,
  notDoneReason,
  completedAt,
}: {
  status: TaskStatus
  isNext: boolean
  notDoneReason?: string
  completedAt?: DateInput
}): string {
  if (status === 'done') {
    return completedAt ? `Completada ${formatTime(completedAt)}` : 'Completada'
  }
  if (status === 'not_done') {
    return notDoneReason ? `No realizada · ${notDoneReason}` : 'No realizada'
  }
  const label = status === 'in_progress' ? 'En curso' : 'Pendiente'
  return isNext ? `${label} · tocá para marcar` : label
}

export { TaskItem }
export type { TaskItemProps }
