import { isApiError } from '@/api/errors'

/**
 * Mensajes en español de los códigos de error (`hint`) de las RPC de
 * geolocalización y corrección de fichajes (`correct_attendance_time`,
 * `override_geo_validation`, `get_attendance_location`, `set_geofence_radius`,
 * módulo B1). El servidor ya manda un `message` en español; acá se fija el
 * texto que ve la persona para cada código, así no depende de que el
 * servidor lo reformule y queda cubierto por tests.
 */
export const GEO_ERROR_MESSAGES: Record<string, string> = {
  FORBIDDEN: 'No tenés permiso para hacer esta acción.',
  RECORD_NOT_FOUND: 'No encontramos ese fichaje. Puede que ya no exista.',
  INVALID_RECORD_TYPE: 'El tipo de fichaje no es válido.',
  SHIFT_CANCELLED: 'Este turno está cancelado: no se puede corregir.',
  REASON_REQUIRED: 'Escribí el motivo.',
  TIME_REQUIRED: 'Indicá la hora nueva.',
  AT_OUT_OF_RANGE:
    'La hora tiene que estar entre las 0:00 del día del turno y este momento.',
  SAME_TIME: 'La hora nueva es igual a la actual.',
  INVALID_TIME_RANGE:
    'El inicio tiene que ser anterior al fin: revisá la hora que elegiste.',
  GEO_ALREADY_VALID: 'Este fichaje ya está validado.',
  GEO_ALREADY_OVERRIDDEN: 'Este fichaje ya fue marcado como válido.',
  RADIUS_OUT_OF_RANGE: 'El radio tiene que estar entre 50 y 1000 metros.',
}

/**
 * Texto para mostrar en un toast o aviso: el mensaje fijo del código si lo
 * conocemos, si no el `message` que mandó el servidor y, si el error no
 * viene de la API (red, por ejemplo), el texto de respaldo.
 */
export function geoErrorMessage(error: unknown, fallback: string): string {
  if (isApiError(error)) {
    return (error.hint && GEO_ERROR_MESSAGES[error.hint]) || error.message
  }
  return fallback
}
