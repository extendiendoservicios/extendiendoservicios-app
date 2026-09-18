import * as React from 'react'
import { cn } from 'cn'

/**
 * TimeInput (DS-005): `07` sección 2.2 admite "dos campos o `input
 * type='time'` nativo en móvil". Se usa el control nativo en las dos
 * variantes (decisión menor): es accesible por teclado y con lector de
 * pantalla sin trabajo extra, y evita mantener dos implementaciones de un
 * mismo campo.
 */
function TimeInput({
  className,
  mobile = false,
  error,
  id,
  'aria-describedby': ariaDescribedBy,
  ...props
}: React.ComponentProps<'input'> & {
  mobile?: boolean
  error?: string
}) {
  const generatedId = React.useId()
  const inputId = id ?? generatedId
  const errorId = error ? `${inputId}-error` : undefined

  return (
    <div className="w-full">
      <input
        id={inputId}
        type="time"
        data-slot="time-input"
        aria-invalid={Boolean(error)}
        aria-describedby={cn(ariaDescribedBy, errorId) || undefined}
        className={cn(
          'h-auto w-full min-w-0 rounded-md border border-border-strong bg-surface text-text tabular-nums outline-none transition-colors placeholder:text-text-3 focus-visible:border-primary focus-visible:ring-3 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-danger',
          mobile ? 'px-[13px] py-3 text-[14px]' : 'px-3 py-[9px] text-[13px]',
          className,
        )}
        {...props}
      />
      {error && (
        <p id={errorId} className="mt-[5px] text-[11px] text-danger">
          {error}
        </p>
      )}
    </div>
  )
}

export { TimeInput }
