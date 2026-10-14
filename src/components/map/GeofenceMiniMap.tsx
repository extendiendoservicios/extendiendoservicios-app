import * as React from 'react'
import { cn } from 'cn'
import { Skeleton } from '@/components/ui/skeleton'
import type { LeafletGeofenceMiniMapProps } from './LeafletGeofenceMiniMap'

export type GeofenceMiniMapProps = LeafletGeofenceMiniMapProps
export type { GeofenceMiniMapSite } from './LeafletGeofenceMiniMap'

/**
 * `GeofenceMiniMap` (módulo B1, B-18): mini mapa de fichaje. Envoltorio con
 * carga diferida de la implementación real (`LeafletGeofenceMiniMap.tsx`),
 * igual que `MapView`/`MapPicker`: Leaflet recién se descarga cuando se monta.
 */
const LazyLeafletGeofenceMiniMap = React.lazy(() =>
  import('./LeafletGeofenceMiniMap').then((mod) => ({
    default: mod.GeofenceMiniMap,
  })),
)

function GeofenceMiniMap(props: GeofenceMiniMapProps) {
  return (
    <React.Suspense
      fallback={
        <Skeleton
          className={cn('w-full', props.className)}
          style={{ height: props.height ?? 240 }}
        />
      }
    >
      <LazyLeafletGeofenceMiniMap {...props} />
    </React.Suspense>
  )
}

export { GeofenceMiniMap }
