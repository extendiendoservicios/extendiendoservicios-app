import { useState } from 'react'
import { AlertTriangle, CheckCircle2, X } from 'lucide-react'
import { cn } from 'cn'
import { Button } from '@/components/ui/button'
import { useMediaQuery } from '@/hooks/useMediaQuery'
import { formatMinutes, formatTime } from '@/lib/format'
import { formatDistanceM } from '@/lib/geo'
import type { AttendanceBoardRow } from '@/api/attendance'
import { formatShiftRange } from '@/features/shifts/openEnded'
import { shiftFranjaLabel } from '../labels'
import { isNegativeAttention } from '../attention'
import type {
  AttentionItem,
  AttentionKind,
  ClosedAttentionItem,
} from '../attention'
import { RowActions } from './RowActions'

/** Título de cada categoría (`05` línea 36) y gravedad visual (`07` sección 3). */
const KIND_META: Record<
  AttentionKind,
  { title: string; severity: 'crit' | 'warn' | 'ok' }
> = {
  noRecord: { title: 'no registró el inicio', severity: 'crit' },
  noCheckout: {
    title: 'quedó sin salida: cargá la hora para cerrar sus horas',
    severity: 'warn',
  },
  overdue: { title: 'sigue en curso pasada su hora de fin', severity: 'warn' },
  absence: { title: 'avisó que no va', severity: 'warn' },
  uncovered: { title: 'Turno sin cubrir', severity: 'crit' },
  outsideGeo: {
    title: 'fichó fuera de la zona de la sede',
    severity: 'warn',
  },
  late: {
    title: 'llegó tarde: todavía no registró el inicio',
    severity: 'warn',
  },
  // OG-03: el texto lleva los minutos avisados, se arma en `describeItem`.
  delayNotified: { title: 'avisó una demora', severity: 'warn' },
  // D-09/D-10: el texto y el tono (verde o amarillo) se arman en `describeItem` / `itemSeverity`.
  onTheWay: { title: 'En camino', severity: 'ok' },
}

/** `onTheWay` es verde (informativo) o amarillo según `item.tone`; el resto, fijo por categoría. */
function itemSeverity(item: AttentionItem): 'crit' | 'warn' | 'ok' {
  if (item.kind === 'onTheWay') {
    return item.tone === 'warn' ? 'warn' : 'ok'
  }
  return KIND_META[item.kind].severity
}

/** El cierre (OG-02) todavía no admite «En camino»: `attention_dismissals_kind_check` (0085) no lo incluye. */
function isDismissible(item: AttentionItem): boolean {
  return item.kind !== 'onTheWay'
}

/**
 * En celular (< 1024 px) se muestran las primeras alertas, que ya vienen
 * ordenadas por urgencia, para no enterrar "Servicios de hoy" (decisión de
 * Mike, 1 oct 2026). En escritorio se muestran todas.
 */
const MOBILE_VISIBLE_ITEMS = 5

/** « · a 350 m de la sede»: la distancia del fichaje que quedó fuera de zona (inicio o fin). */
function outsideDistanceLabel(row: AttendanceBoardRow): string {
  const geo = [row.checkInGeo, row.checkOutGeo].find(
    (candidate) => candidate?.status === 'outside' && !candidate.overridden,
  )
  return geo?.distanceM != null
    ? ` · a ${formatDistanceM(geo.distanceM)} de la sede`
    : ''
}

