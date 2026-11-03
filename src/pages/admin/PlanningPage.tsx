import { Link, useSearchParams } from 'react-router'
import { ListChecks, Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useAuth } from '@/features/auth/AuthProvider'
import {
  canGenerateShifts,
  canManageShiftTime,
} from '@/features/shifts/permissions'
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
 * P27.5 (OD-12): los filtros (cliente, sede, empleado y estado) viven en la
 * URL (`?cliente=&sede=&empleado=&estado=`), así que al cambiar de vista con
 * `goToVista` y `handleOpenDay` se conservan: ambas copian los parámetros.
 *
 * Abrir un turno lleva directo al detalle (`/admin/turnos/:id`, ADM-06,
 * ASSIGN-011): un enlace propio en cada chip del calendario, cada tarjeta de
 * la grilla semanal y cada fila de la lista del día. El número de día del
 * calendario sigue abriendo la lista de ese día (ADM-05).
 */
export default function PlanningPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const auth = useAuth()
  const actor = { roles: auth.roles, capabilities: auth.capabilities }
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

  return (
    <div className="flex flex-col gap-4">
      {/* OD-26: acciones comunes a las tres vistas, a la derecha del selector.
          Debajo de `sm` quedan como íconos con etiqueta accesible. */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <SegmentedControl
          aria-label="Vista del calendario"
          options={VISTA_OPTIONS}
          value={vista}
          onValueChange={goToVista}
        />
        <div
          data-testid="planning-actions"
          className="ml-auto flex max-w-full items-center gap-2"
        >
          {canGenerateShifts(actor) && (
            <Button
              asChild
              variant="ghost"
              icon={ListChecks}
              className="max-sm:px-2.5"
            >
              <Link to="/admin/turnos/generar">
                <span className="max-sm:sr-only">Generar turnos del mes</span>
              </Link>
            </Button>
          )}
          {canManageShiftTime(actor) && (
            <Button asChild icon={Plus} className="max-sm:px-2.5">
              <Link
                to={
                  vista === 'dia'
                    ? `/admin/turnos/nuevo?fecha=${searchParams.get('fecha') ?? todayInBuenosAires()}`
                    : '/admin/turnos/nuevo'
                }
              >
                <span className="max-sm:sr-only">Nuevo turno</span>
              </Link>
            </Button>
          )}
        </div>
      </div>

      {vista === 'semana' && <WeekGrid />}

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
