import { Alert, AlertDescription } from '@/components/ui/alert'
import { useAuth } from '@/features/auth/AuthProvider'
import { useMyDayQuery } from '@/features/employee/queries'
import { UpcomingRow } from '@/features/employee/components/UpcomingRow'
import { UpcomingShiftsList } from '@/features/coordinator/components/UpcomingShiftsList'

/**
 * SUP-10 · Próximos días (P31, D-09, OI-07): los turnos de mañana a hoy + 7,
 * separados de «Hoy». Quien además es empleado ve arriba sus propios servicios
 * de esos días (los de «Próximos días» de EMP-03). Todo es de consulta.
 */
export default function SupervisorUpcomingPage() {
  const auth = useAuth()
  const isEmployee = auth.roles.includes('employee')

  return (
    <div className="flex flex-col gap-4">
      {isEmployee && <MyUpcomingServices />}
      <UpcomingShiftsList />
    </div>
  )
}

function MyUpcomingServices() {
  const { data, isError } = useMyDayQuery()
  if (isError) {
    return (
      <Alert variant="crit">
        <AlertDescription>
          No pudimos cargar tus servicios. Probá de nuevo en un momento.
        </AlertDescription>
      </Alert>
    )
  }
  const upcoming = (data ?? []).filter((assignment) => !assignment.isToday)
  if (upcoming.length === 0) {
    return null
  }
  return (
    <section
      aria-label="Tus servicios de los próximos días"
      className="flex flex-col gap-2"
    >
      <p className="text-[11px] font-semibold tracking-[0.4px] text-text-3 uppercase">
        Tus servicios
      </p>
      {upcoming.map((assignment) => (
        <UpcomingRow key={assignment.assignmentId} assignment={assignment} />
      ))}
    </section>
  )
}
