import { GeofenceMiniMap } from '@/components/map'
import { Skeleton } from '@/components/ui/skeleton'
import type { GeoRecordType } from '@/api/geo'
import { useAttendanceLocationQuery } from '../queries'

interface LocationMiniMapProps {
  recordType: GeoRecordType
  recordId: string
}

/**
 * Mini mapa de solo lectura (B-40): la sede con su radio vigente y el punto
 * del fichaje con su círculo de precisión. La posición se pide a
 * `get_attendance_location` (la única vía permitida para las coordenadas, junto
 * con `v_presence_today`) y solo cuando se abre el mapa.
 */
function LocationMiniMap({ recordType, recordId }: LocationMiniMapProps) {
  const query = useAttendanceLocationQuery(recordType, recordId)

  if (query.isLoading) {
    return <Skeleton className="h-[220px] w-full" />
  }
  if (query.error) {
    return (
      <p role="alert" className="text-[12px] text-danger-800">
        {query.error.message}
      </p>
    )
  }
  const location = query.data
  if (!location) {
    return null
  }
  if (location.siteLatitude == null || location.siteLongitude == null) {
    return (
      <p className="text-[12px] text-text-3">
        La sede no tiene coordenadas cargadas, así que no se puede dibujar el
        mapa.
      </p>
    )
  }
  if (location.latitude == null || location.longitude == null) {
    return (
      <p className="text-[12px] text-text-3">
        Este fichaje no tiene ubicación guardada.
      </p>
    )
  }

  return (
    <GeofenceMiniMap
      readOnly
      height={220}
      site={{
        lat: location.siteLatitude,
        lng: location.siteLongitude,
        radiusM: location.geofenceRadiusM ?? location.siteRadiusM ?? undefined,
        name: location.siteName,
      }}
      position={{
        lat: location.latitude,
        lng: location.longitude,
        accuracyM: location.accuracyM ?? 0,
      }}
      status={location.geoOverridden ? 'valid' : location.geoStatus}
    />
  )
}

export { LocationMiniMap }
