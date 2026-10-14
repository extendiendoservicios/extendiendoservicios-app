import { useEffect, useState } from 'react'
import { RefreshCw } from 'lucide-react'
import { secondsSince } from '@/lib/secondsSince'

/**
 * "Actualizado hace n s" (regla común de polling: "indicador de 'actualizado
 * hace n s' donde hay polling"). Primer uso de TanStack Query del repo con
 * `refetchInterval` (ADM-27, USERS-008) -- vive acá porque hoy es la única
 * pantalla que lo necesita; si una próxima pantalla ADM con polling
 * necesita este mismo indicador, conviene subirlo a `src/components/`
 * (pedido pendiente a front-plataforma, ver el reporte del encargo).
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
