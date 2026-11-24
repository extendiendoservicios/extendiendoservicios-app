import { useAuth } from '@/features/auth/AuthProvider'
import { useMyServicesMonthQuery } from '@/features/employee/queries'
import { useSupervisorShiftsMonthQuery } from '@/api/supervisorToday'
import { UpcomingShiftsList } from '@/features/coordinator/components/UpcomingShiftsList'
import { UpcomingCalendar } from '@/features/upcomingDays/UpcomingCalendar'
import { MyServicesOfDay } from '@/features/upcomingDays/MyServicesOfDay'
import { useUpcomingDay } from '@/features/upcomingDays/useUpcomingDay'

/**
 * SUP-10 · Próximos días (P32, D-05 y D-06): minicalendario arriba (abre en
 * mañana, hasta hoy + 60) y, debajo, los turnos del día elegido. Quien además
 * es empleado ve primero sus propios servicios de ese día. Todo es de consulta.
 */
export default function SupervisorUpcomingPage() {
  const auth = useAuth()
  const isEmployee = auth.roles.includes('employee')
  const day = useUpcomingDay()
  const shifts = useSupervisorShiftsMonthQuery(day.month, day.from, day.to)
  const services = useMyServicesMonthQuery(
    day.month,
    day.from,
    day.to,
    isEmployee,
  )

  const marked = new Set<string>([
    ...(shifts.data ?? []).map((shift) => shift.shiftDate),
    ...(isEmployee ? (services.data ?? []) : []).map(
      (service) => service.shiftDate,
    ),
  ])

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
        loading={shifts.isLoading}
      />
      {isEmployee && (
        <MyServicesOfDay
          date={day.selected}
          services={services.data}
          isLoading={services.isLoading}
          isError={services.isError}
          title="Tus servicios"
        />
      )}
      <UpcomingShiftsList
        date={day.selected}
        shifts={shifts.data}
        isLoading={shifts.isLoading}
        isError={shifts.isError}
      />
    </div>
  )
}
