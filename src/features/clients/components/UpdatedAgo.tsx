import { useEffect, useState } from 'react'
import { RefreshCw } from 'lucide-react'
import { secondsSince } from '@/lib/secondsSince'

/**
 * "Actualizado hace n s" (regla común de polling). Copia de
 * `src/features/users/components/UpdatedAgo.tsx` (ADM-27, primer uso):
 * ADM-19 es la segunda pantalla que lo necesita — el propio comentario de
 * ese componente ya avisaba que, llegado este caso, convenía subirlo a
 * `src/components/` (pedido a front-plataforma, ver el reporte del
 * encargo) en vez de duplicarlo. Se duplica igual acá porque `src/components/`
 * no es de este dominio.
 */
function useSecondsSince(timestampMs: number): number | null {
  const [nowMs, setNowMs] = useState(() => Date.now())

  useEffect(() => {
    const intervalId = setInterval(() => setNowMs(Date.now()), 1000)
    return () => clearInterval(intervalId)
  }, [])

  return secondsSince(nowMs, timestampMs)
}

function UpdatedAgo({ dataUpdatedAt }: { dataUpdatedAt: number }) {
  const secondsAgo = useSecondsSince(dataUpdatedAt)

  if (secondsAgo === null) {
    return null
  }

  return (
    <span className="inline-flex items-center gap-[5px] text-[11px] text-text-3">
      <RefreshCw aria-hidden="true" className="size-3" />
      Actualizado hace {secondsAgo}s
    </span>
  )
}

export { UpdatedAgo }
