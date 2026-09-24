import * as React from 'react'
import { cn } from 'cn'
import { Skeleton } from '@/components/ui/skeleton'
import type { MapPickerProps as LeafletMapPickerProps } from './LeafletMapPicker'

export type MapPickerProps = LeafletMapPickerProps

/**
 * `MapPicker` (SITE-004): envoltorio con carga diferida de la
 * implementación real (`LeafletMapPicker.tsx`), mismo motivo que
 * `MapView.tsx` — Leaflet solo se descarga en la ruta que efectivamente
 * muestra un mapa (el formulario de sede, ADM-20).
 */
const LazyLeafletMapPicker = React.lazy(() =>
  import('./LeafletMapPicker').then((mod) => ({ default: mod.MapPicker })),
)

function MapPicker(props: MapPickerProps) {
  return (
    <React.Suspense
      fallback={
        <Skeleton
          className={cn('w-full', props.className)}
          style={{ height: props.height ?? 320 }}
        />
      }
    >
      <LazyLeafletMapPicker {...props} />
    </React.Suspense>
  )
}

export { MapPicker }
