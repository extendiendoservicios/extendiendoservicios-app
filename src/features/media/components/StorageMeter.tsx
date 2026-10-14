import { cn } from 'cn'
import { HardDrive } from 'lucide-react'
import {
  storageBucketLabel,
  type StorageLevel,
  type StorageUsage,
} from '@/api/mediaAdmin'
import { formatBytes } from '@/features/media/schemas'

/**
 * Medidor de espacio (H-09, H-14, H-18): el total de Storage sobre el tope de
 * 1 GB y el desglose por bucket. Amarillo desde el 70 % y rojo desde el 90 %
 * (`level` lo decide el servidor). No bloquea nada: solo avisa.
 *
 * El nivel no se comunica solo con el color: va también en palabras.
 */
const LEVEL_TEXT: Record<StorageLevel, string> = {
  ok: 'Espacio de sobra',
  warning: 'Se está llenando',
  critical: 'Casi lleno',
}

const LEVEL_BAR: Record<StorageLevel, string> = {
  ok: 'bg-primary',
  warning: 'bg-warning',
  critical: 'bg-danger',
}

const LEVEL_TEXT_COLOR: Record<StorageLevel, string> = {
  ok: 'text-text-2',
  warning: 'text-warning-800',
  critical: 'text-danger-800',
}

export function formatPercent(percent: number): string {
  return `${percent.toFixed(1).replace('.', ',').replace(',0', '')} %`
}

/** Aviso según el nivel; `null` cuando está todo bien. */
export function storageAdvice(level: StorageLevel): string | null {
  if (level === 'warning') {
    return 'Conviene bajar los plazos de vencimiento o decidir si pasar al plan pago antes de que se llene.'
  }
  if (level === 'critical') {
    return 'Hay que decidir ya: bajar los plazos de vencimiento o pasar al plan pago. La app no bloquea las subidas, pero el almacenamiento puede dejar de aceptarlas cuando se llene.'
  }
  return null
}

interface StorageMeterProps {
  usage: StorageUsage
  className?: string
}

function StorageMeter({ usage, className }: StorageMeterProps) {
  const percent = Math.min(100, Math.max(0, usage.percent))
  const advice = storageAdvice(usage.level)
  const buckets = [...usage.buckets].sort((a, b) => b.bytes - a.bytes)

  return (
    <section
      aria-label="Espacio usado"
      className={cn(
        'flex flex-col gap-3 rounded-lg border border-border bg-surface p-5',
        className,
      )}
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="flex items-center gap-2 text-[13px] font-semibold text-text">
          <HardDrive aria-hidden="true" className="size-4 text-text-3" />
          Espacio usado
        </h2>
        <p className="text-[13px] text-text tabular-nums">
          <strong>{formatBytes(usage.totalBytes)}</strong> de{' '}
          {formatBytes(usage.limitBytes)} · {formatPercent(usage.percent)}
        </p>
      </div>

      <div
        role="progressbar"
        aria-label="Espacio usado"
        aria-valuenow={Math.round(percent)}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuetext={`${formatPercent(usage.percent)} del espacio. ${LEVEL_TEXT[usage.level]}.`}
        className="h-2 w-full overflow-hidden rounded-full bg-secondary"
      >
        <div
          className={cn('h-full rounded-full', LEVEL_BAR[usage.level])}
          style={{ width: `${percent}%` }}
        />
      </div>

      <p
        className={cn(
          'text-[12px] font-semibold',
          LEVEL_TEXT_COLOR[usage.level],
        )}
      >
        {LEVEL_TEXT[usage.level]}
      </p>
      {advice && <p className="text-[12px] text-text-2">{advice}</p>}

      {buckets.length > 0 && (
        <ul className="grid grid-cols-1 gap-x-6 gap-y-1 sm:grid-cols-2">
          {buckets.map((bucket) => (
            <li
              key={bucket.bucket}
              className="flex items-baseline justify-between gap-3 text-[12px] text-text-2"
            >
              <span>{storageBucketLabel(bucket.bucket)}</span>
              <span className="tabular-nums">{formatBytes(bucket.bytes)}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

export { StorageMeter }
