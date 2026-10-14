import { useQuery } from '@tanstack/react-query'
import { fetchLocationConsentInfo } from '@/api/locationConsent'
import { useAuth } from '@/features/auth/AuthProvider'
import { hasDeclinedLocation } from './locationChoice'
import {
  isConsentStale,
  resolveLocationConsent,
  type LocationConsentStatus,
} from './locationConsent'

export interface LocationConsentState {
  status: LocationConsentStatus
  /** `true` mientras falta saber cuándo cambió el texto (solo importa si la persona ya había consentido). */
  loading: boolean
  /** La persona ya había consentido y el texto cambió después (B-22): hay que mostrárselo de nuevo. */
  reconsent: boolean
  /** Cuándo cambió el texto por última vez. */
  consentUpdatedAt: string | null
}

/**
 * Estado del consentimiento de ubicación de quien está logueado (B-22). Si la
 * lectura de `company_settings` falla, se sigue con el consentimiento que
 * hay: nunca bloquea el fichaje.
 */
export function useLocationConsent(): LocationConsentState {
  const auth = useAuth()
  const consentAt = auth.profile?.locationConsentAt ?? null
  const { data, isLoading } = useQuery({
    queryKey: ['employee', 'locationConsent'],
    queryFn: fetchLocationConsentInfo,
    enabled: consentAt != null,
  })
  const consentUpdatedAt = data?.consentUpdatedAt ?? null
  const status = resolveLocationConsent({
    consentAt,
    consentUpdatedAt,
    declined: hasDeclinedLocation(auth.userId),
  })
  return {
    status,
    loading: consentAt != null && isLoading,
    reconsent: isConsentStale(consentAt, consentUpdatedAt),
    consentUpdatedAt,
  }
}
