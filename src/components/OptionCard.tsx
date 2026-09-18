import * as React from 'react'
import { cn } from 'cn'
import { RadioGroupItem } from '@/components/ui/radio-group'

/**
 * OptionCard (DS-005): tarjeta seleccionable con radio (`07` sección 2.2,
 * `.opt`/`.opt.sel` de `Mockup/assets/ds.css`, drawer D04). Pensada para
 * usarse dentro de un `RadioGroup` (un `value` por tarjeta).
 */
function OptionCard({
  value,
  title,
  description,
  className,
  id,
  disabled,
  ...props
}: {
  value: string
  title: string
  description?: string
  className?: string
} & Omit<React.ComponentProps<typeof RadioGroupItem>, 'value'>) {
  const generatedId = React.useId()
  const inputId = id ?? generatedId

  return (
    <label
      htmlFor={inputId}
      data-disabled={disabled || undefined}
      className={cn(
        'flex cursor-pointer items-center gap-[11px] rounded-lg border border-border bg-surface px-3 py-[9px] transition-colors',
        'has-[[data-state=checked]]:border-primary has-[[data-state=checked]]:bg-primary-50 has-[[data-state=checked]]:shadow-[0_0_0_2px_var(--ring-soft)]',
        'data-disabled:cursor-not-allowed data-disabled:opacity-50',
        className,
      )}
    >
      <RadioGroupItem
        id={inputId}
        value={value}
        disabled={disabled}
        {...props}
      />
      <div className="min-w-0 flex-1">
        <div className="text-[13px] font-semibold text-text">{title}</div>
        {description && (
          <div className="mt-[2px] text-[11px] text-text-3">{description}</div>
        )}
      </div>
    </label>
  )
}

export { OptionCard }
