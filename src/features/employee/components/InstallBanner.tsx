import { useState } from 'react'
import { Download, X } from 'lucide-react'
import {
  Alert,
  AlertActions,
  AlertDescription,
  AlertTitle,
} from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { IconButton } from '@/components/IconButton'
import { useInstallPrompt } from '@/features/employee/useInstallPrompt'
import {
  dismissInstallBanner,
  isInstallBannerDismissed,
} from '@/features/employee/installBannerDismiss'

/**
 * `InstallBanner` (COM-06, MOB-EMP-014, `05` fila COM-06): "Banner discreto
 * en EMP-03 y SUP-02 la primera vez; instrucciones para Android (Chrome) e
 * iOS (Safari)". Este paquete monta el banner en EMP-03 (`TodayPage`) --
 * SUP-02 (Hoy del supervisor) todavía no existe (F15).
 *
 * Dos variantes según el navegador, porque solo Chrome/Android disparan
 * `beforeinstallprompt` (`useInstallPrompt`, ver el comentario grande de ese
 * archivo): con el evento disponible, un botón que abre el diálogo nativo;
 * en Safari/iOS (sin el evento, y solo si no está ya instalada) un texto con
 * los pasos manuales. En cualquier otro navegador de escritorio, sin
 * `beforeinstallprompt` y sin ser iOS, no hay nada que ofrecer: no se
 * muestra nada.
 *
 * No aparece si la app ya corre instalada (`display-mode: standalone`, o
 * `navigator.standalone` en iOS) ni si la persona ya la cerró hace menos de
 * siete días (`installBannerDismiss.ts`).
 */
export function InstallBanner() {
  const { available, promptInstall } = useInstallPrompt()
  // Estado inicial perezoso (no un efecto): esta es una SPA que solo corre
  // en el navegador, `window`/`localStorage` ya están disponibles en el
  // primer render -- un efecto acá solo agregaría un repintado de más.
  const [dismissed, setDismissed] = useState(() =>
    isInstallBannerDismissed(new Date()),
  )
  const [standalone] = useState(isRunningStandalone)
  const [isIos] = useState(isIosDevice)

  if (standalone || dismissed) {
    return null
  }
  if (!available && !isIos) {
    return null
  }

  function handleDismiss() {
    dismissInstallBanner(new Date())
    setDismissed(true)
  }

  return (
    <Alert variant="info">
      <Download aria-hidden="true" />
      <div className="min-w-0 flex-1">
        <AlertTitle>Instalá la aplicación</AlertTitle>
        <AlertDescription>
          {available
            ? 'Agregala a tu pantalla de inicio para abrirla más rápido, como cualquier otra aplicación.'
            : 'Para agregarla a tu pantalla de inicio: tocá "Compartir" y después "Agregar a pantalla de inicio".'}
        </AlertDescription>
        {available && (
          <AlertActions>
            <Button size="sm" onClick={() => void promptInstall()}>
              Instalar
            </Button>
            <Button size="sm" variant="ghost" onClick={handleDismiss}>
              Ahora no
            </Button>
          </AlertActions>
        )}
      </div>
      {!available && (
        <IconButton
          icon={X}
          aria-label="Cerrar"
          onClick={handleDismiss}
          className="-m-1 shrink-0"
        />
      )}
    </Alert>
  )
}

function isRunningStandalone(): boolean {
  const nav = navigator as Navigator & { standalone?: boolean }
  return (
    window.matchMedia?.('(display-mode: standalone)').matches === true ||
    nav.standalone === true
  )
}

function isIosDevice(): boolean {
  return /iphone|ipad|ipod/i.test(navigator.userAgent)
}
