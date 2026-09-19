import * as React from 'react'
import { cn } from 'cn'

/**
 * EmptyState (DS-006): ícono, título, texto y acción opcional (`07`
 * sección 2.3). Sin clase equivalente en el mockup (no aparece ninguna
 * pantalla vacía en las 47 del mockup v2): la tipografía sigue los roles ya
 * definidos (título de sección 14/650, texto de ayuda 11.5 px).
 */
interface EmptyStateProps {
  icon?: React.ComponentType<{ className?: string }>
  title: string
  description?: string
  action?: React.ReactNode
  className?: string
}

function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  className,
}: EmptyStateProps) {
  return (
    <div
      className={cn(
        'flex flex-col items-center gap-2 px-6 py-10 text-center',
        className,
      )}
    >
      {Icon && (
        <div className="mb-1 flex size-11 items-center justify-center rounded-full bg-secondary text-text-3">
          <Icon aria-hidden="true" className="size-5" />
        </div>
      )}
      <p className="text-sm font-semibold text-text">{title}</p>
      {description && (
        <p className="max-w-xs text-[11.5px] text-text-3">{description}</p>
      )}
      {action && <div className="mt-2">{action}</div>}
    </div>
  )
}

export { EmptyState }
