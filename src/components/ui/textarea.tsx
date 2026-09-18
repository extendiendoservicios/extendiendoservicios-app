import * as React from 'react'
import { cn } from 'cn'

/**
 * Textarea (DS-004): mismas medidas y mismas normalizaciones que `Input`
 * (ver ese archivo para el detalle de radios y tamaños de fuente),
 * `.input.area`/`.m-input.area` de `Mockup/assets/ds2.css` (altura mínima
 * 62 en escritorio, 74 en móvil).
 */
function Textarea({
  className,
  error,
  mobile = false,
  id,
  'aria-describedby': ariaDescribedBy,
  ...props
}: React.ComponentProps<'textarea'> & {
  error?: string
  mobile?: boolean
}) {
  const generatedId = React.useId()
  const textareaId = id ?? generatedId
  const errorId = error ? `${textareaId}-error` : undefined

  return (
    <div className="w-full">
      <textarea
        id={textareaId}
        data-slot="textarea"
        aria-invalid={Boolean(error)}
        aria-describedby={cn(ariaDescribedBy, errorId) || undefined}
        className={cn(
          'flex field-sizing-content w-full resize-none rounded-md border border-border-strong bg-surface leading-[1.5] text-text outline-none transition-colors placeholder:text-text-3 focus-visible:border-primary focus-visible:ring-3 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-danger',
          mobile
            ? 'min-h-[74px] px-[13px] py-3 text-[14px]'
            : 'min-h-[62px] px-3 py-[9px] text-[13px]',
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

export { Textarea }
