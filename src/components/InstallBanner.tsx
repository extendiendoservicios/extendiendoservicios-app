import { useState } from 'react'
import { Download, X } from 'lucide-react'
import { currentIosInstallMode } from '@/lib/iosInstall'
import {
  Alert,
  AlertActions,
  AlertDescription,
  AlertTitle,
} from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { IconButton } from '@/components/IconButton'
import { useInstallPrompt } from '@/hooks/useInstallPrompt'
import {
  dismissInstallBanner,
  isInstallBannerDismissed,
} from '@/lib/installBannerDismiss'

/**
 * `InstallBanner` (COM-06, MOB-EMP-014, `05` fila COM-06): "Banner discreto
 * en EMP-03, SUP-02 y ADM-02 la primera vez; instrucciones para Android
 * (Chrome) e iOS (Safari)". Lo montan `TodayPage` del empleado y del
 * supervisor y, desde RESP-004 (decisión de Mike del 26 sep 2026), el
 * `AdminShell` en el inicio de administración, solo en celular. Vive en
 * `src/components/` (y no en `features/employee/`) porque lo comparten las
 * tres vías.
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
export function InstallBanner({ className }: { className?: string } = {}) {
  const { available, promptInstall } = useInstallPrompt()
  // Estado inicial perezoso (no un efecto): esta es una SPA que solo corre
  // en el navegador, `window`/`localStorage` ya están disponibles en el
  // primer render -- un efecto acá solo agregaría un repintado de más.
  const [dismissed, setDismissed] = useState(() =>
    isInstallBannerDismissed(new Date()),
  )
  const [standalone] = useState(isRunningStandalone)
  const [iosMode] = useState(currentIosInstallMode)
  const [copied, setCopied] = useState(false)
  const isIos = iosMode !== 'not-ios'

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

  async function handleCopyLink() {
    try {
      await navigator.clipboard.writeText(window.location.href)
      setCopied(true)
    } catch {
      // Sin permiso para copiar: no se muestra una confirmación falsa.
      setCopied(false)
    }
  }

  // iPhone con Chrome, Firefox, Edge o el navegador de WhatsApp/Instagram/
  // Facebook: solo Safari puede agregar la app (OF-09).
  if (!available && iosMode === 'other-browser') {
    return (
      <Alert variant="info" className={className}>
        <Download aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <AlertTitle>Instalá la aplicación</AlertTitle>
          <AlertDescription>
            Para instalar la app, abrí este enlace en Safari.
          </AlertDescription>
          <AlertActions>
            <Button size="sm" onClick={() => void handleCopyLink()}>
              Copiar enlace
            </Button>
            {copied && (
              <span role="status" className="text-xs">
                Enlace copiado. Pegalo en Safari.
              </span>
            )}
          </AlertActions>
        </div>
        <IconButton
          icon={X}
          aria-label="Cerrar"
          onClick={handleDismiss}
          className="-m-1 shrink-0"
        />
      </Alert>
    )
  }

  return (
    <Alert variant="info" className={className}>
      <Download aria-hidden="true" />
      <div className="min-w-0 flex-1">
        <AlertTitle>Instalá la aplicación</AlertTitle>
        <AlertDescription>
          {available
            ? 'Agregala a tu pantalla de inicio para abrirla más rápido, como cualquier otra aplicación.'
            : 'Para agregarla a tu pantalla de inicio, seguí estos pasos:'}
        </AlertDescription>
        {!available && (
          <ol className="mt-2 list-decimal space-y-1 pl-5 text-xs">
            <li>
              Tocá el botón Compartir{' '}
              <ShareIcon className="inline-block size-4 align-text-bottom" /> de
              Safari (abajo en el medio de la pantalla).
            </li>
            <li>Deslizá hacia arriba y tocá «Agregar a pantalla de inicio».</li>
            <li>Tocá «Agregar», arriba a la derecha.</li>
          </ol>
        )}
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

/** Ícono de Compartir de iOS (cuadrado abierto con flecha hacia arriba), dibujado a mano. */
function ShareIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      role="img"
      aria-label="Compartir"
      className={className}
    >
      <path d="M12 15V3" />
      <path d="m8 7 4-4 4 4" />
      <path d="M8 11H7a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-6a2 2 0 0 0-2-2h-1" />
    </svg>
  )
}
