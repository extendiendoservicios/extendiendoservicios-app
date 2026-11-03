import { Link } from 'react-router'
import { Square } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { Timeline } from '@/components/Timeline'
import { formatMinutes, formatTime } from '@/lib/format'
import { formatDateOnly } from '@/features/settings/dateOnly'
import {
  SUPERVISOR_STATUS_LABELS,
  SUPERVISOR_STATUS_VARIANTS,
  coordinatorWorkdayPath,
} from '@/features/geo/coordinators'
import { SupervisionStateBadges } from '@/features/supervisions/components/UnclosedBadge'
import type { SupervisionStatus } from '@/api/supervisions'
import {
  buildActivityTimeline,
  describePause,
  type CoordinatorCardData,
} from '../coordinatorCards'

interface CoordinatorActivityPanelProps {
  card: CoordinatorCardData | null
  canManage: boolean
  onOpenChange: (open: boolean) => void
  onEndWorkday: (card: CoordinatorCardData) => void
}

/**
 * Panel lateral «Ver actividad» (OD-04): la línea de tiempo completa del día
 * de un coordinador (eventos, supervisiones y correcciones), con «Finalizar
 * jornada» (OD-06) si está abierta y el enlace al detalle donde se corrige
 * todo (OD-07). En celular el `Sheet` ocupa toda la pantalla (P-094).
 */
function CoordinatorActivityPanel({
  card,
  canManage,
  onOpenChange,
  onEndWorkday,
}: CoordinatorActivityPanelProps) {
  const workday = card?.workday ?? null
  const items = workday ? buildActivityTimeline(workday) : []
  const corrections = items.filter((item) => item.description)

  return (
    <Sheet open={card != null} onOpenChange={onOpenChange}>
      <SheetContent>
        {card && workday && (
          <>
            <SheetHeader>
              <SheetTitle>Actividad de {card.name}</SheetTitle>
              <SheetDescription className="capitalize">
                {formatDateOnly(workday.workDate)}
              </SheetDescription>
            </SheetHeader>
            <div className="flex flex-col gap-4 overflow-y-auto px-4 pb-4">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant={SUPERVISOR_STATUS_VARIANTS[card.status]}>
                  {SUPERVISOR_STATUS_LABELS[card.status]}
                </Badge>
                <span className="text-[12.5px] text-text-2">
                  {formatMinutes(workday.workedMinutes)} netas
                </span>
                {canManage && workday.isOpen && (
                  <Button
                    size="sm"
                    variant="ghost"
                    icon={Square}
                    onClick={() => onEndWorkday(card)}
                  >
                    Finalizar jornada
                  </Button>
                )}
              </div>

              <section className="flex flex-col gap-2">
                <h3 className="text-[12.5px] font-semibold text-text-2">
                  Línea de tiempo
                </h3>
                {items.length === 0 ? (
                  <p className="text-[12.5px] text-text-3">
                    Todavía no hay registros.
                  </p>
                ) : (
                  <Timeline items={items} />
                )}
              </section>

              {card.pauses.length > 0 && (
                <section className="flex flex-col gap-1">
                  <h3 className="text-[12.5px] font-semibold text-text-2">
                    Pausas
                  </h3>
                  <ul className="text-[12.5px] text-text-2">
                    {card.pauses.map((pause) => (
                      <li key={pause.pauseEventId}>{describePause(pause)}</li>
                    ))}
                  </ul>
                </section>
              )}

              <section className="flex flex-col gap-1">
                <h3 className="text-[12.5px] font-semibold text-text-2">
                  Supervisiones
                </h3>
                {workday.supervisions.length === 0 ? (
                  <p className="text-[12.5px] text-text-3">
                    No hizo supervisiones.
                  </p>
                ) : (
                  <ul className="flex flex-col gap-1.5">
                    {workday.supervisions.map((supervision) => (
                      <li
                        key={supervision.supervisionId}
                        className="flex flex-wrap items-center justify-between gap-2 text-[12.5px]"
                      >
                        <Link
                          to={`/admin/supervisiones/${supervision.supervisionId}`}
                          className="font-semibold text-text hover:text-primary-800"
                        >
                          {supervision.clientName} · {supervision.siteName}
                        </Link>
                        <span className="flex flex-wrap items-center gap-2 text-text-2">
                          {supervision.checkInAt
                            ? formatTime(supervision.checkInAt)
                            : '—'}
                          {' a '}
                          {supervision.checkOutAt
                            ? formatTime(supervision.checkOutAt)
                            : 'en curso'}
                          <SupervisionStateBadges
                            status={supervision.status as SupervisionStatus}
                            unclosed={supervision.unclosed}
                          />
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </section>

              {corrections.length > 0 && (
                <section className="flex flex-col gap-1">
                  <h3 className="text-[12.5px] font-semibold text-text-2">
                    Correcciones
                  </h3>
                  <ul className="flex flex-col gap-1 text-[11.5px] text-text-3">
                    {corrections.map((item) => (
                      <li key={item.id}>
                        <span className="font-medium text-text-2">
                          {item.title}
                        </span>
                        {' — '}
                        {item.description}
                      </li>
                    ))}
                  </ul>
                </section>
              )}

              <Link
                to={coordinatorWorkdayPath(card.supervisorId)}
                className="text-[12.5px] font-medium text-primary-800 hover:underline max-md:flex max-md:min-h-11 max-md:items-center"
              >
                Ver y corregir el detalle de la jornada
              </Link>
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  )
}

export { CoordinatorActivityPanel }
