import * as React from 'react'
import { cn } from 'cn'
import { Skeleton } from '@/components/ui/skeleton'
import type { MapViewProps as LeafletMapViewProps } from './LeafletMapView'

export type MapViewProps = LeafletMapViewProps

/**
 * `MapView` (SITE-005): envoltorio con carga diferida de la implementación
 * real (`LeafletMapView.tsx`). Leaflet y `react-leaflet` quedan en un
 * `chunk` aparte que solo se descarga cuando efectivamente se monta un
 * mapa — el resto de la app (que ya importa este módulo desde `map/
 * index.ts` para tipar sus props) no paga ese peso si la ruta que la usa no
 * llega a renderizarse.
 */
const LazyLeafletMapView = React.lazy(() =>
  import('./LeafletMapView').then((mod) => ({ default: mod.MapView })),
)

function MapView(props: MapViewProps) {
  return (
    <React.Suspense
      fallback={
        <Skeleton
          className={cn('w-full', props.className)}
          style={{ height: props.height ?? 320 }}
        />
      }
    >
      <LazyLeafletMapView {...props} />
    </React.Suspense>
  )
}

export { MapView }
export type { MapViewMarker } from './LeafletMapView'
