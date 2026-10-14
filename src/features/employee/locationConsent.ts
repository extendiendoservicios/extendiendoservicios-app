/**
 * Consentimiento de ubicación (EMP-06, ADR-009, módulo B1 B-22): lógica pura
 * para decidir si hay que (volver a) mostrar el texto antes de fichar.
 *
 * Regla de B-22: cuando la empresa cambia el texto del consentimiento
 * (`company_settings.location_consent_updated_at`), la app lo vuelve a
 * mostrar la próxima vez que cada persona ficha. Se nota porque el cambio
 * del texto es posterior al consentimiento guardado de la persona
 * (`profiles.location_consent_at`).
 */

export type LocationConsentStatus =
  /** Hay consentimiento vigente: se puede pedir la ubicación. */
  | 'granted'
  /** Hay que mostrar EMP-06: nunca decidió o el texto cambió después de su consentimiento. */
  | 'needs-consent'
  /** Eligió «Continuar sin ubicación» en este dispositivo: se ficha sin pedirla. */
  | 'declined'

export interface LocationConsentInput {
  /** `profiles.location_consent_at`. */
  consentAt: string | null | undefined
  /** `company_settings.location_consent_updated_at`. */
  consentUpdatedAt: string | null | undefined
  /** Eligió seguir sin ubicación (`hasDeclinedLocation`). */
  declined: boolean
}

/** `true` si el texto cambió después del consentimiento guardado. */
export function isConsentStale(
  consentAt: string | null | undefined,
  consentUpdatedAt: string | null | undefined,
): boolean {
  if (!consentAt || !consentUpdatedAt) return false
  const given = Date.parse(consentAt)
  const changed = Date.parse(consentUpdatedAt)
  if (Number.isNaN(given) || Number.isNaN(changed)) return false
  return changed > given
}

export function resolveLocationConsent({
  consentAt,
  consentUpdatedAt,
  declined,
}: LocationConsentInput): LocationConsentStatus {
  if (consentAt) {
    return isConsentStale(consentAt, consentUpdatedAt)
      ? 'needs-consent'
      : 'granted'
  }
  return declined ? 'declined' : 'needs-consent'
}

/**
 * Instante con el que se guarda un consentimiento nuevo. La hora oficial es
 * la del servidor, pero hoy el consentimiento se guarda con un `update`
 * directo (sin RPC). Si el reloj del celular va atrasado respecto de
 * `location_consent_updated_at`, el consentimiento recién dado quedaría
 * "anterior" al texto y la app lo volvería a pedir sin fin: por eso nunca se
 * guarda uno anterior al último cambio del texto (+1 s).
 */
export function consentTimestamp(
  consentUpdatedAt: string | null | undefined,
  now: Date = new Date(),
): string {
  const changed = consentUpdatedAt ? Date.parse(consentUpdatedAt) : Number.NaN
  const base = now.getTime()
  const at = Number.isNaN(changed) ? base : Math.max(base, changed + 1000)
  return new Date(at).toISOString()
}
