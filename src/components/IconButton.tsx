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
 *
 * Objetivo táctil (`07`: ≥ 44 px en móvil): por debajo de 768 px un `::after`
 * transparente agranda el área de toque a 44×44 sin cambiar cómo se ve (el
 * botón tiene un borde de 1 px, así que el `::after`, que parte del borde
 * interno de 32 px, necesita 6 px por lado). Con mouse, en `md` o más, mide
 * 34 px como en el mockup.
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
      className={cn(
        'relative max-md:after:absolute max-md:after:-inset-[6px]',
        className,
      )}
      {...props}
    >
      <Icon />
    </Button>
  )
}

export { IconButton }
