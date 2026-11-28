import { useState } from 'react'
import { Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import type { AgendaItem } from '@/api/agenda'
import { formatDateOnly } from '@/features/settings/dateOnly'
import type { AgendaSuggestions } from '../useAgendaSuggestions'
import { AgendaEventEditor } from './AgendaEventEditor'
import { AgendaEventReadCard } from './AgendaEventReadCard'

interface AgendaDayDialogProps {
  /** Día abierto (`YYYY-MM-DD`) o `null` si está cerrado. */
  date: string | null
  /** Eventos de ese día. */
  events: AgendaItem[]
  holidayName?: string | null
  suggestions: AgendaSuggestions
  onOpenChange: (open: boolean) => void
}

/**
 * Popup de un día (AG-04): los eventos del día, cada uno en lectura (con
 * menú ⋮ y edición en formulario), con «Agregar evento». En celular ocupa casi toda la pantalla.
 */
function AgendaDayDialog({
  date,
  events,
  holidayName,
  suggestions,
  onOpenChange,
}: AgendaDayDialogProps) {
  return (
    <Dialog open={date !== null} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl">
        {date && (
          <AgendaDayContent
            key={date}
            date={date}
            events={events}
            holidayName={holidayName}
            suggestions={suggestions}
          />
        )}
      </DialogContent>
    </Dialog>
  )
}

function AgendaDayContent({
  date,
  events,
  holidayName,
  suggestions,
}: {
  date: string
  events: AgendaItem[]
  holidayName?: string | null
  suggestions: AgendaSuggestions
}) {
  // Sin eventos, el formulario de alta ya viene abierto. Si no, los eventos se
  // ven en lectura y solo uno a la vez pasa al formulario (AG-30).
  const [editing, setEditing] = useState<string | null>(
    events.length === 0 ? 'new' : null,
  )

  return (
    <>
      <DialogHeader>
        <DialogTitle className="capitalize">{formatDateOnly(date)}</DialogTitle>
        <DialogDescription>
          {holidayName ? `Feriado: ${holidayName}. ` : ''}
          {events.length === 0
            ? 'No hay eventos este día.'
            : `${events.length} ${events.length === 1 ? 'evento' : 'eventos'}.`}
        </DialogDescription>
      </DialogHeader>
      <div className="flex flex-col gap-3">
        {events.length === 0 && editing !== 'new' && (
          <p className="text-[13px] text-text-3">No hay eventos este día</p>
        )}
        {events.map((event) =>
          editing === event.id ? (
            <AgendaEventEditor
              key={event.id}
              item={event}
              defaultDay={date}
              suggestions={suggestions}
              onSaved={() => setEditing(null)}
              onCancelEdit={() => setEditing(null)}
            />
          ) : (
            <AgendaEventReadCard
              key={event.id}
              item={event}
              onEdit={() => setEditing(event.id)}
            />
          ),
        )}
        {editing === 'new' ? (
          <AgendaEventEditor
            item={null}
            defaultDay={date}
            suggestions={suggestions}
            onSaved={() => setEditing(null)}
            onCancelNew={() => setEditing(null)}
          />
        ) : (
          <Button
            type="button"
            variant="ghost"
            icon={Plus}
            className="self-start"
            onClick={() => setEditing('new')}
          >
            Agregar evento
          </Button>
        )}
      </div>
    </>
  )
}

export { AgendaDayDialog }
