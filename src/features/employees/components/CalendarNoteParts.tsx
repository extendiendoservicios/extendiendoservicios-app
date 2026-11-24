import { useState } from 'react'
import { toast } from 'sonner'
import { MoreVertical } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Field, FieldError, FieldLabel } from '@/components/ui/field'
import { Textarea } from '@/components/ui/textarea'
import { isApiError } from '@/api/errors'
import {
  CALENDAR_NOTE_MAX_LENGTH,
  type CalendarNote,
} from '@/api/employeeCalendarNotes'
import { CLIENT_COLORS } from '@/features/planning/clientColors'
import { formatDateOnly } from '@/features/settings/dateOnly'
import { checkNoteBody } from '@/features/employees/calendarNotes'
import {
  useDeleteCalendarNoteMutation,
  useSaveCalendarNoteMutation,
} from '@/features/employees/notesQueries'
import { blockColors } from './blockParts'

/**
 * Observaciones del calendario del mes (P31.3, D-08): la celda de una
 * observación, su menú (editar, cambiar color, eliminar) y el diálogo de alta
 * y edición. El color usa la misma paleta de los clientes y es opcional.
 */

/** Diálogo de alta (`note` nula) y de edición del texto y el color. */
function CalendarNoteDialog({
  profileId,
  date,
  note,
  onClose,
}: {
  profileId: string
  date: string
  note: CalendarNote | null
  onClose: () => void
}) {
  const save = useSaveCalendarNoteMutation(profileId)
  const [body, setBody] = useState(note?.body ?? '')
  const [color, setColor] = useState<number | null>(note?.color ?? null)
  const [error, setError] = useState<string | null>(null)

  async function submit() {
    const check = checkNoteBody(body)
    if (!check.ok) {
      setError(check.message)
      return
    }
    setError(null)
    try {
      await save.mutateAsync({
        noteId: note?.id ?? null,
        employeeId: profileId,
        date,
        body: check.body,
        color,
      })
      toast.success(
        note ? 'Guardamos la observación.' : 'Agregamos la observación.',
      )
      onClose()
    } catch (caught) {
      setError(
        isApiError(caught)
          ? caught.message
          : 'No pudimos guardar la observación.',
      )
    }
  }

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !save.isPending) {
          onClose()
        }
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {note ? 'Editar la observación' : 'Agregar una observación'}
          </DialogTitle>
          <DialogDescription>
            Observación del {formatDateOnly(date)}. Solo la ve la administración
            y sale en la hoja impresa del mes.
          </DialogDescription>
        </DialogHeader>
        <Field data-invalid={Boolean(error) || undefined}>
          <FieldLabel htmlFor="calendar-note-body">Observación</FieldLabel>
          <Textarea
            id="calendar-note-body"
            value={body}
            maxLength={CALENDAR_NOTE_MAX_LENGTH}
            rows={4}
            aria-invalid={Boolean(error)}
            onChange={(event) => setBody(event.target.value)}
          />
          <p className="text-[11.5px] text-text-3">
            {body.length}/{CALENDAR_NOTE_MAX_LENGTH}
          </p>
          {error && <FieldError>{error}</FieldError>}
        </Field>
        <Field>
          <FieldLabel>Color (opcional)</FieldLabel>
          <div
            role="radiogroup"
            aria-label="Color de la observación"
            className="flex flex-wrap gap-2"
          >
            <button
              type="button"
              role="radio"
              aria-checked={color == null}
              className={`rounded-md border px-2 py-1 text-[12px] ${
                color == null
                  ? 'border-primary ring-2 ring-ring'
                  : 'border-border'
              }`}
              onClick={() => setColor(null)}
            >
              Sin color
            </button>
            {CLIENT_COLORS.map((option) => (
              <button
                key={option.index}
                type="button"
                role="radio"
                aria-checked={color === option.index}
                aria-label={option.name}
                title={option.name}
                className={`size-7 rounded-full border-2 ${
                  color === option.index
                    ? 'border-text ring-2 ring-ring'
                    : 'border-transparent'
                }`}
                style={{ backgroundColor: option.hex }}
                onClick={() => setColor(option.index)}
              />
            ))}
          </div>
        </Field>
        <DialogFooter>
          <Button
            type="button"
            variant="ghost"
            disabled={save.isPending}
            onClick={onClose}
          >
            Cancelar
          </Button>
          <Button
            type="button"
            loading={save.isPending}
            onClick={() => void submit()}
          >
            Guardar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/** Confirmación para eliminar una observación. */
