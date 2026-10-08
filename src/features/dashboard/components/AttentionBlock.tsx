import { useState } from 'react'
import { AlertTriangle, CheckCircle2 } from 'lucide-react'
import { cn } from 'cn'
import { Button } from '@/components/ui/button'
import { useMediaQuery } from '@/hooks/useMediaQuery'
import { formatMinutes } from '@/lib/format'
import { shiftFranjaLabel } from '../labels'
import type { AttentionItem, AttentionKind } from '../attention'
import { RowActions } from './RowActions'

/** Título de cada categoría (`05` línea 36) y gravedad visual (`07` sección 3). */
const KIND_META: Record<
  AttentionKind,
  { title: string; severity: 'crit' | 'warn' }
> = {
  noRecord: { title: 'no registró el inicio', severity: 'crit' },
  overdue: { title: 'sigue en curso pasada su hora de fin', severity: 'warn' },
  absence: { title: 'avisó que no va', severity: 'warn' },
  uncovered: { title: 'Turno sin cubrir', severity: 'crit' },
  late: {
    title: 'llegó tarde: todavía no registró el inicio',
    severity: 'warn',
  },
}

/**
 * En celular (< 1024 px) se muestran las primeras alertas, que ya vienen
 * ordenadas por urgencia, para no enterrar "Servicios de hoy" (decisión de
 * Mike, 1 oct 2026). En escritorio se muestran todas.
 */
const MOBILE_VISIBLE_ITEMS = 5

function describeItem(item: AttentionItem): { title: string; detail: string } {
  const meta = KIND_META[item.kind]
  const row = item.assignment
  const since =
    item.minutesSince != null
      ? ` · hace ${formatMinutes(item.minutesSince)}`
      : ''
  if (row) {
    const name = `${row.employeeFirstName} ${row.employeeLastName}`
    return {
      title: `${name} ${meta.title}`,
      detail: `${row.clientName} · ${row.siteName} · ${row.startTime.slice(0, 5)}–${row.endTime.slice(0, 5)}${since}`,
    }
  }
  const shift = item.shift
  return {
    title: meta.title,
    detail: shift
      ? `${shift.clientName} · ${shift.siteName} · ${shiftFranjaLabel(shift)} · ${shift.assignedCount}/${shift.requiredStaff} asignados${since}`
      : '',
  }
}

interface AttentionBlockProps {
  items: AttentionItem[]
  isLoading: boolean
  phones: Map<string, string | null> | undefined
  canRecord: (item: AttentionItem) => boolean
  canAssign: (shiftId: string) => boolean
  onRecord: (item: AttentionItem) => void
  onAssign: (item: AttentionItem) => void
}

/**
 * Bloque "Requiere atención" (DASH-002): una tarjeta por alerta, con las
 * acciones de la fila. Sin alertas muestra un mensaje de "todo en orden".
 */
function AttentionBlock({
  items,
  isLoading,
  phones,
  canRecord,
  canAssign,
  onRecord,
  onAssign,
}: AttentionBlockProps) {
  const isDesktop = useMediaQuery('(min-width: 1024px)')
  const [isExpanded, setIsExpanded] = useState(false)
  const isCollapsible = !isDesktop && items.length > MOBILE_VISIBLE_ITEMS
  const visibleItems =
    isCollapsible && !isExpanded ? items.slice(0, MOBILE_VISIBLE_ITEMS) : items

  return (
    <section
      aria-label="Requiere atención"
      className={cn(
        'rounded-lg border border-border bg-surface p-4 shadow-card',
        // Reserva alto mientras carga (CLS de ADM-02, P17.4.1): sin esto, al
        // llegar las tarjetas el bloque crece y empuja "Servicios de hoy".
        isLoading && 'min-h-[24rem] md:min-h-[16rem]',
      )}
    >
      <div className="mb-3 flex items-center gap-2">
        <h2 className="text-[15px] font-semibold text-text">
          Requiere atención
        </h2>
        {items.length > 0 && (
          <span className="rounded-full bg-danger-bg px-2 py-px text-[11.5px] font-semibold text-danger-800">
            {items.length}
          </span>
        )}
      </div>

      {isLoading ? (
        <p className="text-[12.5px] text-text-3">Cargando…</p>
      ) : items.length === 0 ? (
        <p className="flex items-center gap-2 text-[13px] text-text-2">
          <CheckCircle2 aria-hidden="true" className="size-4 text-success" />
          No hay nada pendiente: la operación de hoy está en orden.
        </p>
      ) : (
        <>
          <ul className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {visibleItems.map((item) => {
              const { title, detail } = describeItem(item)
              const severity = KIND_META[item.kind].severity
              const phone = item.assignment
                ? phones?.get(item.assignment.employeeId)
                : undefined
              const showAssign =
                canAssign(item.shiftId) &&
                item.shift != null &&
                (item.kind === 'absence' ||
                  item.kind === 'uncovered' ||
                  item.kind === 'noRecord')
              return (
                <li
                  key={item.key}
                  className={cn(
                    'flex flex-col gap-2 rounded-lg border p-3',
                    severity === 'crit'
                      ? 'border-danger-border bg-danger-bg'
                      : 'border-warning-border bg-warning-bg',
                  )}
                >
                  <div
                    className={cn(
                      'flex items-start gap-2',
                      severity === 'crit'
                        ? 'text-danger-800'
                        : 'text-warning-800',
                    )}
                  >
                    <AlertTriangle
                      aria-hidden="true"
                      className="mt-[2px] size-4 shrink-0"
                    />
                    <div className="min-w-0">
                      <p className="text-[13px] font-semibold">{title}</p>
                      <p className="text-[12px] text-text-2">{detail}</p>
                    </div>
                  </div>
                  <RowActions
                    shiftId={item.shiftId}
                    phone={phone}
                    onRecord={
                      canRecord(item) ? () => onRecord(item) : undefined
                    }
                    onAssign={showAssign ? () => onAssign(item) : undefined}
                    assignLabel={
                      item.kind === 'uncovered'
                        ? 'Asignar empleado'
                        : 'Asignar reemplazo'
                    }
                  />
                </li>
              )
            })}
          </ul>
          {isCollapsible && (
            <Button
              variant="ghost"
              size="sm"
              className="mt-3 w-full"
              aria-expanded={isExpanded}
              onClick={() => setIsExpanded((value) => !value)}
            >
              {isExpanded ? 'Ver menos' : `Ver las ${items.length}`}
            </Button>
          )}
        </>
      )}
    </section>
  )
}

export { AttentionBlock }
