/**
 * Captura de `beforeinstallprompt` al arrancar la app (COM-06, MOB-EMP-014).
 *
 * Chrome dispara ese evento una sola vez por carga de página, apenas la
 * página cumple los requisitos de instalación. Si solo lo escucha un
 * componente (el banner de Hoy o la entrada de Más), el evento se pierde
 * cuando la persona entra por otra pantalla, por ejemplo el inicio de
 * sesión, o cuando Hoy todavía está cargando: pasó en la prueba en un
 * Android real (MOB-EMP-018, 26 sep 2026), donde el banner nunca apareció.
 * Por eso se escucha desde `main.tsx`, antes de montar React, y los
 * componentes leen el estado con `useInstallPrompt`.
 *
 * `beforeinstallprompt` no es estándar (no está en `lib.dom.d.ts`) y no
 * existe en Safari/iOS: ahí `available` queda siempre en `false`.
 */
export interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

let deferredEvent: BeforeInstallPromptEvent | null = null
let started = false
const listeners = new Set<() => void>()

function notify() {
  for (const listener of listeners) listener()
}

function onBeforeInstallPrompt(event: Event) {
  // Sin el mini-infobar propio de Chrome: la app decide cuándo ofrecerlo.
  event.preventDefault()
  deferredEvent = event as BeforeInstallPromptEvent
  notify()
}

function onAppInstalled() {
  deferredEvent = null
  notify()
}

/** Empieza a escuchar. Se llama una vez desde `main.tsx`; repetirla no hace nada. */
export function startInstallPromptCapture() {
  if (started || typeof window === 'undefined') return
  started = true
  window.addEventListener('beforeinstallprompt', onBeforeInstallPrompt)
  window.addEventListener('appinstalled', onAppInstalled)
}

export function subscribeInstallPrompt(listener: () => void) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function isInstallPromptAvailable() {
  return deferredEvent !== null
}

/** Muestra el diálogo nativo. No hace nada si el navegador no lo ofreció. */
export async function promptInstall() {
  const event = deferredEvent
  if (!event) return
  await event.prompt()
  await event.userChoice
  // El evento sirve una sola vez: se descarta sin esperar a `appinstalled`,
  // que no llega si la persona lo rechaza.
  deferredEvent = null
  notify()
}

/** Solo para tests: vuelve al estado inicial y deja de escuchar. */
export function resetInstallPromptForTests() {
  if (typeof window !== 'undefined') {
    window.removeEventListener('beforeinstallprompt', onBeforeInstallPrompt)
    window.removeEventListener('appinstalled', onAppInstalled)
  }
  deferredEvent = null
  started = false
  listeners.clear()
}
