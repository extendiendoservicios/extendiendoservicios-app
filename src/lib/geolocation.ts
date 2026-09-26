/**
 * `src/lib/geolocation.ts` (ATT-006, ADR-009, P-067, P-091): pide la
 * posición del dispositivo para el registro de inicio y fin del empleado
 * (y, después, para SUP-04 del supervisor). La regla no negociable es la
 * de `08_Fases_y_Backlog.md` para esta vía: "el registro tiene que
 * funcionar aunque el empleado niegue la ubicación" — por eso esta función
 * NUNCA rechaza (`reject`) ni lanza: si el navegador no tiene la API, si la
 * persona niega el permiso, si falla por cualquier otro motivo o si no
 * responde a tiempo, devuelve `null` y quien llama sigue adelante sin
 * coordenadas (P-067: "si el empleado la concede, se guardan latitud,
 * longitud y precisión (...) el registro funciona igual sin ubicación").
 *
 * Solo tiene sentido llamarla después del consentimiento (EMP-06,
 * `profiles.location_consent_at`): eso lo decide quien la use (la pantalla
 * de fichar, P13.3), no esta función — acá solo vive el pedido a la API del
 * navegador con un timeout razonable, sin conocer nada del consentimiento.
 *
 * Valores de `timeoutMs`/`enableHighAccuracy` (decisión menor, el plan no
 * fija números): 6 segundos y alta precisión. Es un valor de compromiso
 * para GPS de celulares Android en interiores (donde el primer `fix` de
 * alta precisión puede tardar) sin demorar de más un registro que, de
 * última, no depende de la ubicación para nada.
 */

/** Coordenadas que devuelve el navegador, ya con nombres en `camelCase` para el resto de la app. */
export interface GeolocationCoords {
  lat: number
  lng: number
  accuracyM: number
}

const DEFAULT_TIMEOUT_MS = 6_000

/**
 * Pide la posición actual una sola vez. Devuelve `null` sin lanzar nunca:
 * ni por falta de la API, por permiso denegado, por error del sensor ni por
 * demora — las cuatro situaciones de "sin ubicación" de `ADR-009`.
 */
export function getCurrentPositionSafe(
  timeoutMs: number = DEFAULT_TIMEOUT_MS,
): Promise<GeolocationCoords | null> {
  return new Promise((resolve) => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      resolve(null)
      return
    }

    let settled = false
    const finish = (result: GeolocationCoords | null) => {
      if (settled) return
      settled = true
      resolve(result)
    }

    // Timeout propio, además del `timeout` de la propia API: algunos
    // navegadores (sobre todo si el permiso quedó en un estado raro) nunca
    // llaman a ninguno de los dos callbacks — con esto el registro no queda
    // esperando para siempre.
    const timer = setTimeout(() => finish(null), timeoutMs)

    try {
      navigator.geolocation.getCurrentPosition(
        (position) => {
          clearTimeout(timer)
          finish({
            lat: position.coords.latitude,
            lng: position.coords.longitude,
            accuracyM: position.coords.accuracy,
          })
        },
        () => {
          // Permiso denegado, posición no disponible o timeout de la propia
          // API (`PERMISSION_DENIED`, `POSITION_UNAVAILABLE`, `TIMEOUT`):
          // en los tres casos, sin ubicación, sin bloquear.
          clearTimeout(timer)
          finish(null)
        },
        {
          enableHighAccuracy: true,
          timeout: timeoutMs,
          maximumAge: 0,
        },
      )
    } catch {
      // Un `throw` síncrono es raro (algún navegador viejo con la API mal
      // implementada), pero si pasa tampoco tiene que romper el registro.
      clearTimeout(timer)
      finish(null)
    }
  })
}
