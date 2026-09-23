import { RefreshCw } from 'lucide-react'
import { cn } from 'cn'
import {
  Alert,
  AlertActions,
  AlertDescription,
  AlertTitle,
} from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { usePwaUpdate } from '@/app/PwaUpdateProvider'

/**
 * Aviso "hay una versión nueva" (RESP-009). Lo montan `AdminShell` y
 * `MobileShell` (los tres shells: administración, empleado y supervisor),
 * cada uno posicionándolo justo por encima de su propia tabbar (o del borde
 * inferior, si esa vía no tiene tabbar en ese momento) para que nunca tape
 * ni la navegación ni el FAB "Fichar" -- ver el comentario de cada shell
 * para el offset exacto.
 *
 * No interrumpe: no es un modal, no recarga sola, y usa `Alert` (DS-010),
 * el mismo componente que ya se usa para avisos en línea dentro de una
 * pantalla, en vez de agregar uno nuevo -- encaja tal cual con
 * título + texto + acciones (`AlertActions`). Se puede posponer
 * (`postpone`, `usePwaUpdate`) y no reaparece sola: solo cuando
 * `usePwaUpdate` detecta una actualización (la misma pospuesta reaparece
 * recién al reabrir la aplicación, si para entonces seguía esperando; una
 * más nueva todavía la reemplaza al toque, ver `PwaUpdateProvider.tsx`).
 *
 * `role="status"` en vez del `role="alert"` (asertivo) que trae `Alert` por
 * defecto -- se puede pisar así porque `Alert` pasa `...props` después de
 * fijar el suyo (`ui/alert.tsx`): esto es un aviso informativo y de baja
 * urgencia, no un error, y no tiene por qué interrumpir a quien usa lector
 * de pantalla en medio de otra tarea (decisión menor, ver el reporte).
 */
export function PwaUpdateBanner({ className }: { className?: string }) {
  const { needRefresh, applying, applyUpdate, postpone } = usePwaUpdate()

  if (!needRefresh) return null

  return (
    <div className={cn('px-3 pb-2', className)}>
      <Alert
        variant="info"
        role="status"
        className="mx-auto max-w-[452px] shadow-card"
      >
        <RefreshCw aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <AlertTitle>Hay una versión nueva de la aplicación</AlertTitle>
          <AlertDescription>
            Se va a reiniciar para aplicarla. Podés hacerlo ahora o dejarlo para
            más tarde.
          </AlertDescription>
          <AlertActions>
            <Button size="sm" onClick={applyUpdate} loading={applying}>
              Actualizar ahora
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={postpone}
              disabled={applying}
            >
              Más tarde
            </Button>
          </AlertActions>
        </div>
      </Alert>
    </div>
  )
}
