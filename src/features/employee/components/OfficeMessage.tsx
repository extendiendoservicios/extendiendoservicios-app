import { useState } from 'react'
import { MessageSquare } from 'lucide-react'
import { cn } from 'cn'

/** Desde cuántos caracteres o renglones se ofrece «Ver más» en la versión resumida. */
const LONG_TEXT_CHARS = 90
const LONG_TEXT_LINES = 3

/**
 * P29 OG-05 · «Mensaje de la oficina»: la observación del turno que cargó la
 * administración. Fondo y borde del token informativo, con ícono de mensaje,
 * para que no se confunda con «Tu observación» (la propia del empleado).
 * Respeta los saltos de línea. Con `clamp` (tarjetas de Hoy y de la lista del
 * coordinador) muestra hasta 2 líneas y «Ver más»; sin `clamp` (detalles) va
 * completo.
 */
export function OfficeMessage({
  text,
  clamp = false,
  className,
}: {
  text: string | null
  clamp?: boolean
  className?: string
}) {
  const [expanded, setExpanded] = useState(false)
  if (!text) return null
  const isLong =
    text.length > LONG_TEXT_CHARS || text.split('\n').length >= LONG_TEXT_LINES
  const collapsed = clamp && !expanded
  return (
    <div
      data-testid="office-message"
      className={cn(
        'flex flex-col gap-1 rounded-lg border border-primary-200 bg-primary-50 px-3 py-2',
        className,
      )}
    >
      <p className="flex items-center gap-[6px] text-[11.5px] font-semibold text-primary-800">
        <MessageSquare aria-hidden="true" className="size-[14px] shrink-0" />
        Mensaje de la oficina
      </p>
      <p
        className={cn(
          'text-[13px] break-words whitespace-pre-line text-text-2',
          collapsed && 'line-clamp-2',
        )}
      >
        {text}
      </p>
      {clamp && isLong && (
        <button
          type="button"
          onClick={(event) => {
            // La tarjeta es un enlace: «Ver más» no tiene que abrir el detalle.
            event.preventDefault()
            event.stopPropagation()
            setExpanded((value) => !value)
          }}
          className="flex min-h-11 items-center self-start text-[12.5px] font-semibold text-primary-800 underline"
        >
          {expanded ? 'Ver menos' : 'Ver más'}
        </button>
      )}
    </div>
  )
}
