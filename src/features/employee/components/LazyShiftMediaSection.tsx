import { lazy, Suspense } from 'react'
import { Skeleton } from '@/components/ui/skeleton'
import type { ShiftMediaSectionProps } from './ShiftMediaSection'

const ShiftMediaSection = lazy(() =>
  import('./ShiftMediaSection').then((module) => ({
    default: module.ShiftMediaSection,
  })),
)

/**
 * `ShiftMediaSection` cargado en diferido (módulo H, P21.3): el bloque de
 * fotos y videos arrastra el visor y la captura, y no hace falta para pintar
 * el resto de la pantalla. Mientras baja se reserva el lugar con un esqueleto
 * para que el contenido no salte.
 */
export function LazyShiftMediaSection(props: ShiftMediaSectionProps) {
  return (
    <Suspense
      fallback={
        <Skeleton className="h-40 w-full rounded-xl" aria-hidden="true" />
      }
    >
      <ShiftMediaSection {...props} />
    </Suspense>
  )
}
