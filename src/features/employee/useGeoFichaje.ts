import { useMemo, useState } from 'react'
import {
  DEFAULT_WAIT_FOR_SIGNAL_MS,
  DEFAULT_GEOFENCE_RADIUS_M,
  useLivePosition,
  type LivePositionResult,
} from '@/lib/geo'
import {
  buildLiveGeoView,
  outsideReasonToSend,
  type LiveGeoView,
} from './liveGeo'

export interface UseGeoFichajeOptions {
  /** `true` solo con consentimiento vigente (B-38): sin él no se pide la ubicación. */
  enabled: boolean
  /** Coordenadas de la sede (de `v_my_day` / `v_my_supervisions`); `null` = sede sin coordenadas. */
  siteLatitude: number | null
  siteLongitude: number | null
  /** Radio vigente de la sede y tope de precisión que trae la vista. */
  radiusM: number | null
  maxAccuracyM: number | null
}

export interface GeoFichaje {
  live: LivePositionResult
  view: LiveGeoView
  /** Texto del campo «¿Por qué estás fuera de la zona?». */
  reasonText: string
  setReasonText: (text: string) => void
  /** Lo que se manda a la RPC: mejor posición y motivo (solo si corresponde). */
  payload: {
    coords: LiveGeoView['coords']
    outsideReason: string | null
  }
}

/**
 * Ubicación en vivo para fichar (módulo B1, B-06, B-38): `useLivePosition`
 * con el radio de la sede como precisión objetivo y 30 s de espera, más el
 * armado de lo que se ve y de lo que se manda a la RPC. Se apaga al salir de
 * la pantalla (lo hace `useLivePosition` al desmontar).
 */
export function useGeoFichaje({
  enabled,
  siteLatitude,
  siteLongitude,
  radiusM,
  maxAccuracyM,
}: UseGeoFichajeOptions): GeoFichaje {
  const live = useLivePosition({
    enabled,
    targetAccuracyM: radiusM ?? DEFAULT_GEOFENCE_RADIUS_M,
    waitMs: DEFAULT_WAIT_FOR_SIGNAL_MS,
  })
  const [reasonText, setReasonText] = useState('')

  const view = useMemo(
    () =>
      buildLiveGeoView({
        enabled,
        state: live.state,
        position: live.position,
        site:
          siteLatitude != null && siteLongitude != null
            ? { lat: siteLatitude, lng: siteLongitude }
            : null,
        radiusM,
        maxAccuracyM,
        wait: live.wait,
      }),
    [
      enabled,
      live.state,
      live.position,
      live.wait,
      siteLatitude,
      siteLongitude,
      radiusM,
      maxAccuracyM,
    ],
  )

  return {
    live,
    view,
    reasonText,
    setReasonText,
    payload: {
      coords: view.coords,
      outsideReason: outsideReasonToSend(view, reasonText),
    },
  }
}
