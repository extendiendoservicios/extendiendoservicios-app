import { supabase } from '@/lib/supabase'
import { fromPostgrestError } from './errors'

/**
 * `src/api/locationConsent.ts` (módulo B1, B-22): lo que el celular necesita
 * saber del consentimiento de ubicación. La persona guarda su consentimiento
 * en `profiles.location_consent_at` (por RPC, con la hora del servidor); la empresa marca cuándo cambió el texto
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
 * Guarda el consentimiento propio con la hora del servidor (RPC
 * `accept_location_consent`, 0056): `profiles.location_consent_at = now()`
 * para quien llama. La hora del dispositivo no interviene. Devuelve el
 * instante guardado.
 */
export async function saveLocationConsent(): Promise<string> {
  const { data, error } = await supabase.rpc('accept_location_consent')
  if (error) {
    throw fromPostgrestError(error)
  }
  return data
}

/** Retira el consentimiento propio (RPC `revoke_location_consent`, 0056): queda sin ubicación al fichar. */
export async function revokeLocationConsent(): Promise<void> {
  const { error } = await supabase.rpc('revoke_location_consent')
  if (error) {
    throw fromPostgrestError(error)
  }
}
