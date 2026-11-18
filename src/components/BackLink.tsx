import * as React from 'react'
import { Link } from 'react-router'
import { useBackTo } from '@/app/shells/backNavigation'

/**
 * Enlace «Volver» (OH-03): regresa a la página anterior de la app tal como
 * estaba (con su mes, vista y filtros) y, si la persona entró directo por la
 * dirección, va a `fallback`. Se ve y se enfoca como un enlace común (`href`
 * al respaldo: «abrir en otra pestaña» sigue andando) y sirve con `asChild`
 * de `Button`:
 *
 *   <Button asChild variant="ghost"><BackLink fallback="/admin/insumos">Volver a Insumos</BackLink></Button>
 */
function BackLink({
  fallback,
  onClick,
  ...props
}: Omit<React.ComponentProps<typeof Link>, 'to'> & {
  /** Ruta si no hay página anterior de la app. */
  fallback: string
}) {
  const goBack = useBackTo(fallback)

  return (
    <Link
      to={fallback}
      onClick={(event) => {
        onClick?.(event)
        if (
          event.defaultPrevented ||
          event.button !== 0 ||
          event.metaKey ||
          event.ctrlKey ||
          event.shiftKey ||
          event.altKey
        ) {
          return
        }
        event.preventDefault()
        goBack()
      }}
      {...props}
    />
  )
}

export { BackLink }
