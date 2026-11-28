import { useState } from 'react'
import {
  CalendarPlus,
  CircleCheck,
  MoreVertical,
  Palette,
  Pencil,
  Trash2,
} from 'lucide-react'
import { toast } from 'sonner'
import { IconButton } from '@/components/IconButton'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { isApiError } from '@/api/errors'
import type { AgendaItem } from '@/api/agenda'
import { agendaBlockStyle } from '../agendaColors'
import { useSaveAgendaItemMutation } from '../queries'
import { eventItemToValues, eventValuesToFields } from '../schemas'
import { AgendaColorDialog } from './AgendaColorPicker'
import { AgendaDeleteDialog, useAgendaItemActions } from './AgendaItemActions'

/** Los datos de un evento en el orden del boceto, solo los que tienen valor. */
export function eventReadRows(item: AgendaItem): [string, string][] {
  const rows: [string, string | null][] = [
    ['Trabajo', item.workType],
    ['Hora', item.timeText],
    ['Lugar', item.place],
    ['Cliente/Persona', item.clientPerson],
    ['Personas', item.people],
    ['Observación', item.observation],
  ]
  return rows.filter((row): row is [string, string] => Boolean(row[1]?.trim()))
}

/**
 * Un evento del día en modo lectura (AG-30): bloque con su borde y relleno, los
 * datos como texto y un menú ⋮ con Editar, Resuelto, Colores, Duplicar y
 * Eliminar.
 */
function AgendaEventReadCard({
  item,
  onEdit,
}: {
  item: AgendaItem
  onEdit: () => void
}) {
  const [colorOpen, setColorOpen] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const { toggleResolved, duplicate } = useAgendaItemActions(item)
  const save = useSaveAgendaItemMutation()
  const rows = eventReadRows(item)

  function changeColor(next: { border: number | null; fill: number | null }) {
    const values = eventItemToValues(item)
    save.mutate(
      {
        id: item.id,
        kind: 'evento',
        month: item.month,
        day: item.day ?? undefined,
        fields: eventValuesToFields(values),
        borderColor: next.border,
        fillColor: next.fill,
      },
      {
        onError: (error) =>
          toast.error(
            isApiError(error)
              ? error.message
              : 'No pudimos guardar los colores.',
          ),
      },
    )
  }

  return (
    <article
      aria-label="Evento"
      data-testid="agenda-event-read"
      className="relative rounded-lg border border-border bg-surface py-2 pr-10 pl-3 text-[13px] leading-snug text-text"
      style={agendaBlockStyle(item.borderColor, item.fillColor)}
    >
      <div className="absolute top-1 right-1">
        <DropdownMenu>
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <DropdownMenuTrigger asChild>
                  <IconButton
                    icon={MoreVertical}
                    aria-label="Opciones del evento"
                    className="size-8"
                  />
                </DropdownMenuTrigger>
              </TooltipTrigger>
              <TooltipContent>Opciones del evento</TooltipContent>
            </Tooltip>
          </TooltipProvider>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onSelect={onEdit}>
              <Pencil />
              Editar
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={toggleResolved}>
              <CircleCheck />
              {item.resolved ? 'Quitar resuelto' : 'Marcar como resuelto'}
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => setColorOpen(true)}>
              <Palette />
              Colores…
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={duplicate}>
              <CalendarPlus />
              Duplicar al mes siguiente
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              variant="destructive"
              onSelect={() => setDeleteOpen(true)}
            >
              <Trash2 />
              Eliminar
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      <div className="flex flex-col gap-0.5">
        {rows.length === 0 && <p className="text-text-3">Evento sin datos.</p>}
        {rows.map(([label, value]) => (
          <p key={label}>
            <span className="font-semibold">{label}:</span> {value}
          </p>
        ))}
        {item.resolved && (
          <p className="mt-0.5 flex items-center gap-1 text-[12px] font-semibold text-success-800">
            <CircleCheck aria-hidden="true" className="size-3.5" />
            Resuelto
          </p>
        )}
      </div>
      <AgendaColorDialog
        open={colorOpen}
        onOpenChange={setColorOpen}
        value={{ border: item.borderColor, fill: item.fillColor }}
        onChange={changeColor}
      />
      <AgendaDeleteDialog
        item={item}
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
      />
    </article>
  )
}

export { AgendaEventReadCard }
