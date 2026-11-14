import type { ComponentProps, ReactNode } from 'react'
import { Link } from 'react-router'
import { Button } from '@/components/ui/button'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'

/** OG-11: explicación de por qué un botón de Insumos está deshabilitado. */
export const STOCK_PERMISSION_HINT =
  'Necesitás el permiso «Gestionar stock». Pedíselo a la dirección.'

type ButtonProps = ComponentProps<typeof Button>

interface StockActionButtonProps {
  /** `canManageStock(auth)`: si es `false`, el botón se muestra deshabilitado. */
  allowed: boolean
  /** Si viene, con permiso es un enlace; sin permiso, un botón deshabilitado. */
  to?: string
  onClick?: () => void
  icon?: ButtonProps['icon']
  variant?: ButtonProps['variant']
  size?: ButtonProps['size']
  loading?: boolean
  'aria-label'?: string
  children: ReactNode
}

/**
 * OG-11 (P29.4): acción de Insumos que exige `manage_stock`. En vez de
 * ocultarla o dejar que falle, a quien no tiene el permiso se la muestra
 * deshabilitada con la explicación en un tooltip (escritorio). En el celular,
 * donde no hay tooltip, el texto está siempre visible en `StockPermissionNotice`.
 * El servidor vuelve a verificar.
 */
function StockActionButton({
  allowed,
  to,
  onClick,
  icon,
  variant,
  size,
  loading,
  'aria-label': ariaLabel,
  children,
}: StockActionButtonProps) {
  if (allowed) {
    if (to) {
      return (
        <Button asChild variant={variant} size={size} icon={icon}>
          <Link to={to} aria-label={ariaLabel}>
            {children}
          </Link>
        </Button>
      )
    }
    return (
      <Button
        variant={variant}
        size={size}
        icon={icon}
        loading={loading}
        onClick={onClick}
        aria-label={ariaLabel}
      >
        {children}
      </Button>
    )
  }
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          {/* El botón deshabilitado no recibe el foco ni el puntero: el tooltip cuelga del contenedor. */}
          {/* eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- necesario para que el teclado llegue al tooltip */}
          <span tabIndex={0} className="inline-flex">
            <Button
              variant={variant}
              size={size}
              icon={icon}
              disabled
              aria-label={ariaLabel}
              title={STOCK_PERMISSION_HINT}
            >
              {children}
            </Button>
          </span>
        </TooltipTrigger>
        <TooltipContent>{STOCK_PERMISSION_HINT}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}

/** Texto visible (también en el celular) cuando faltan permisos. */
function StockPermissionNotice({ className }: { className?: string }) {
  return (
    <p
      role="note"
      className={
        className ??
        'mb-3 rounded-md border bg-muted px-3 py-2 text-sm text-muted-foreground'
      }
    >
      {STOCK_PERMISSION_HINT}
    </p>
  )
}

export { StockActionButton, StockPermissionNotice }
