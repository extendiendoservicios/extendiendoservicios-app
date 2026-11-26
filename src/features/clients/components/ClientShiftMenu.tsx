import { MoreVertical } from 'lucide-react'
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
import type { ClientCalendarBlock } from '@/features/clients/clientCalendar'
import {
  ClientColorSubmenu,
  type ClientColorRequest,
} from '@/features/planning/components/ClientColorChange'

/**
 * Menú ⋮ de un turno del calendario del cliente (P34.2, D-10): abrir el turno,
 * mover o cambiar horario (turno entero), asignar, quitar a una persona, color
 * del cliente y, solo la dirección, eliminar el turno.
 */
function ClientShiftMenu({
  block,
  clientId,
  clientName,
  canDelete,
  disabled = false,
  onOpen,
  onMove,
  onAssign,
  onRemove,
  onColorRequest,
  onDelete,
}: {
  block: ClientCalendarBlock
  clientId: string
  clientName: string
  /** Solo la dirección borra turnos (`canOwnerDelete`). */
  canDelete: boolean
  disabled?: boolean
  onOpen: (block: ClientCalendarBlock) => void
  onMove: (block: ClientCalendarBlock) => void
  onAssign: (block: ClientCalendarBlock) => void
  onRemove: (
    block: ClientCalendarBlock,
    person: ClientCalendarBlock['people'][number],
  ) => void
  onColorRequest: (request: ClientColorRequest) => void
  onDelete: (block: ClientCalendarBlock) => void
}) {
  const open = !block.cancelled
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={`Opciones del turno de ${block.siteName}`}
          className="rounded p-0.5 hover:bg-black/10 max-md:min-h-6 max-md:min-w-6"
          disabled={disabled}
        >
          <MoreVertical className="size-3" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onSelect={() => onOpen(block)}>
          Abrir el turno
        </DropdownMenuItem>
        {open && (
          <DropdownMenuItem onSelect={() => onMove(block)}>
            Mover o cambiar horario…
          </DropdownMenuItem>
        )}
        {open && !block.completed && (
          <DropdownMenuItem onSelect={() => onAssign(block)}>
            Asignar empleado…
          </DropdownMenuItem>
        )}
        {open && block.people.length > 0 && (
          <DropdownMenuSub>
            <DropdownMenuSubTrigger>Quitar a…</DropdownMenuSubTrigger>
            <DropdownMenuSubContent>
              {block.people.map((person) => (
                <DropdownMenuItem
                  key={person.assignmentId}
                  onSelect={() => onRemove(block, person)}
                >
                  {person.shortName}
                </DropdownMenuItem>
              ))}
            </DropdownMenuSubContent>
          </DropdownMenuSub>
        )}
        <ClientColorSubmenu
          clientId={clientId}
          clientName={clientName}
          currentIndex={block.colorIndex}
          onRequest={onColorRequest}
        />
        {canDelete && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              variant="destructive"
              onSelect={() => onDelete(block)}
            >
              Eliminar turno
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

export { ClientShiftMenu }
