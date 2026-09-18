import * as React from 'react'
import { cn } from 'cn'

/**
 * Input (DS-004): medidas exactas de `07_Design_System.md` sección 2.2
 * (`.input`/`.m-input` de `Mockup/assets/ds2.css`).
 *
 * - Radio 8 (`--r-sm`) en las dos variantes: `07` sección 2.2 dice "radio 10"
 *   para la variante móvil, pero la sección 4 (normalización) lista
 *   explícitamente los inputs entre los elementos cuyos radios sueltos
 *   (7/9/10) se llevan a 8/12/14. Se resolvió a favor de la normalización
 *   (decisión menor, ver reporte).
 * - Tamaño de fuente: `ds2.css` trae 12.5px (escritorio) y 13.5px (móvil),
 *   ninguno de los dos escrito en `07` con un valor entero; se aplica la
 *   regla de la sección 4 ("12.5 → 13 en formularios") a los dos casos:
 *   13px escritorio, 14px móvil.
 * - Ícono a la izquierda opcional (prop `icon`) y estado de error (prop
 *   `error`, borde `--danger` y mensaje de 11 px debajo).
 */
function Input({
  className,
  type,
  icon: Icon,
  error,
  mobile = false,
  id,
  'aria-describedby': ariaDescribedBy,
  ...props
}: React.ComponentProps<'input'> & {
  icon?: React.ComponentType<{ className?: string }>
  /** Mensaje de error: pinta el borde de `--danger` y lo muestra debajo. */
  error?: string
  /** Variante móvil: 12 × 13 px de relleno y 14 px de fuente. */
  mobile?: boolean
}) {
  const generatedId = React.useId()
  const inputId = id ?? generatedId
  const errorId = error ? `${inputId}-error` : undefined

  return (
    <div className="w-full">
      <div className="relative flex items-center">
        {Icon && (
          <Icon
            aria-hidden="true"
            className="pointer-events-none absolute left-3 size-[15px] text-text-3"
          />
        )}
        <input
          id={inputId}
          type={type}
          data-slot="input"
          aria-invalid={Boolean(error)}
          aria-describedby={cn(ariaDescribedBy, errorId) || undefined}
          className={cn(
            'h-auto w-full min-w-0 rounded-md border border-border-strong bg-surface text-text outline-none transition-colors placeholder:text-text-3 focus-visible:border-primary focus-visible:ring-3 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-danger',
            mobile ? 'px-[13px] py-3 text-[14px]' : 'px-3 py-[9px] text-[13px]',
            Icon && (mobile ? 'pl-9' : 'pl-8'),
            className,
          )}
          {...props}
        />
      </div>
      {error && (
        <p id={errorId} className="mt-[5px] text-[11px] text-danger">
          {error}
        </p>
      )}
    </div>
  )
}

export { Input }
