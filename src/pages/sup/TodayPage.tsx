import { Alert, AlertDescription } from '@/components/ui/alert'
import { InstallBanner } from '@/components/InstallBanner'
import { AnnouncementsBanner } from '@/features/announcements/mobile/AnnouncementsBanner'
import { useAuth } from '@/features/auth/AuthProvider'
import { useMyDayQuery } from '@/features/employee/queries'
import { ServiceCard } from '@/features/employee/components/ServiceCard'
import { WorkdayBar } from '@/features/coordinator/components/WorkdayBar'
import { TodayShiftsList } from '@/features/coordinator/components/TodayShiftsList'

/**
 * SUP-02 · Hoy (P24.2, CJ-02, CJ-12, CJ-25): arriba la barra de jornada
 * (contador de horas netas, estado y los botones Iniciar, Pausar, Reanudar,
 * Finalizar y Reabrir) y abajo los turnos del día de todos los clientes y
 * sedes en dos bloques, «Mis sedes» y «Otras sedes». Ya no hay supervisiones
 * asignadas ni «Próximos días»: el coordinador elige el turno y lo toma desde
 * SUP-03.
 *
 * P19.9: quien además es empleado ve arriba «Tus servicios de hoy» (sus
 * propios turnos, que abren EMP-04), sin tener que ir a «Más» → «Mis
 * servicios».
 */
export default function SupervisorTodayPage() {
  const auth = useAuth()
  const isEmployee = auth.roles.includes('employee')

  return (
    <div className="flex flex-col gap-4">
      <AnnouncementsBanner />
      <InstallBanner />

      <WorkdayBar />

      {isEmployee && <MyServicesToday />}

      <TodayShiftsList />
    </div>
  )
}

/**
 * Servicios propios de hoy de quien es supervisor y empleado a la vez. Si no
 * tiene ninguno, no se muestra nada (el estado vacío es el de supervisiones).
 */
function MyServicesToday() {
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
  const today = (data ?? []).filter((assignment) => assignment.isToday)
  if (today.length === 0) {
    return null
  }
  return (
    <section aria-label="Tus servicios de hoy" className="flex flex-col gap-2">
      <p className="text-[11px] font-semibold tracking-[0.4px] text-text-3 uppercase">
        Tus servicios de hoy
      </p>
      {today.map((assignment) => (
        <ServiceCard key={assignment.assignmentId} assignment={assignment} />
      ))}
    </section>
  )
}
