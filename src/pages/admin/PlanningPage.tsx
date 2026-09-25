import { Link, useSearchParams } from 'react-router'
import { PlaceholderScreen } from '@/app/routes/placeholder'
import { ShiftsDayList } from '@/features/shifts/components/ShiftsDayList'
import { todayInBuenosAires } from '@/features/employees/employeeLeaveStatus'

/**
 * `/admin/planificacion` (`05_Pantallas_y_Navegacion.md` sección 5:
 * "ADM-03 (mes) ?vista=semana → ADM-04 ?vista=dia&fecha= → ADM-05"). Esta
 * fase (P10.3) solo construye ADM-05 (SHIFT-010, versión mínima, para
 * probar la generación); ADM-03 (mes) y ADM-04 (semana por empleado) siguen
 * siendo el placeholder que ya existía -- calendario y asignaciones son de
 * F11, el encargo pide explícitamente no adelantarlos.
 *
 * Decisión propia (no está en `05`): se agrega un enlace "Ver la lista de
 * turnos de hoy" en el placeholder del mes para que se pueda llegar a
 * ADM-05 sin escribir el parámetro `?vista=dia` a mano.
 */
export default function PlanningPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const vista = searchParams.get('vista')

  if (vista === 'dia') {
    const date = searchParams.get('fecha') ?? todayInBuenosAires()

    function handleDateChange(next: string) {
      const params = new URLSearchParams(searchParams)
      params.set('vista', 'dia')
      params.set('fecha', next)
      setSearchParams(params, { replace: true })
    }

    return <ShiftsDayList date={date} onDateChange={handleDateChange} />
  }

  return (
    <div className="flex flex-col gap-3">
      <PlaceholderScreen
        screenId="ADM-03"
        title="Planificación"
        subtitle="Ver y navegar el cronograma"
      />
      <Link
        to={`/admin/planificacion?vista=dia&fecha=${todayInBuenosAires()}`}
        className="px-6 text-[13px] font-semibold text-primary-800 hover:underline"
      >
        Ver la lista de turnos de hoy (ADM-05)
      </Link>
    </div>
  )
}
