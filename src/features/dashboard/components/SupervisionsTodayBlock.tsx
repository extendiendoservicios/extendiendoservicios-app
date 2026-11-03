import { Link } from 'react-router'
import { todayInBuenosAires } from '@/features/employees/employeeLeaveStatus'
import { CoordinatorCards } from '@/features/workdays/components/CoordinatorCards'

/**
 * Coordinadores de hoy (DASH-007, P24.4, OD-04): una tarjeta por coordinador
 * con su estado, el inicio de la jornada, las pausas, la supervisión en curso
 * y las horas netas; «Ver actividad» abre la línea de tiempo del día y
 * «Finalizar jornada» (OD-06) la cierra desde la administración. El tiempo de
 * cada supervisión es informativo y no suma horas (CJ-14); el detalle sigue
 * en «Supervisiones».
 */
function SupervisionsTodayBlock() {
  return (
    <section
      aria-label="Supervisiones de hoy"
      className="rounded-lg border border-border bg-surface p-4 shadow-card"
    >
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="text-[15px] font-semibold text-text">
          Supervisiones de hoy
        </h2>
        <Link
          to="/admin/supervisiones"
          className="inline-flex items-center text-[12.5px] font-medium text-primary-800 hover:underline max-md:min-h-11"
        >
          Ver todas
        </Link>
      </div>
      <CoordinatorCards
        date={todayInBuenosAires()}
        isToday
        emptyTitle="No hay coordinadores activos"
      />
    </section>
  )
}

export { SupervisionsTodayBlock }
