import { useEffect, useState } from 'react'
import type { MyWorkday } from '@/api/myWorkdays'
import { formatMinutes } from '@/lib/format'
import {
  anchorSecondsAt,
  formatClock,
  nextCounterAnchor,
  type WorkdayCounterAnchor,
} from '../workday'

interface WorkdayCounterProps {
  workday: MyWorkday
  /** Instante (reloj del dispositivo) de la última lectura del servidor. */
  readAtMs: number
}

/**
 * Contador `H:MM:SS` de la jornada (P24.7a). El tic de un segundo vive solo
 * acá, para no volver a dibujar toda la pantalla, y solo corre mientras la
 * jornada está en marcha. Se ancla a los minutos netos del servidor con cada
 * lectura nueva (`nextCounterAnchor`) y nunca retrocede por el redondeo.
 *
 * Para el lector de pantalla, el reloj visible va oculto y se lee un rótulo
 * que cambia una vez por minuto, sin `aria-live`.
 */
export function WorkdayCounter({ workday, readAtMs }: WorkdayCounterProps) {
  const running = workday.state === 'running'
  const [anchor, setAnchor] = useState<WorkdayCounterAnchor>(() =>
    nextCounterAnchor(null, workday, readAtMs),
  )
  const [lastRead, setLastRead] = useState({
    readAtMs,
    workedMinutes: workday.workedMinutes,
    state: workday.state,
  })
  // Con cada lectura nueva se reancla durante el render (sin efecto extra).
  if (
    lastRead.readAtMs !== readAtMs ||
    lastRead.workedMinutes !== workday.workedMinutes ||
    lastRead.state !== workday.state
  ) {
    setLastRead({
      readAtMs,
      workedMinutes: workday.workedMinutes,
      state: workday.state,
    })
    setAnchor(nextCounterAnchor(anchor, workday, readAtMs))
  }

  const [nowMs, setNowMs] = useState(() => Date.now())
  useEffect(() => {
    if (!running) return
    const id = setInterval(() => setNowMs(Date.now()), 1000)
    return () => clearInterval(id)
  }, [running])

  const seconds = anchorSecondsAt(anchor, nowMs)

  return (
    <>
      <p
        className="text-[26px] leading-tight font-bold text-text tabular-nums"
        data-testid="workday-counter"
        aria-hidden="true"
      >
        {formatClock(seconds)}
      </p>
      <span className="sr-only" data-testid="workday-counter-label">
        {formatMinutes(Math.floor(seconds / 60))} trabajados
      </span>
    </>
  )
}
