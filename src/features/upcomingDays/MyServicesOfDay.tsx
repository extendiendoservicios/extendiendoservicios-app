import { Alert, AlertDescription } from '@/components/ui/alert'
import { EmptyState } from '@/components/EmptyState'
import { CalendarX } from 'lucide-react'
import type { MyDayAssignment } from '@/api/myDay'
import { UpcomingRow } from '@/features/employee/components/UpcomingRow'
import { dayLabel } from './dates'

/**
 * Los servicios propios del día elegido en «Próximos días» (P32, D-06 y D-07).
 * Con `showEmpty` (pantalla del empleado) dice que no hay servicios ese día;
 * sin él (coordinador que también es empleado) el bloque no aparece si no
 * hay nada.
 */
export function MyServicesOfDay({
  date,
  services,
  isLoading,
  isError,
  showEmpty = false,
  title,
}: {
  date: string
  services: MyDayAssignment[] | undefined
  isLoading: boolean
  isError: boolean
  showEmpty?: boolean
  /** Rótulo del bloque (por ejemplo «Tus servicios»); sin él no se muestra. */
  title?: string
}) {
  if (isLoading) {
    return showEmpty ? (
      <p className="p-4 text-center text-[12.5px] text-text-3">Cargando…</p>
    ) : null
  }
  if (isError || !services) {
    return (
      <Alert variant="crit">
        <AlertDescription>
          No pudimos cargar tus servicios. Probá de nuevo en un momento.
        </AlertDescription>
      </Alert>
    )
  }
  const ofDay = services.filter((service) => service.shiftDate === date)
  if (ofDay.length === 0) {
    return showEmpty ? (
      <EmptyState
        icon={CalendarX}
        title={`No tenés servicios el ${dayLabel(date)}`}
        description="Elegí otro día del calendario para ver tus servicios."
        className="mt-2"
      />
    ) : null
  }
  return (
    <section aria-label="Tus servicios del día" className="flex flex-col gap-2">
      {title && (
        <p className="text-[11px] font-semibold tracking-[0.4px] text-text-3 uppercase">
          {title}
        </p>
      )}
      {ofDay.map((assignment) => (
        <UpcomingRow key={assignment.assignmentId} assignment={assignment} />
      ))}
    </section>
  )
}