function describeItem(item: AttentionItem): { title: string; detail: string } {
  const meta = KIND_META[item.kind]
  const row = item.assignment
  const since =
    item.minutesSince != null
      ? ` · hace ${formatMinutes(item.minutesSince)}`
      : ''
  if (row) {
    const name = `${row.employeeFirstName} ${row.employeeLastName}`
    const outside = item.kind === 'outsideGeo' ? outsideDistanceLabel(row) : ''
    // OG-03: «Pérez avisó que llega 20 min tarde», con el motivo si lo escribió.
    const delayTitle = `avisó que llega ${row.lastNoticeMinutesLate ?? ''} min tarde`
    const reason =
      item.kind === 'delayNotified' && row.lastNoticeReasonText
        ? ` · «${row.lastNoticeReasonText}»`
        : ''
    if (item.kind === 'onTheWay') {
      // D-09/D-10: «En camino · llega 08:05» (hora de Buenos Aires) o «En camino».
      const arrival = item.estimatedArrivalAt
        ? ` · llega ${formatTime(item.estimatedArrivalAt)}`
        : ''
      return {
        title: `${name} · En camino${arrival}`,
        detail: `${row.clientName} · ${row.siteName} · ${formatShiftRange(row.startTime, row.endTime, row.openEnded)}`,
      }
    }
    return {
      title: `${name} ${item.kind === 'delayNotified' ? delayTitle : meta.title}`,
      detail: `${row.clientName} · ${row.siteName} · ${formatShiftRange(row.startTime, row.endTime, row.openEnded)}${since}${outside}${reason}`,
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
  /** OG-02: avisos cerrados todavía vigentes, para «Ver cerrados (N)». */
  closed?: ClosedAttentionItem[]
  /** Cierra un aviso para toda la administración; sin esta función no hay ✕. */
  onDismiss?: (item: AttentionItem) => void
  /** Reabre un cierre (id de `attention_dismissals`). */
  onReopen?: (dismissalId: string) => void
  /** Nombre de quien cerró cada aviso, por id de perfil. */
  dismisserNames?: Map<string, string>
  /** Hay un cierre o reapertura en curso: se deshabilitan los botones. */
  isBusy?: boolean
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
  closed = [],
  onDismiss,
  onReopen,
  dismisserNames,
  isBusy = false,
}: AttentionBlockProps) {
  const isDesktop = useMediaQuery('(min-width: 1024px)')
  const [isExpanded, setIsExpanded] = useState(false)
  const [showClosed, setShowClosed] = useState(false)
  const isCollapsible = !isDesktop && items.length > MOBILE_VISIBLE_ITEMS
  const negativeCount = items.filter(isNegativeAttention).length
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
        {negativeCount > 0 && (
          <span className="rounded-full bg-danger-bg px-2 py-px text-[11.5px] font-semibold text-danger-800">
            {negativeCount}
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
              const severity = itemSeverity(item)
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
                    severity === 'crit' && 'border-danger-border bg-danger-bg',
                    severity === 'warn' &&
                      'border-warning-border bg-warning-bg',
                    severity === 'ok' && 'border-success/40 bg-success-bg',
                  )}
                >
                  <div
                    className={cn(
                      'flex items-start gap-2',
                      severity === 'crit' && 'text-danger-800',
                      severity === 'warn' && 'text-warning-800',
                      severity === 'ok' && 'text-success-800',
                    )}
                  >
                    {severity === 'ok' ? (
                      <CheckCircle2
                        aria-hidden="true"
                        className="mt-[2px] size-4 shrink-0"
                      />
                    ) : (
                      <AlertTriangle
                        aria-hidden="true"
                        className="mt-[2px] size-4 shrink-0"
                      />
                    )}
                    <div className="min-w-0 flex-1">
                      <p className="text-[13px] font-semibold">{title}</p>
                      <p className="text-[12px] text-text-2">{detail}</p>
                    </div>
                    {onDismiss && isDismissible(item) && (
                      <button
                        type="button"
                        aria-label={`Cerrar aviso: ${title}`}
                        title="Cerrar aviso"
                        disabled={isBusy}
                        onClick={() => onDismiss(item)}
                        className="-mr-1 -mt-1 inline-flex size-7 shrink-0 items-center justify-center rounded-md text-text-3 hover:bg-black/5 hover:text-text focus-visible:outline-2 focus-visible:outline-primary disabled:opacity-50"
                      >
                        <X aria-hidden="true" className="size-4" />
                      </button>
                    )}
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

      {!isLoading && closed.length > 0 && (
        <div className="mt-3 border-t border-border pt-3">
          <button
            type="button"
            aria-expanded={showClosed}
            onClick={() => setShowClosed((value) => !value)}
            className="text-[12.5px] font-semibold text-primary-800 hover:underline"
          >
            {showClosed
              ? `Ocultar cerrados (${closed.length})`
              : `Ver cerrados (${closed.length})`}
          </button>
          {showClosed && (
            <ul
              aria-label="Avisos cerrados"
              className="mt-2 flex flex-col gap-2"
            >
              {closed.map(({ item, dismissal }) => {
                const { title, detail } = describeItem(item)
                const by = dismisserNames?.get(dismissal.dismissedBy)
                return (
                  <li
                    key={dismissal.id}
                    className="flex items-start justify-between gap-2 rounded-lg border border-border bg-bg p-3"
                  >
                    <div className="min-w-0">
                      <p className="text-[13px] font-semibold text-text-2">
                        {title}
                      </p>
                      <p className="text-[12px] text-text-3">{detail}</p>
                      <p className="text-[11.5px] text-text-3">
                        Cerrado{by ? ` por ${by}` : ''} a las{' '}
                        {formatTime(dismissal.dismissedAt)}
                      </p>
                    </div>
                    {onReopen && (
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={isBusy}
                        onClick={() => onReopen(dismissal.id)}
                      >
                        Reabrir
                      </Button>
                    )}
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      )}
    </section>
  )
}

export { AttentionBlock }
