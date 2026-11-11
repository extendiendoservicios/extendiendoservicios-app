import * as React from 'react'

/**
 * Pantalla completa del mapa (OF-13b, P28.2).
 *
 * Usa la Fullscreen API sobre el contenedor del mapa. Donde no existe (iPhone
 * Safari no la ofrece para elementos que no son `<video>`) cae a una
 * alternativa CSS: el contenedor pasa a `position: fixed` cubriendo toda la
 * pantalla. En los dos modos salen Esc y el mismo botón.
 */

type FullscreenElement = HTMLElement & {
  webkitRequestFullscreen?: () => Promise<void> | void
}
type FullscreenDocument = Document & {
  webkitFullscreenElement?: Element | null
  webkitExitFullscreen?: () => Promise<void> | void
}

/** ¿Este navegador puede poner el elemento en pantalla completa de verdad? */
export function supportsNativeFullscreen(
  element: HTMLElement | null,
  doc: Document = document,
): boolean {
  if (!element) return false
  const el = element as FullscreenElement
  const hasRequest =
    typeof el.requestFullscreen === 'function' ||
    typeof el.webkitRequestFullscreen === 'function'
  return hasRequest && (doc as FullscreenDocument).fullscreenEnabled !== false
}

function nativeElement(doc: Document): Element | null {
  return (
    doc.fullscreenElement ??
    (doc as FullscreenDocument).webkitFullscreenElement ??
    null
  )
}

export function useMapFullscreen(
  containerRef: React.RefObject<HTMLElement | null>,
) {
  const [nativeActive, setNativeActive] = React.useState(false)
  const [overlayActive, setOverlayActive] = React.useState(false)
  const active = nativeActive || overlayActive

  // Sincroniza con la API nativa (incluye la salida con Esc del navegador).
  React.useEffect(() => {
    function sync() {
      setNativeActive(
        nativeElement(document) !== null &&
          nativeElement(document) === containerRef.current,
      )
    }
    document.addEventListener('fullscreenchange', sync)
    document.addEventListener('webkitfullscreenchange', sync)
    return () => {
      document.removeEventListener('fullscreenchange', sync)
      document.removeEventListener('webkitfullscreenchange', sync)
    }
  }, [containerRef])

  // Alternativa CSS: Esc sale y se bloquea el desplazamiento de la página.
  React.useEffect(() => {
    if (!overlayActive) return
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') setOverlayActive(false)
    }
    document.addEventListener('keydown', onKeyDown)
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      document.body.style.overflow = previousOverflow
    }
  }, [overlayActive])

  const toggle = React.useCallback(async () => {
    const element: FullscreenElement | null = containerRef.current
    if (!element) return

    if (overlayActive) {
      setOverlayActive(false)
      return
    }
    if (nativeActive) {
      const doc = document as FullscreenDocument
      if (doc.exitFullscreen) await doc.exitFullscreen()
      else await doc.webkitExitFullscreen?.()
      return
    }

    if (supportsNativeFullscreen(element)) {
      try {
        if (element.requestFullscreen) await element.requestFullscreen()
        else await element.webkitRequestFullscreen?.()
        return
      } catch {
        // El navegador la rechazó (permisos, iframe): se usa la alternativa CSS.
      }
    }
    setOverlayActive(true)
  }, [containerRef, nativeActive, overlayActive])

  return { active, overlayActive, toggle }
}
