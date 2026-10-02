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
 */
export function useEditingField(): boolean {
  const [editing, setEditing] = useState(false)

  useEffect(() => {
    const coarse = window.matchMedia?.('(pointer: coarse)')
    if (!coarse?.matches) return

    const onFocusIn = (e: FocusEvent) => {
      setEditing(isEditable(e.target as Element | null))
    }
    // Al pasar de un campo a otro, `relatedTarget` ya es el nuevo: así la
    // barra no parpadea (se oculta y reaparece) entre los dos eventos.
    const onFocusOut = (e: FocusEvent) => {
      setEditing(isEditable(e.relatedTarget as Element | null))
    }
    document.addEventListener('focusin', onFocusIn)
    document.addEventListener('focusout', onFocusOut)
    return () => {
      document.removeEventListener('focusin', onFocusIn)
      document.removeEventListener('focusout', onFocusOut)
    }
  }, [])

  return editing
}
