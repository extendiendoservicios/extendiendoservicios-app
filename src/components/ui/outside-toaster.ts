/**
 * DEF-P28-01: un toque en un aviso (Sonner) con una hoja o un diálogo modal
 * abierto cuenta, para Radix, como interacción «afuera» y cierra la hoja antes
 * de que el botón del aviso (por ejemplo «Ver turno») reciba el clic. Se pasa
 * como `onInteractOutside` del contenido modal para ignorar esos toques.
 */
export function ignoreToasterInteraction(event: {
  target: EventTarget | null
  preventDefault: () => void
}): void {
  const target = event.target
  if (target instanceof Element && target.closest('[data-sonner-toaster]')) {
    event.preventDefault()
  }
}
