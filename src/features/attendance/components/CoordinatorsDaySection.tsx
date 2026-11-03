import { CoordinatorCards } from '@/features/workdays/components/CoordinatorCards'

/**
 * Sección «Coordinadores» de «Asistencia de hoy» (ADM-10, P24.4, OD-04): una
 * tarjeta por coordinador con su estado (CJ-33), el inicio de la jornada,
 * cada pausa, la supervisión en curso y las horas netas, más «Ver actividad»
 * y «Finalizar jornada» (OD-06). Hoy se refresca cada 60 s; en otras fechas
 * muestra las jornadas de ese día.
 */
function CoordinatorsDaySection({
  date,
  isToday,
}: {
  date: string
  isToday: boolean
}) {
  return (
    <section aria-label="Coordinadores" className="flex flex-col gap-2">
      <h2 className="text-[15px] font-semibold text-text">Coordinadores</h2>
      <CoordinatorCards date={date} isToday={isToday} />
    </section>
  )
}

export { CoordinatorsDaySection }
