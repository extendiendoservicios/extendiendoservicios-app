import * as React from 'react'
import { cn } from 'cn'

/**
 * Tira que se desliza de costado (P17.3, RESP-003): para pestañas y
 * navegaciones que no entran a lo ancho en un celular.
 *
 * - Un degradé en el borde indica que hay más contenido, solo del lado donde
 *   está oculto (el izquierdo no se ve al principio, el derecho no se ve al
 *   final).
 * - El elemento elegido (`[aria-selected="true"]`, `[data-state="active"]` o
 *   `[aria-current="page"]`) se centra solo al montar y cada vez que cambia.
 *   Se desplaza la propia tira con `scrollTo`: nunca mueve la página.
 * - Con `prefers-reduced-motion` el desplazamiento es instantáneo.
 *
 * `useScrollFades` devuelve el `ref` que va en el contenedor con scroll y los
 * dos degradés para ponerlos como hermanos, dentro de un padre `relative`.
 */
const SELECTED_SELECTOR =
  '[aria-selected="true"], [data-state="active"], [aria-current="page"]'

const FADE_WIDTH_PX = 32

function useScrollFades<T extends HTMLElement>() {
  const ref = React.useRef<T>(null)
  const [fades, setFades] = React.useState({ start: false, end: false })

  React.useEffect(() => {
    const el = ref.current
    if (!el) return

    function update() {
      if (!el) return
      const max = el.scrollWidth - el.clientWidth
      const next = {
        start: el.scrollLeft > 1,
        end: max > 1 && el.scrollLeft < max - 1,
      }
      setFades((prev) =>
        prev.start === next.start && prev.end === next.end ? prev : next,
      )
    }

    function centerSelected(smooth: boolean) {
      if (!el) return
      const selected = el.querySelector<HTMLElement>(SELECTED_SELECTOR)
      if (!selected) return
      const elRect = el.getBoundingClientRect()
      const selRect = selected.getBoundingClientRect()
      const offset =
        selRect.left -
        elRect.left +
        el.scrollLeft -
        (elRect.width - selRect.width) / 2
      const reduced =
        typeof window.matchMedia === 'function' &&
        window.matchMedia('(prefers-reduced-motion: reduce)').matches
      if (typeof el.scrollTo !== 'function') return
      el.scrollTo({
        left: Math.max(0, offset),
        behavior: smooth && !reduced ? 'smooth' : 'auto',
      })
    }

    centerSelected(false)
    update()

    el.addEventListener('scroll', update, { passive: true })
    const resizeObserver =
      typeof ResizeObserver === 'undefined'
        ? null
        : new ResizeObserver(() => {
            update()
          })
    resizeObserver?.observe(el)
    const mutationObserver = new MutationObserver((mutations) => {
      const selectionChanged = mutations.some((m) => m.type === 'attributes')
      if (selectionChanged) centerSelected(true)
      update()
    })
    mutationObserver.observe(el, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ['aria-selected', 'data-state', 'aria-current'],
    })

    return () => {
      el.removeEventListener('scroll', update)
      resizeObserver?.disconnect()
      mutationObserver.disconnect()
    }
  }, [])

  return { ref, fades }
}

/** Degradés de los bordes; `fadeClassName` pone el color de fondo (`from-bg` por omisión). */
function ScrollFadeEdges({
  fades,
  fadeClassName = 'from-bg',
}: {
  fades: { start: boolean; end: boolean }
  fadeClassName?: string
}) {
  const base =
    'pointer-events-none absolute inset-y-0 z-10 to-transparent transition-opacity duration-150 motion-reduce:transition-none'
  return (
    <>
      <div
        aria-hidden="true"
        data-slot="scroll-fade-start"
        style={{ width: FADE_WIDTH_PX }}
        className={cn(
          base,
          'left-0 bg-gradient-to-r',
          fadeClassName,
          fades.start ? 'opacity-100' : 'opacity-0',
        )}
      />
      <div
        aria-hidden="true"
        data-slot="scroll-fade-end"
        style={{ width: FADE_WIDTH_PX }}
        className={cn(
          base,
          'right-0 bg-gradient-to-l',
          fadeClassName,
          fades.end ? 'opacity-100' : 'opacity-0',
        )}
      />
    </>
  )
}

export { useScrollFades, ScrollFadeEdges }
