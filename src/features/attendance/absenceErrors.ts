import { isApiError } from '@/api/errors'

/**
 * Mensaje para mostrar cuando falla `notify_absence` o `set_absence_certificate`
 * (P19.11d). Los códigos conocidos llevan una explicación pensada para quien
 * está en la pantalla; cualquier otro error muestra el `message` del servidor
 * tal cual.
 */
export function absenceErrorMessage(error: unknown, fallback: string): string {
  if (!isApiError(error)) {
    return fallback
  }
  switch (error.hint) {
    case 'CERTIFICATE_REQUIRED':
      return 'Indicá si la ausencia tiene certificado o no.'
    case 'TOO_LATE_TO_NOTIFY':
      return 'Ya no se puede avisar la ausencia de esta asignación.'
    case 'FORBIDDEN':
      return 'No tenés permiso para registrar ausencias. Pedíselo a la dueña.'
    case 'NO_ABSENCE':
      return 'Esta asignación no tiene una ausencia avisada.'
    default:
      return error.message
  }
}
