import { brandingLogoUrl, useBranding } from '@/features/auth/useBranding'

/**
 * Barra de marca de las cabeceras de celular (P17.8): logo de la empresa y
 * "Extendiendo Servicios", teal, de 40 px (más el área segura de arriba).
 * Va encima de la cabecera de título y entre las dos forman un solo bloque
 * (ambas `bg-primary`, sin borde entre ellas).
 *
 * Se usa en los tres shells (`AdminShell` por debajo de 1024 px, y
 * `MobileShell`). Mismo logo que la sidebar de `AdminShell`: el cargado en
 * ADM-28 (`useBranding`) o, sin logo propio, el isotipo blanco de
 * `public/icons/`.
 *
 * Esta barra NO queda pegada al hacer scroll (se va con el contenido para no
 * comer 40 px de pantalla útil); lo único fijo de arriba es la cabecera de
 * título. Para que el contenido no se vea pasar por detrás de la muesca o la
 * barra de estado, un contenedor `sticky` de alto cero pinta siempre la
 * franja del área segura (`--safe-top`) en teal; la cabecera de título se
 * pega justo debajo (`top-[var(--safe-top)]`).
 */
export function MobileBrandBar() {
  const { branding } = useBranding()

  return (
    <>
      <div
        aria-hidden="true"
        className="sticky top-0 z-30 h-0 shrink-0 overflow-visible"
      >
        <div className="h-[var(--safe-top)] bg-primary" />
      </div>
      <div
        data-slot="brand-bar"
        className="flex h-[calc(40px+var(--safe-top))] shrink-0 items-center gap-2 bg-primary px-4 pt-[var(--safe-top)] text-white"
      >
        {branding?.logoPath ? (
          <img
            src={brandingLogoUrl(branding.logoPath)}
            alt=""
            className="h-6 w-auto shrink-0 object-contain"
          />
        ) : (
          <img
            src="/icons/isotipo_blanco_34px@2x.png"
            srcSet="/icons/isotipo_blanco_34px@2x.png 2x, /icons/isotipo_blanco_34px@3x.png 3x"
            alt=""
            className="h-6 w-auto shrink-0"
          />
        )}
        <span className="truncate text-[12px] font-bold tracking-[1.2px] uppercase">
          Extendiendo Servicios
        </span>
      </div>
    </>
  )
}
