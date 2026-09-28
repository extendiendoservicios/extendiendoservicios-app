import { useEffect, useState } from 'react'
import { RefreshCw } from 'lucide-react'

/**
 * "Actualizado hace n s" (regla común de polling, ADM-13). Copia de
 * `src/features/attendance/components/UpdatedAgo.tsx` -- `src/components/`
 * no es de este dominio, mismo criterio documentado ahí (pedido pendiente a
 * front-plataforma de subirlo a un lugar compartido).
 */
function useSecondsSince(timestampMs: number): number {
  const [nowMs, setNowMs] = useState(() => Date.now())

  useEffect(() => {
    const intervalId = setInterval(() => setNowMs(Date.now()), 1000)
    return () => clearInterval(intervalId)
  }, [])

  return Math.max(0, Math.round((nowMs - timestampMs) / 1000))
}

function UpdatedAgo({ dataUpdatedAt }: { dataUpdatedAt: number }) {
  const secondsAgo = useSecondsSince(dataUpdatedAt)

  return (
    <span className="inline-flex items-center gap-[5px] text-[11px] text-text-3">
      <RefreshCw aria-hidden="true" className="size-3" />
      Actualizado hace {secondsAgo}s
    </span>
  )
}

export { UpdatedAgo }
