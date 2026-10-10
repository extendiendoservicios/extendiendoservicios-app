import { useEffect } from 'react'
import { useRouteError } from 'react-router'
import { Button } from '@/components/ui/button'
import { reloadAfterChunkError } from '@/app/routes/lazyPage'

/**
 * `errorElement` de la ruta raíz: reemplaza la pantalla por defecto de React
 * Router (en inglés, con el stack) cuando algo falla al cargar o mostrar una
 * pantalla.
 *
 * El caso típico es un despliegue con la app abierta: el chunk de la versión
 * anterior ya no existe. `lazyPage` recarga una vez; si el chunk sigue sin
 * llegar (el despliegue todavía no terminó), se llega acá y se ofrece
 * recargar a mano.
 */
export function RouteErrorPage() {
  const error = useRouteError()
  const isChunkError = isChunkLoadError(error)

  useEffect(() => {
    // Si el error llegó por otra vía (p. ej. un import dinámico fuera de
    // `lazyPage`), todavía se intenta la recarga automática una vez.
    if (isChunkError) reloadAfterChunkError()
  }, [isChunkError])

  return (
    <div className="grid min-h-dvh place-items-center bg-bg p-6">
      <div className="flex w-full max-w-sm flex-col items-center gap-4 text-center">
        <img
          src="/favicon.png"
          alt="Extendiendo Servicios"
          className="size-14"
        />
        <div>
          <h1 className="text-[17px] font-semibold text-text">
            {isChunkError
              ? 'Hay una versión nueva de la app'
              : 'Algo salió mal al abrir esta pantalla'}
          </h1>
          <p className="mt-1 text-[13px] text-text-2">
            {isChunkError
              ? 'Recargá la página para seguir. Si no carga, esperá unos segundos y probá de nuevo.'
              : 'Recargá la página. Si vuelve a pasar, avisale a la oficina.'}
          </p>
        </div>
        <Button onClick={() => window.location.reload()}>Recargar</Button>
      </div>
    </div>
  )
}

/** Error de import dinámico (chunk que no existe o no llegó). */
export function isChunkLoadError(error: unknown): boolean {
  const message =
    error instanceof Error
      ? error.message
      : typeof error === 'string'
        ? error
        : ''
  return /dynamically imported module|Importing a module script failed|error loading dynamically imported module|Failed to fetch/i.test(
    message,
  )
}
