import { supabase } from '@/lib/supabase'
import { fromPostgrestError } from './errors'

/**
 * `src/api/locationConsent.ts` (módulo B1, B-22): lo que el celular necesita
 * saber del consentimiento de ubicación. La persona guarda su consentimiento
 * en `profiles.location_consent_at`; la empresa marca cuándo cambió el texto
 * en `company_settings.location_consent_updated_at`. Si el texto cambió
 * después del consentimiento de la persona, hay que volver a mostrárselo
 * antes de fichar. `company_settings` la puede leer cualquier usuario
 * autenticado (RLS `company_settings_select_authenticated`), empleado y
 * supervisor incluidos, así que no hace falta nada nuevo en la base.
 */

export interface LocationConsentInfo {
  /** Cuándo cambió por última vez el texto del consentimiento; `null` si nunca se cambió. */
  consentUpdatedAt: string | null
}

export async function fetchLocationConsentInfo(): Promise<LocationConsentInfo> {
  const { data, error } = await supabase
    .from('company_settings')
    .select('location_consent_updated_at')
    .maybeSingle()

  if (error) {
    throw fromPostgrestError(error)
  }
  return { consentUpdatedAt: data?.location_consent_updated_at ?? null }
}

/**
 * Guarda el consentimiento propio (`profiles.location_consent_at`). Con
 * `at` se fija el instante; ver `consentTimestamp` para por qué no alcanza
 * con la hora del dispositivo.
 */
export async function saveLocationConsent(
  userId: string,
  at: string,
): Promise<void> {
  const { error } = await supabase
    .from('profiles')
    .update({ location_consent_at: at })
    .eq('id', userId)
  if (error) {
    throw fromPostgrestError(error)
  }
}

/** Retira el consentimiento propio (queda sin ubicación al fichar, como en el perfil). */
export async function revokeLocationConsent(userId: string): Promise<void> {
  const { error } = await supabase
    .from('profiles')
    .update({ location_consent_at: null })
    .eq('id', userId)
  if (error) {
    throw fromPostgrestError(error)
  }
}
