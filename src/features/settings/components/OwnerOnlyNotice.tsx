import { ShieldAlert } from 'lucide-react'
import { EmptyState } from '@/components/EmptyState'

/**
 * Aviso para quien entra a una pantalla solo del dueño (ADM-29, ADM-30,
 * ADM-31) sin serlo -- ver el comentario de `canViewOwnerOnlyConfig` en
 * `permissions.ts`. No debería ocurrir desde la navegación normal (la
 * pestaña ni siquiera aparece para un administrador en `ConfigNav`), pero
 * cubre el caso de una URL escrita a mano.
 */
function OwnerOnlyNotice() {
  return (
    <EmptyState
      icon={ShieldAlert}
      title="Esta sección es solo para el dueño de la cuenta"
      description="Si necesitás algo de acá, pedíselo al dueño."
    />
  )
}

export { OwnerOnlyNotice }
