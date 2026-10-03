import { cn } from 'cn'
import { APP_VERSION } from '@/lib/appVersion'

/**
 * Número de versión visible (ADR-020): al pie de "Más" (empleado, supervisor
 * y administración en celular) y de la sidebar. Sirve para saber qué versión
 * está probando cada persona. Sin versión inyectada no muestra nada.
 */
export function AppVersion({ className }: { className?: string }) {
  if (!APP_VERSION) return null
  return (
    <p className={cn('text-center text-[11px] text-text-3', className)}>
      Versión {APP_VERSION}
    </p>
  )
}
