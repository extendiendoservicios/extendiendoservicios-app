import { useEffect, useState } from 'react'
import { RefreshCw } from 'lucide-react'
import { secondsSince } from '@/lib/secondsSince'

/**
 * "Actualizado hace n s" (regla común de polling). Copia de
 * `src/features/users/components/UpdatedAgo.tsx` (ADM-27, primer uso) y de
 * `src/features/clients/components/UpdatedAgo.tsx` (ADM-19, segunda vez) --
 * ADM-05 es la tercera pantalla que lo necesita. Sigue en pie el pedido a
 * front-plataforma de subirlo a `src/components/` (ver el reporte del
 * encargo): se duplica de nuevo porque `src/components/` no es de este
 * dominio.
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
