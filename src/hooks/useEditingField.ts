import { useEffect, useState } from 'react'

const TEXT_INPUT_TYPES = new Set([
  'text',
  'search',
  'email',
  'tel',
  'url',
  'password',
  'number',
  'date',
  'time',
  'datetime-local',
  'month',
  'week',
])

/** Margen tras el `pointerup` para que se despache el `click`. */
const CLICK_GRACE_MS = 120
/** Tope de espera si el gesto no termina (pulsación larga). */
const MAX_HOLD_MS = 2000

function isEditable(el: Element | null): boolean {
  if (!(el instanceof HTMLElement)) return false
  if (el instanceof HTMLTextAreaElement) return true
  if (el instanceof HTMLInputElement) return TEXT_INPUT_TYPES.has(el.type)
  return el.isContentEditable === true
}

/**
 * `true` mientras el foco está en un campo de texto en un dispositivo táctil
 * (RESP-008): en ese momento el teclado virtual está abierto y ocupa la mitad
 * de la pantalla, así que las barras de navegación fijas al pie (tabbar) se
 * ocultan para no robarle espacio al formulario.
 *
 * Es una aproximación por foco, no una medición del teclado: funciona igual en
 * Chrome/Android y en Safari/iOS, que no coinciden en cómo exponen el teclado
 * (`visualViewport`, `interactive-widget`). Con un mouse (`pointer: fine`)
 * siempre devuelve `false`: no hay teclado virtual.
 *
 * La reaparición de la barra se difiere hasta que termina el gesto de puntero
 * que sacó el foco (ver `onFocusOut`), para no robarle el `click` al control
 * tocado cuando está junto al borde inferior.
 */
export function useEditingField(): boolean {
  const [editing, setEditing] = useState(false)

  useEffect(() => {
    const coarse = window.matchMedia?.('(pointer: coarse)')
    if (!coarse?.matches) return

    // Gesto de puntero en curso. El navegador quita el foco del campo en el
    // `pointerdown` sobre otro control; si la barra volviera a aparecer en ese
    // instante, empujaría el contenido y el `pointerup` caería sobre ella: el
    // control tocado nunca recibiría el `click`. Por eso, si el foco se pierde
    // con un gesto en curso, la reaparición espera a que termine (con margen
    // para que se despache el `click`).
    let pointerDown = false
    let timer: ReturnType<typeof setTimeout> | undefined

    let pendingStop: (() => void) | undefined

    const cancel = () => {
      if (timer !== undefined) clearTimeout(timer)
      timer = undefined
      pendingStop?.()
      pendingStop = undefined
    }
    const onPointerDown = () => {
      pointerDown = true
    }
    const onPointerEnd = () => {
      pointerDown = false
    }
    // Resuelve el estado según dónde quedó el foco (`next`). Un campo de texto
    // oculta la barra al instante; cualquier otra cosa la devuelve, pero si hay
    // un gesto en curso espera a que termine. Ojo: al tocar un botón con el
    // campo enfocado el navegador emite `focusout` (campo) y enseguida
    // `focusin` (botón); los dos pasan por acá.
    const settle = (next: Element | null) => {
      cancel()
      if (isEditable(next)) {
        setEditing(true)
        return
      }
      if (!pointerDown) {
        // Cierre por teclado, Enter, etc.: no hay gesto que proteger.
        setEditing(false)
        return
      }
      // Se libera tras el fin del gesto + margen para el `click`; el tope
      // evita que quede oculta si nunca llega un `pointerup`.
      const release = () => {
        cancel()
        setEditing(false)
      }
      const stopListening = () => {
        document.removeEventListener('pointerup', onEnd, true)
        document.removeEventListener('pointercancel', onEnd, true)
      }
      const onEnd = () => {
        stopListening()
        cancel()
        timer = setTimeout(release, CLICK_GRACE_MS)
      }
      document.addEventListener('pointerup', onEnd, true)
      document.addEventListener('pointercancel', onEnd, true)
      timer = setTimeout(() => {
        stopListening()
        release()
      }, MAX_HOLD_MS)
      pendingStop = stopListening
    }
    const onFocusIn = (e: FocusEvent) => settle(e.target as Element | null)
    // Al pasar de un campo a otro, `relatedTarget` ya es el nuevo: así la
    // barra no parpadea (se oculta y reaparece) entre los dos eventos.
    const onFocusOut = (e: FocusEvent) =>
      settle(e.relatedTarget as Element | null)
    document.addEventListener('pointerdown', onPointerDown, true)
    document.addEventListener('pointerup', onPointerEnd, true)
    document.addEventListener('pointercancel', onPointerEnd, true)
    document.addEventListener('focusin', onFocusIn)
    document.addEventListener('focusout', onFocusOut)
    return () => {
      cancel()
      document.removeEventListener('pointerdown', onPointerDown, true)
      document.removeEventListener('pointerup', onPointerEnd, true)
      document.removeEventListener('pointercancel', onPointerEnd, true)
      document.removeEventListener('focusin', onFocusIn)
      document.removeEventListener('focusout', onFocusOut)
    }
  }, [])

  return editing
}
