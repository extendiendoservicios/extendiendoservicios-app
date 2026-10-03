import { ArrowLeft } from 'lucide-react'
import { cn } from 'cn'

/**
 * Flecha "Volver" de las cabeceras teal de celular (P17.8): 36 px visibles
 * con un `::after` que lleva el área táctil a 44 px (`07`: >= 44 px). Foco
 * en blanco porque `--ring` (teal translúcido) no se ve sobre el teal.
 */
export function BackButton({
  onClick,
  className,
}: {
  onClick: () => void
  /** Para adaptarlo a otra cabecera (por ejemplo la blanca de administración en compu). */
  className?: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label="Volver"
      className={cn(
        'relative flex size-9 shrink-0 items-center justify-center rounded-full outline-none after:absolute after:-inset-1 hover:bg-white/10 focus-visible:ring-3 focus-visible:ring-white/80',
        className,
      )}
    >
      <ArrowLeft aria-hidden="true" className="size-5" />
    </button>
  )
}
