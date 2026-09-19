import { TriangleAlert } from 'lucide-react'

/**
 * Banner "Entorno de prueba" (INFRA-022): franja visible en los tres
 * shells y en la portada cuando `VITE_APP_ENV=staging`. No aparece en
 * `production` ni en `local` (`import.meta.env.VITE_APP_ENV`,
 * `docs/environments.md`).
 *
 * Vive en `RootLayout` (`src/app/router.tsx`), por encima de cualquier
 * shell: un único punto de montaje para que "todos los layouts, incluida
 * la portada" lo muestren sin que cada uno tenga que acordarse de
 * incluirlo. En flujo normal del documento (no `sticky`/`fixed`): nunca
 * tapa contenido, a costo de dejar de verse si la página scrollea — para
 * una franja informativa de solo lectura es la opción más simple y sin
 * riesgo de superponerse a la topbar/cabecera de cada shell (con sus
 * propios `z-index`).
 */
export function StagingBanner() {
  if (import.meta.env.VITE_APP_ENV !== 'staging') {
    return null
  }

  return (
    <div
      role="status"
      className="flex items-center justify-center gap-[7px] bg-warning-bg px-4 py-[6px] text-center text-[11px] font-semibold text-warning-800"
    >
      <TriangleAlert aria-hidden="true" className="size-[13px] shrink-0" />
      Entorno de prueba: los datos de esta versión no son reales.
    </div>
  )
}
