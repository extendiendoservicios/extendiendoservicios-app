import * as React from 'react'
import { cn } from 'cn'
import { Switch } from '@/components/ui/switch'

/**
 * Fila de toggle (DS-004): título + ayuda + `Switch` a la derecha
 * (`07` sección 2.2, `.tog-row`/`.tog-t`/`.tog-s` de `Mockup/assets/ds2.css`).
 * El texto del título es 12.5 px en el mockup; se redondea a 13 (regla de
 * `07` sección 4, "12.5 → 13 en formularios").
 */
function ToggleRow({
  title,
  description,
  className,
  id,
  ...switchProps
}: {
  title: string
  description?: string
  className?: string
} & React.ComponentProps<typeof Switch>) {
  const generatedId = React.useId()
  const switchId = id ?? generatedId

  return (
    <div
      className={cn(
        'flex items-center gap-3 border-b border-border py-[11px] last:border-b-0',
        className,
      )}
    >
      <div className="min-w-0 flex-1">
        <label
          htmlFor={switchId}
          className="block text-[13px] font-semibold text-text"
        >
          {title}
        </label>
        {description && (
          <p className="mt-[2px] text-[11px] text-text-3">{description}</p>
        )}
      </div>
      <Switch id={switchId} {...switchProps} />
    </div>
  )
}

export { ToggleRow }
