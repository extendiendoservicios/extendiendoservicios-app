import { AlertTriangle, CalendarClock, Clock, Users } from 'lucide-react'
import { KpiCard } from '@/components/KpiCard'
import { cn } from 'cn'
import type { DashboardKpis as Kpis } from '../kpis'

function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`
}

/**
 * Los cinco KPIs de ADM-02 (DASH-001, DASH-005). En cero, las tarjetas de
 * alerta (sin registro, avisos) vuelven a neutras: un cero no es una alarma.
 * En escritorio van en una fila; por debajo de 1024 px en dos columnas (D29)
 * y la quinta ocupa el ancho completo.
 */
function DashboardKpis({ kpis }: { kpis: Kpis }) {
  const notices = kpis.absenceNotices + kpis.delayNotices
  return (
    <section
      aria-label="Indicadores de hoy"
      className="grid grid-cols-2 gap-3 lg:grid-cols-5"
    >
      <KpiCard
        variant="accent"
        icon={CalendarClock}
        label="Turnos hoy"
        value={kpis.shiftsToday}
        detail={`${plural(kpis.clientsToday, 'cliente', 'clientes')} · ${plural(kpis.sitesToday, 'sede', 'sedes')}`}
      />
      <KpiCard
        variant={kpis.present > 0 ? 'ok' : 'default'}
        icon={Users}
        label="Presentes"
        value={kpis.present}
        detail="en servicio ahora"
      />
      <KpiCard
        icon={Clock}
        label="Próximos"
        value={kpis.upcoming}
        detail="empiezan en las próximas 2 h"
      />
      <KpiCard
        variant={kpis.noRecord > 0 ? 'crit' : 'default'}
        icon={AlertTriangle}
        label="Sin registro"
        value={kpis.noRecord}
        detail="pasó la hora de inicio"
      />
      <KpiCard
        className={cn('col-span-2 lg:col-span-1')}
        variant={notices > 0 ? 'warn' : 'default'}
        icon={AlertTriangle}
        label="Avisos"
        value={notices}
        detail={`${plural(kpis.absenceNotices, 'ausencia', 'ausencias')} · ${plural(kpis.delayNotices, 'demora', 'demoras')}`}
      />
    </section>
  )
}

export { DashboardKpis }
