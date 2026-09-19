import { Loader2 } from 'lucide-react'

/** `Suspense fallback` mientras se descarga el chunk de un shell (DS-015). */
export function RouteFallback() {
  return (
    <div
      role="status"
      aria-label="Cargando"
      className="grid min-h-dvh place-items-center bg-bg"
    >
      <Loader2
        aria-hidden="true"
        className="size-6 animate-spin text-primary"
      />
    </div>
  )
}
