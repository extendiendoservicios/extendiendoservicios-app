import type { ComponentProps } from 'react'
import { IconButton } from '@/components/IconButton'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'

type AgendaIconButtonProps = ComponentProps<typeof IconButton>

/**
 * Botón de solo ícono de la Agenda: lleva `aria-label` (obligatorio) y el mismo
 * texto como tooltip. Tamaño chico para que las filas queden lo más bajas posible.
 */
function AgendaIconButton({ className, ...props }: AgendaIconButtonProps) {
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <IconButton className={className ?? 'size-8'} {...props} />
        </TooltipTrigger>
        <TooltipContent>{props['aria-label']}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}

export { AgendaIconButton }
