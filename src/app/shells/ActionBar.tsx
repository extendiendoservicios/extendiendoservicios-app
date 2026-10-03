import type { ReactNode } from 'react'
import { cn } from 'cn'

/**
 * `ActionBar` (DS-014): franja de acciones al pie de una subpágina móvil
 * (`.m-actions` de `Mockup/assets/ds.css` — botones apilados/en fila,
 * ancho completo, nota opcional debajo). Ejemplo real en el mockup: M16
 * "Volver al servicio" / "Registrar salida" con la nota "Se guardarán la
 * hora y la ubicación de salida" debajo.
 *
 * `MobileShell` no la monta: la pintan las pantallas de `front-movil` que
 * la necesiten (ninguna todavía — son placeholders), como el último
 * elemento de lo que devuelven. `MobileShell` deja scrollear al documento
 * (su `<main>` no es contenedor de scroll), así que `position: sticky;
 * bottom: 0` la pega al pie de la ventana sin un slot separado ni contexto
 * entre la página y el shell. Los márgenes negativos compensan el `p-4` del
 * `<main>` para que ocupe todo el ancho, como el pie del mockup.
 *
 * Respeta el área segura del celular (`env(safe-area-inset-*)`, `07`
 * sección 1.3) y, con el teclado virtual abierto, queda encima de él
 * (`interactive-widget=resizes-content` en `index.html`, RESP-008).
 */
export function ActionBar({
  children,
  note,
  className,
}: {
  /** Los botones (`Button size="mobile"`), ya apilados o en fila por quien la usa. */
  children: ReactNode
  note?: string
  className?: string
}) {
  return (
    <div
      className={cn(
        'sticky bottom-0 z-10 -mx-4 mt-auto -mb-4 flex shrink-0 flex-col gap-[9px] border-t border-border bg-surface px-4 pt-3',
        className,
      )}
      style={{
        // Área segura abajo (barra de inicio) y a los lados (muesca en
        // horizontal): los botones nunca quedan debajo de ellas (RESP-008).
        paddingBottom: 'max(18px, calc(var(--safe-bottom) + 12px))',
        paddingLeft: 'max(16px, var(--safe-left))',
        paddingRight: 'max(16px, var(--safe-right))',
      }}
    >
      {children}
      {note && (
        <p className="text-center text-[11px] leading-[1.4] text-text-3">
          {note}
        </p>
      )}
    </div>
  )
}
