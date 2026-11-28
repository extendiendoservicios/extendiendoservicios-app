import { useState } from 'react'
import { Plus } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { AGENDA_TEXT_MAX_LENGTH, type AgendaItem } from '@/api/agenda'
import { isApiError } from '@/api/errors'
import { agendaBlockStyle } from '../agendaColors'
import { notesOf } from '../agendaMonth'
import { useSaveAgendaItemMutation } from '../queries'
import { AgendaColorPicker } from './AgendaColorPicker'
import {
  AgendaDeleteIconButton,
  AgendaDuplicateIconButton,
  AgendaResolvedIconButton,
} from './AgendaItemActions'

interface AgendaNotesProps {
  items: AgendaItem[]
  /** Primer día del mes (`YYYY-MM-01`). */
  month: string
}

function useSaveNote(month: string) {
  const save = useSaveAgendaItemMutation()
  return {
    pending: save.isPending,
    saveNote: (input: {
      id: string | null
      body: string
      borderColor: number | null
      fillColor: number | null
      onDone?: () => void
    }) => {
      save.mutate(
        {
          id: input.id,
          kind: 'nota',
          month,
          fields: { body: input.body },
          borderColor: input.borderColor,
          fillColor: input.fillColor,
        },
        {
          onSuccess: () => input.onDone?.(),
          onError: (error) =>
            toast.error(
              isApiError(error) ? error.message : 'No pudimos guardar la nota.',
            ),
        },
      )
    },
  }
}

/** Un renglón con viñeta, check y texto editable en el mismo lugar (AG-10). */
function NoteRow({ item, month }: { item: AgendaItem; month: string }) {
  const [text, setText] = useState(item.body ?? '')
  const [syncedBody, setSyncedBody] = useState(item.body)
  const { saveNote } = useSaveNote(month)

  // Si otra persona cambia la nota, se refleja acá (ajuste durante el render).
  if (item.body !== syncedBody) {
    setSyncedBody(item.body)
    setText(item.body ?? '')
  }

  function commitText() {
    const next = text.trim()
    if (next === (item.body ?? '')) {
      return
    }
    if (next === '') {
      toast.error('La nota no puede quedar vacía. Para sacarla, eliminala.')
      setText(item.body ?? '')
      return
    }
    saveNote({
      id: item.id,
      body: next,
      borderColor: item.borderColor,
      fillColor: item.fillColor,
    })
  }

  return (
    <li
      className="flex flex-col gap-1 rounded-md border border-border bg-surface p-1.5"
      style={agendaBlockStyle(item.borderColor, item.fillColor)}
      data-testid="agenda-note"
    >
      <div className="flex items-start gap-2">
        <span aria-hidden="true" className="pt-1.5 text-[14px] leading-none">
          •
        </span>
        <Input
          aria-label="Texto de la nota"
          value={text}
          maxLength={AGENDA_TEXT_MAX_LENGTH}
          onChange={(event) => setText(event.target.value)}
          onBlur={commitText}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.currentTarget.blur()
            }
          }}
          className="bg-surface text-text"
        />
      </div>
      <div className="flex items-center gap-1 rounded-sm bg-surface/90 px-1 text-text">
        <AgendaResolvedIconButton item={item} />
        <AgendaColorPicker
          iconOnly
          value={{ border: item.borderColor, fill: item.fillColor }}
          onChange={(next) =>
            saveNote({
              id: item.id,
              body: item.body ?? '',
              borderColor: next.border,
              fillColor: next.fill,
            })
          }
        />
        <AgendaDuplicateIconButton item={item} />
        <AgendaDeleteIconButton item={item} />
      </div>
    </li>
  )
}

/** Renglón nuevo: Enter o salir del campo con texto lo agrega. */
function NewNoteRow({
  month,
  onClose,
}: {
  month: string
  onClose: () => void
}) {
  const [text, setText] = useState('')
  const { saveNote, pending } = useSaveNote(month)

  function commit() {
    const body = text.trim()
    if (body === '') {
      onClose()
      return
    }
    saveNote({
      id: null,
      body,
      borderColor: null,
      fillColor: null,
      onDone: onClose,
    })
  }

  return (
    <li className="flex items-start gap-2 rounded-md border border-border-strong bg-surface p-2">
      <span aria-hidden="true" className="pt-1.5 text-[14px] leading-none">
        •
      </span>
      <Input
        ref={(element) => element?.focus()}
        aria-label="Nota nueva"
        placeholder="Escribí la nota y apretá Enter"
        value={text}
        disabled={pending}
        maxLength={AGENDA_TEXT_MAX_LENGTH}
        onChange={(event) => setText(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.currentTarget.blur()
          } else if (event.key === 'Escape') {
            setText('')
            onClose()
          }
        }}
      />
    </li>
  )
}

/**
 * «Notas» (AG-10): renglones con viñeta y check, con «Agregar». La edición es
 * en el mismo renglón.
 */
function AgendaNotes({ items, month }: AgendaNotesProps) {
  const notes = notesOf(items)
  const [adding, setAdding] = useState(false)

  return (
    <section
      aria-label="Notas"
      className="flex flex-col gap-2 rounded-lg border border-border bg-surface p-3"
    >
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-[14px] font-semibold text-text">Notas</h2>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          icon={Plus}
          onClick={() => setAdding(true)}
        >
          Agregar
        </Button>
      </div>
      {notes.length === 0 && !adding && (
        <p className="text-[12.5px] text-text-3">Todavía no hay notas.</p>
      )}
      <ul className="flex flex-col gap-2">
        {notes.map((note) => (
          <NoteRow key={note.id} item={note} month={month} />
        ))}
        {adding && (
          <NewNoteRow month={month} onClose={() => setAdding(false)} />
        )}
      </ul>
    </section>
  )
}

export { AgendaNotes }
