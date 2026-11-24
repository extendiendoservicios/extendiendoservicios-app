import { useMyServicesMonthQuery } from '@/features/employee/queries'
import { UpcomingCalendar } from '@/features/upcomingDays/UpcomingCalendar'
import { MyServicesOfDay } from '@/features/upcomingDays/MyServicesOfDay'
import { useUpcomingDay } from '@/features/upcomingDays/useUpcomingDay'

/**
 * EMP · Próximos días (P32, D-07): minicalendario (abre en mañana, hasta hoy +
 * 60) y, debajo, los servicios propios del día elegido. Es solo de consulta:
 * cada fila abre el detalle del servicio.
 */
export default function UpcomingDaysPage() {
  const day = useUpcomingDay()
  const services = useMyServicesMonthQuery(day.month, day.from, day.to)
  const marked = new Set((services.data ?? []).map((s) => s.shiftDate))

  return (
    <div className="flex flex-col gap-4">
      <UpcomingCalendar
        month={day.month}
        onMonthChange={day.setMonth}
        selected={day.selected}
        onSelect={day.setSelected}
        markedDates={marked}
        min={day.min}
        max={day.max}
        loading={services.isLoading}
      />
      <MyServicesOfDay
        date={day.selected}
        services={services.data}
        isLoading={services.isLoading}
        isError={services.isError}
        showEmpty
      />
    </div>
  )
}