function DeleteCalendarNoteDialog({
  profileId,
  note,
  onClose,
}: {
  profileId: string
  note: CalendarNote
  onClose: () => void
}) {
  const remove = useDeleteCalendarNoteMutation(profileId)

  async function confirm() {
    try {
      await remove.mutateAsync(note.id)
      toast.success('Eliminamos la observación.')
      onClose()
    } catch (caught) {
      toast.error(
        isApiError(caught)
          ? caught.message
          : 'No pudimos eliminar la observación.',
      )
    }
  }

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !remove.isPending) {
          onClose()
        }
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Eliminar la observación</DialogTitle>
          <DialogDescription>
            Se elimina la observación del {formatDateOnly(note.date)}: «
            {note.body}». Ya no va a salir en el calendario ni en la hoja
            impresa.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button
            type="button"
            variant="ghost"
            disabled={remove.isPending}
            onClick={onClose}
          >
            Cancelar
          </Button>
          <Button
            type="button"
            variant="destructive"
            loading={remove.isPending}
            onClick={() => void confirm()}
          >
            Eliminar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/** Una observación en la celda del día, con su menú ⋮ (editar, cambiar color, eliminar). */
function CalendarNoteCell({
  profileId,
  note,
  onEdit,
  onDelete,
}: {
  profileId: string
  note: CalendarNote
  onEdit: (note: CalendarNote) => void
  onDelete: (note: CalendarNote) => void
}) {
  const save = useSaveCalendarNoteMutation(profileId)

  async function changeColor(color: number | null) {
    try {
      await save.mutateAsync({
        noteId: note.id,
        employeeId: profileId,
        date: note.date,
        body: note.body,
        color,
      })
      toast.success('Cambiamos el color de la observación.')
    } catch (caught) {
      toast.error(
        isApiError(caught)
          ? caught.message
          : 'No pudimos cambiar el color de la observación.',
      )
    }
  }

  return (
    <div
      data-testid="observacion"
      data-note-id={note.id}
      className="print-keep-together flex items-start rounded-sm border select-none"
      style={blockColors(note.color)}
    >
      <p
        title={note.body}
        className="min-w-0 flex-1 px-0.5 text-[10px] leading-[14px] whitespace-pre-wrap [overflow-wrap:anywhere]"
      >
        {note.body}
      </p>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            aria-label={`Opciones de la observación: ${note.body.slice(0, 40)}`}
            className="rounded p-0.5 hover:bg-black/10 max-md:min-h-6 max-md:min-w-6 print:hidden"
            disabled={save.isPending}
          >
            <MoreVertical className="size-3" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onSelect={() => onEdit(note)}>
            Editar
          </DropdownMenuItem>
          <DropdownMenuSub>
            <DropdownMenuSubTrigger>Cambiar color</DropdownMenuSubTrigger>
            <DropdownMenuSubContent>
              <DropdownMenuItem
                disabled={note.color == null}
                onSelect={() => void changeColor(null)}
              >
                Sin color
              </DropdownMenuItem>
              {CLIENT_COLORS.map((option) => (
                <DropdownMenuItem
                  key={option.index}
                  disabled={option.index === note.color}
                  onSelect={() => void changeColor(option.index)}
                >
                  <span
                    aria-hidden
                    className="inline-block size-3 rounded-full"
                    style={{ backgroundColor: option.hex }}
                  />
                  {option.name}
                </DropdownMenuItem>
              ))}
            </DropdownMenuSubContent>
          </DropdownMenuSub>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            variant="destructive"
            onSelect={() => onDelete(note)}
          >
            Eliminar
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}

export { CalendarNoteCell, CalendarNoteDialog, DeleteCalendarNoteDialog }
