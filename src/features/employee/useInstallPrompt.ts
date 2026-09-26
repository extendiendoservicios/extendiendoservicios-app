import { useEffect, useRef, useState } from 'react'

/**
 * `useInstallPrompt` (COM-06, MOB-EMP-013): captura el evento
 * `beforeinstallprompt` para saber si el navegador puede ofrecer instalar
 * la PWA. El banner de EMP-03/SUP-02 (COM-06) es de P13.3 — este paquete
 * solo necesita saber "está disponible sí/no" para mostrar u ocultar la
 * entrada "Instalar la app" de EMP-13 (Más), así que el hook se limita a
 * eso; P13.3 puede reusarlo tal cual para el banner (mismo `promptInstall`).
 *
 * `beforeinstallprompt` no es un evento estándar de DOM (no está en
 * `lib.dom.d.ts`): se tipa a mano con lo mínimo que se usa. Sin soporte en
 * Safari/iOS (ADR de PWA, `05` sección 1: "instrucciones para Android
 * (Chrome) e iOS (Safari)" en vez de este evento en ese caso) — el hook
 * simplemente nunca dispara `beforeinstallprompt` ahí, así que
 * `available` queda en `false` y la entrada de Más se oculta en iOS
 * (correcto: ahí no hay nada que "instalar con un botón").
 */
interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

export interface InstallPrompt {
  /** `true` si el navegador ofreció instalar la app y todavía no se resolvió. */
  available: boolean
  /** Muestra el diálogo nativo de instalación. No hace nada si `available` es `false`. */
  promptInstall: () => Promise<void>
}

export function useInstallPrompt(): InstallPrompt {
  const [available, setAvailable] = useState(false)
  const deferredEvent = useRef<BeforeInstallPromptEvent | null>(null)

  useEffect(() => {
    function onBeforeInstallPrompt(event: Event) {
      // El navegador no ofrece el mini-infobar propio a cambio de que la
      // app decida cuándo mostrar su propio botón (acá, la entrada de Más).
      event.preventDefault()
      deferredEvent.current = event as BeforeInstallPromptEvent
      setAvailable(true)
    }
    function onAppInstalled() {
      deferredEvent.current = null
      setAvailable(false)
    }

    window.addEventListener('beforeinstallprompt', onBeforeInstallPrompt)
    window.addEventListener('appinstalled', onAppInstalled)
    return () => {
      window.removeEventListener('beforeinstallprompt', onBeforeInstallPrompt)
      window.removeEventListener('appinstalled', onAppInstalled)
    }
  }, [])

  async function promptInstall() {
    const event = deferredEvent.current
    if (!event) return
    await event.prompt()
    await event.userChoice
    // Uno solo se puede usar una vez (la especificación lo descarta después
    // de `prompt()`): se limpia acá sin esperar a `appinstalled`, que no
    // llega si la persona lo rechaza.
    deferredEvent.current = null
    setAvailable(false)
  }

  return { available, promptInstall }
}
