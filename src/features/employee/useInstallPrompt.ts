import { useSyncExternalStore } from 'react'
import {
  isInstallPromptAvailable,
  promptInstall,
  subscribeInstallPrompt,
} from '@/lib/installPrompt'

/**
 * `useInstallPrompt` (COM-06, MOB-EMP-013, MOB-EMP-014): dice si el
 * navegador ofreció instalar la PWA, para el banner de Hoy y la entrada
 * "Instalar la app" de Más. El evento lo captura `src/lib/installPrompt.ts`
 * desde el arranque de la app (ver ahí por qué no alcanza con escucharlo
 * desde el componente).
 */
export interface InstallPrompt {
  /** `true` si el navegador ofreció instalar la app y todavía no se resolvió. */
  available: boolean
  /** Muestra el diálogo nativo de instalación. No hace nada si `available` es `false`. */
  promptInstall: () => Promise<void>
}

export function useInstallPrompt(): InstallPrompt {
  const available = useSyncExternalStore(
    subscribeInstallPrompt,
    isInstallPromptAvailable,
    () => false,
  )
  return { available, promptInstall }
}
