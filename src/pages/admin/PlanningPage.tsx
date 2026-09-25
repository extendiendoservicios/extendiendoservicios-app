import { useNavigate, useSearchParams } from 'react-router'
import { SegmentedControl } from '@/components/SegmentedControl'
import { ShiftsDayList } from '@/features/shifts/components/ShiftsDayList'
import { MonthCalendar } from '@/features/planning/components/MonthCalendar'
import { WeekGrid } from '@/features/planning/components/WeekGrid'
import { todayInBuenosAires } from '@/features/employees/employeeLeaveStatus'

type Vista = 'mes' | 'semana' | 'dia'

const VISTA_OPTIONS: { value: Vista; label: string }[] = [
  { value: 'mes', label: 'Mes' },
  { value: 'semana', label: 'Semana' },
  { value: 'dia', label: 'Día' },
]

/**
 * `/admin/planificacion` (ASSIGN-008 a ASSIGN-010, `05_Pantallas_y_Navegacion.md`
 * sección 5: "ADM-03 (mes) ?vista=semana → ADM-04 ?vista=dia&fecha= → ADM-05").
 * Un `SegmentedControl` común arriba de las tres vistas para moverse entre
 * ellas sin depender de un enlace suelto en cada una (decisión propia, no
 * está en `05`: la navegación entre ADM-03/ADM-04/ADM-05 ahí solo dice a
 * dónde van, no cómo se ve el selector).
 *
 * Abrir un turno desde el calendario o la grilla semanal lleva a la lista
 * del día de esa fecha (ADM-05) o directo al detalle (`/admin/turnos/:id`,
 * ADM-06 -- placeholder hasta P11.3), según el encargo de ASSIGN-008/009.
 */
export default function PlanningPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const navigate = useNavigate()
  const vista = (searchParams.get('vista') as Vista | null) ?? 'mes'

  function goToVista(next: Vista) {
    const params = new URLSearchParams(searchParams)
    params.set('vista', next)
    if (next === 'dia') {
      params.set('fecha', searchParams.get('fecha') ?? todayInBuenosAires())
    } else {
      params.delete('fecha')
    }
    setSearchParams(params, { replace: true })
  }

  function handleOpenDay(date: string) {
    const params = new URLSearchParams(searchParams)
    params.set('vista', 'dia')
    params.set('fecha', date)
    setSearchParams(params, { replace: true })
  }

  function handleOpenShift(shiftId: string) {
    void navigate(`/admin/turnos/${shiftId}`)
  }

  return (
    <div className="flex flex-col gap-4">
      <SegmentedControl
        aria-label="Vista de planificación"
        options={VISTA_OPTIONS}
        value={vista}
        onValueChange={goToVista}
      />

      {vista === 'semana' && <WeekGrid onOpenShift={handleOpenShift} />}

      {vista === 'dia' && (
        <ShiftsDayList
          date={searchParams.get('fecha') ?? todayInBuenosAires()}
          onDateChange={(next) => {
            const params = new URLSearchParams(searchParams)
            params.set('vista', 'dia')
            params.set('fecha', next)
            setSearchParams(params, { replace: true })
          }}
        />
      )}

      {vista === 'mes' && <MonthCalendar onOpenDay={handleOpenDay} />}
    </div>
  )
}
