import { useEffect, useState } from 'react'
import { RefreshCw } from 'lucide-react'

/**
 * "Actualizado hace n s" (regla común de polling). Tercera copia del mismo
 * componente (`src/features/users/components/UpdatedAgo.tsx`,
 * `src/features/clients/components/UpdatedAgo.tsx`): con tres dominios que
 * ya lo necesitan, conviene subirlo a `src/components/` (pedido a
 * front-plataforma, ver el reporte del encargo) en vez de seguir
 * duplicándolo. Se duplica una vez más acá porque `src/components/` no es
 * de este dominio.
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
