import { cn } from 'cn'

/**
 * ProgressBar (DS-006): `07` sección 2.3, `.bar`/`.bar.ok`/`.bar.warn` de
 * `Mockup/assets/ds.css`. El fondo del riel (`#EDEFF3` en el mockup) se
 * resuelve con `--secondary` (`#EFF1F5`): son prácticamente el mismo gris y
 * ya existe como token, en vez de sumar uno nuevo por una diferencia de 2-3
 * unidades de color (decisión menor).
 */
interface ProgressBarProps {
  /** 0 a 100. Valores fuera de rango se acotan. */
  value: number
  variant?: 'default' | 'ok' | 'warn'
  /** Etiqueta accesible del progreso (p. ej. "Tareas completadas"). */
  label?: string
  className?: string
}

function ProgressBar({
  value,
  variant = 'default',
  label,
  className,
}: ProgressBarProps) {
  const clampedValue = Math.min(100, Math.max(0, value))

  return (
    <div
      role="progressbar"
      aria-valuenow={clampedValue}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={label}
      className={cn(
        'h-[6px] w-full overflow-hidden rounded-full bg-secondary',
        className,
      )}
    >
      <div
        className={cn(
          'h-full rounded-full bg-primary transition-[width]',
          variant === 'ok' && 'bg-success',
          variant === 'warn' && 'bg-warning',
        )}
        style={{ width: `${clampedValue}%` }}
      />
    </div>
  )
}

export { ProgressBar }
