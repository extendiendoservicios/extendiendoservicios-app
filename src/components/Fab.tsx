import * as React from 'react'
import { cn } from 'cn'
import { Fingerprint } from 'lucide-react'

/**
 * FAB "Fichar" (DS-003): círculo de 46 px teal con sombra teal, pensado para
 * elevarse −14 px sobre la tabbar del empleado (`07` sección 2.1, `.m-tab.fab
 * .ring` de `Mockup/assets/ds.css` y `M02.png`). El shell que lo ubica en la
 * tabbar (`AdminShell`/`MobileShell`) llega en P05.4: este componente es solo
 * el círculo, con el desplazamiento hacia arriba ya incorporado en su propio
 * margen, para que el shell lo posicione sin recalcular el offset.
 *
 * El ícono de huella (`Fingerprint`) no está en la lista de `07` sección 1.4
 * (mapeo de íconos del mockup): se agregó porque es el que mejor representa
 * "fichar" y ya viene con lucide-react (sin sumar ninguna librería nueva).
 * Es reemplazable con la prop `icon` si se decide otro.
 */
function Fab({
  icon: Icon = Fingerprint,
  className,
  'aria-label': ariaLabel = 'Fichar',
  ...props
}: Omit<React.ComponentProps<'button'>, 'children'> & {
  icon?: React.ComponentType<{ className?: string }>
}) {
  return (
    <button
      type="button"
      data-slot="fab"
      aria-label={ariaLabel}
      className={cn(
        '-mt-[14px] inline-flex size-[46px] shrink-0 items-center justify-center rounded-full border-none bg-primary text-white shadow-fab outline-none transition-colors select-none hover:bg-primary-700 focus-visible:ring-3 focus-visible:ring-ring active:not-disabled:translate-y-px disabled:pointer-events-none disabled:opacity-50',
        className,
      )}
      {...props}
    >
      <Icon aria-hidden="true" className="size-[22px]" />
    </button>
  )
}

export { Fab }
