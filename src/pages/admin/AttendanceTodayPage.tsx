import { useSearchParams } from 'react-router'
import { AttendanceTodayList } from '@/features/attendance/components/AttendanceTodayList'
import { todayInBuenosAires } from '@/features/employees/employeeLeaveStatus'

/**
 * `/admin/asistencia` (ADM-10 "Asistencia de hoy", ATT-011, ATT-012, `05`
 * línea 49): fecha por `?fecha=` (`05` sección 5), igual criterio que
 * `PlanningPage`/`ShiftsDayList` para `?fecha=` de la vista día.
 */
export default function AttendanceTodayPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const date = searchParams.get('fecha') ?? todayInBuenosAires()

  function handleDateChange(next: string) {
    const params = new URLSearchParams(searchParams)
    params.set('fecha', next)
    setSearchParams(params, { replace: true })
  }

  return <AttendanceTodayList date={date} onDateChange={handleDateChange} />
}
