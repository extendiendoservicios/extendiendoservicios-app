import { useState } from 'react'
import { monthOf, monthRange, upcomingBounds } from './dates'

/**
 * Estado del minicalendario de «Próximos días» (P32, D-05): el día elegido
 * (abre en mañana), el mes que se ve y el rango del mes que se le pide al
 * servidor (el servidor recorta a mañana..hoy + 60). «Mañana» sale de la hora
 * de Buenos Aires, no de la del dispositivo para decidir nada del negocio.
 */
export function useUpcomingDay() {
  const [bounds] = useState(() => upcomingBounds())
  const [selected, setSelected] = useState(bounds.min)
  const [month, setMonth] = useState(() => monthOf(bounds.min))
  const { from, to } = monthRange(month)

  /** Al cambiar de mes el día elegido pasa al primero elegible de ese mes: el detalle siempre es del mes que se ve. */
  function changeMonth(next: string) {
    setMonth(next)
    const first = monthRange(next).from
    setSelected(first < bounds.min ? bounds.min : first)
  }

  return {
    min: bounds.min,
    max: bounds.max,
    selected,
    setSelected,
    month,
    setMonth: changeMonth,
    from,
    to,
  }
}
