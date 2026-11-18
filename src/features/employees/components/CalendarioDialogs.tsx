import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { TimeInput } from '@/components/TimeInput'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import type { ShiftListRow } from '@/api/shifts'
import { formatShiftRange } from '@/features/shifts/openEnded'
import { formatDateOnly } from '@/features/settings/dateOnly'
import {
  minutesToTime,
  previewLabel,
  targetShiftCandidates,
  timeToMinutes,
  type ScheduleChange,
  type WeekBlock,
} from '@/features/employees/cronogramaWeek'

export const SAME_SHIFT = '__mismo__'
/** OF-23: «Crear un turno nuevo y pasar a la persona». */
export const NEW_SHIFT = '__nuevo__'

/** Cambio de horario pendiente de que se elija «para todos» o «solo esta persona». */
export interface PendingChange {
  block: WeekBlock
  next: ScheduleChange
  /** Solo cambió el horario (una hora editada): no hay otro turno al que pasar. */
  resizeOnly: boolean
}

/** Texto de la opción que crea el turno destino (OF-23). */
export function newShiftOptionLabel(
  siteName: string,
  date: string,
  startMin: number,
  endMin: number,
  personName: string,
): string {
  return `Crear un turno nuevo en ${siteName} el ${formatDateOnly(date)} de ${minutesToTime(startMin)} a ${minutesToTime(endMin)} y pasar a ${personName}`
}

function ScopeDialog({
  pending,
  personName,
  shifts,
  busy,
  onClose,
  onAll,
  onOnlyPerson,
}: {
  pending: PendingChange
  personName: string
  shifts: ShiftListRow[]
  busy: boolean
  onClose: () => void
  onAll: () => void
  onOnlyPerson: (targetShiftId: string) => void
}) {
  const { block, next, resizeOnly } = pending
  const sameDay = next.date === block.date
  const candidates = resizeOnly
    ? []
    : targetShiftCandidates(shifts, block.siteId, next.date, block.shiftId)
  const options = [
    ...(sameDay
      ? [{ value: SAME_SHIFT, label: 'Mismo turno, con horario propio' }]
      : []),
    ...candidates.map((shift) => ({
      value: shift.id,
      label: `Turno de ${formatShiftRange(shift.startTime, shift.endTime, shift.openEnded)}`,
    })),
    // OF-23: siempre se puede crear el turno destino (no hay otro ese día, o como opción más).
    {
      value: NEW_SHIFT,
      label: newShiftOptionLabel(
        block.siteName,
        next.date,
        next.startMin,
        next.endMin,
        personName,
      ),
    },
  ]
  const [target, setTarget] = useState(options[0]?.value ?? '')

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            ¿Mover el turno para todos o pasar solo a {personName} a otro
            horario?
          </DialogTitle>
          <DialogDescription>
            El turno tiene {block.assignedCount} personas asignadas. Nuevo
            horario: {formatDateOnly(next.date)}{' '}
            {previewLabel(next, block.openEnded)}.
          </DialogDescription>
        </DialogHeader>
        <div className="flex min-w-0 flex-col gap-1.5">
          <Label htmlFor="destino-solo">Si pasás solo a {personName}</Label>
          <Select value={target} onValueChange={setTarget}>
            <SelectTrigger
              id="destino-solo"
              className="w-full min-w-0 whitespace-normal text-left *:data-[slot=select-value]:line-clamp-2"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {options.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Cancelar
          </Button>
          <Button variant="dark" onClick={onAll} disabled={busy}>
            Mover para todos
          </Button>
          <Button
            onClick={() => onOnlyPerson(target)}
            disabled={busy || !target}
          >
            Solo a {personName}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/** Vía accesible sin arrastre: elegir día y horario en un diálogo. */
function MoveDialog({
  block,
  days,
  onClose,
  onConfirm,
}: {
  block: WeekBlock
  days: string[]
  onClose: () => void
  onConfirm: (next: ScheduleChange) => void
}) {
  const [date, setDate] = useState(block.date)
  const [start, setStart] = useState(minutesToTime(block.startMin))
  const [end, setEnd] = useState(minutesToTime(block.endMin))
  const valid =
    start !== '' && end !== '' && timeToMinutes(end) > timeToMinutes(start)

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Mover o cambiar horario</DialogTitle>
          <DialogDescription>
            {block.siteName}. Elegí el día y el horario nuevos.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="mover-dia">Día</Label>
            <Select value={date} onValueChange={setDate}>
              <SelectTrigger id="mover-dia">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {days.map((day) => (
                  <SelectItem key={day} value={day}>
                    {formatDateOnly(day)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="mover-inicio">Desde</Label>
              <TimeInput
                id="mover-inicio"
                step={900}
                value={start}
                onChange={(event) => setStart(event.target.value)}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="mover-fin">Hasta</Label>
              <TimeInput
                id="mover-fin"
                step={900}
                value={end}
                disabled={block.openEnded}
                onChange={(event) => setEnd(event.target.value)}
              />
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <Button
            disabled={!valid}
            onClick={() =>
              onConfirm({
                date,
                startMin: timeToMinutes(start),
                endMin: block.openEnded
                  ? timeToMinutes(start) + (block.endMin - block.startMin)
                  : timeToMinutes(end),
              })
            }
          >
            Mover
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export { MoveDialog, ScopeDialog }
