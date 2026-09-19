import * as React from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from 'cn'
import { Slot } from 'radix-ui'
import { Loader2 } from 'lucide-react'

/**
 * Button (DS-003): variantes y tamaños de `07_Design_System.md` sección 2.1,
 * valores exactos de `Mockup/assets/ds.css` (`.btn`, `.btn-sm`, `.btn-primary`,
 * `.btn-ghost`, `.btn-dark`, `.btn-link`, `.m-btn`).
 *
 * `destructive` no tiene clase propia en el mockup (no aparece ningún
 * `.btn-destructive` en `ds.css`/`ds2.css`): se construye con el mismo
 * patrón sólido + texto blanco que `primary`/`dark`, sobre los tokens
 * `--danger`/`--danger-800` (decisión menor, ver reporte).
 *
 * Radios: `.btn`/`.btn-sm`/`.icon-btn` usan 9px en el mockup → normalizado a
 * `--r-sm` (8, `07` sección 4). `.m-btn` usa `var(--r)` (12) directamente en
 * el mockup, sin normalizar.
 *
 * Los tamaños `icon`/`icon-sm` no son parte de la API pública del design
 * system (no están en la tabla de `07`): son los que ya usan por dentro los
 * componentes de shadcn instalados en DS-002 (`calendar`, `dialog`, `sheet`)
 * para sus botones cuadrados de navegación y cierre. El componente propio
 * para acciones cuadradas de topbar/filas es `IconButton`
 * (`src/components/IconButton.tsx`, 34×34), que usa el tamaño `icon`.
 */
const buttonVariants = cva(
  'group/button inline-flex shrink-0 items-center justify-center gap-[7px] whitespace-nowrap border font-semibold leading-tight transition-colors outline-none select-none focus-visible:ring-3 focus-visible:ring-ring active:not-disabled:translate-y-px disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0',
  {
    variants: {
      variant: {
        primary:
          'border-transparent bg-primary text-white hover:bg-primary-700',
        ghost: 'border-border-strong bg-surface text-text-2 hover:bg-bg',
        dark: 'border-transparent bg-dark text-white hover:bg-dark/90',
        destructive:
          'border-transparent bg-danger text-white hover:bg-danger-800',
        link: 'border-transparent bg-transparent text-primary-800 underline-offset-4 hover:underline',
      },
      size: {
        sm: "h-auto rounded-md px-[11px] py-[5px] text-[11px] [&_svg:not([class*='size-'])]:size-[15px]",
        md: "h-auto rounded-md px-[15px] py-2 text-[12.5px] [&_svg:not([class*='size-'])]:size-[15px]",
        mobile:
          "h-auto w-full rounded-lg px-[15px] py-[15px] text-[15px] [&_svg:not([class*='size-'])]:size-[18px]",
        icon: "size-[34px] rounded-md p-0 [&_svg:not([class*='size-'])]:size-4",
        'icon-sm': "size-7 rounded-md p-0 [&_svg:not([class*='size-'])]:size-4",
      },
    },
    compoundVariants: [
      {
        variant: 'link',
        size: ['sm', 'md', 'mobile'],
        class: 'h-auto w-auto rounded-none p-0 text-xs',
      },
    ],
    defaultVariants: {
      variant: 'primary',
      size: 'md',
    },
  },
)

type ButtonIcon = React.ComponentType<{ className?: string }>

function Button({
  className,
  variant = 'primary',
  size = 'md',
  asChild = false,
  icon: Icon,
  loading = false,
  disabled,
  children,
  ...props
}: React.ComponentProps<'button'> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean
    /** Ícono a la izquierda del texto (`07` sección 2.1). */
    icon?: ButtonIcon
    /** Deshabilita el botón, muestra un spinner y lo informa a lectores de pantalla. */
    loading?: boolean
  }) {
  const Comp = asChild ? Slot.Root : 'button'
  const isDisabled = disabled ?? loading

  return (
    <Comp
      data-slot="button"
      data-variant={variant}
      data-size={size}
      data-loading={loading || undefined}
      className={cn(buttonVariants({ variant, size, className }))}
      disabled={isDisabled}
      aria-busy={loading || undefined}
      {...props}
    >
      {loading ? (
        <Loader2 aria-hidden="true" className="animate-spin" />
      ) : (
        Icon && <Icon aria-hidden="true" />
      )}
      {children}
      {loading && <span className="sr-only">Cargando</span>}
    </Comp>
  )
}

export { Button, buttonVariants }
