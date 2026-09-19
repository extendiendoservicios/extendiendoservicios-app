import * as React from 'react'
import { cn } from 'cn'
import { Button } from '@/components/ui/button'

/**
 * IconButton (DS-003): botón cuadrado de 34×34 sobre `Button`, para acciones
 * secundarias de topbar y filas (`07` sección 2.1, `.icon-btn` de
 * `Mockup/assets/ds.css`).
 *
 * Sin texto visible: `aria-label` es obligatorio (accesibilidad, `07`
 * sección 5). El ícono se pasa como componente (no como `children`) para
 * mantener la misma forma que `Button`.
 */
function IconButton({
  icon: Icon,
  className,
  variant = 'ghost',
  'aria-label': ariaLabel,
  ...props
}: Omit<React.ComponentProps<typeof Button>, 'size' | 'icon' | 'children'> & {
  icon: React.ComponentType<{ className?: string }>
  'aria-label': string
}) {
  return (
    <Button
      variant={variant}
      size="icon"
      aria-label={ariaLabel}
      className={cn(className)}
      {...props}
    >
      <Icon />
    </Button>
  )
}

export { IconButton }
