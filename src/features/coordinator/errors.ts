import { isApiError } from '@/api/errors'

/**
 * Mensajes en español de los códigos de error (`hint`) de las RPC de jornada
 * y de supervisión del coordinador (P24.1: `start_workday`, `pause_workday`,
 * `resume_workday`, `end_workday`, `reopen_workday`, `take_supervision`,
 * `discard_supervision`, `complete_supervision`, `rate_employee`). El servidor
 * ya manda un `message` en español; acá se fija el texto que ve la persona
 * para cada código, así no depende de que el servidor lo reformule y queda
 * cubierto por tests. Mismo patrón que `src/features/geo/errors.ts`.
 *
 * `RATINGS_PENDING` no está a propósito: su mensaje del servidor trae los
 * nombres de quienes faltan calificar («Falta calificar a: Ana Pérez, ...»).
 */
export const COORDINATOR_ERROR_MESSAGES: Record<string, string> = {
  FORBIDDEN: 'No tenés permiso para hacer esta acción.',
  SUPERVISOR_ROLE_REQUIRED: 'Esta acción es solo para coordinadores.',
  ON_LEAVE: 'Tenés licencia hoy: no podés iniciar la jornada.',
  WORKDAY_ALREADY_STARTED: 'Ya iniciaste tu jornada de hoy.',
  WORKDAY_NOT_STARTED: 'Primero tenés que iniciar tu jornada.',
  WORKDAY_ENDED:
    'Tu jornada de hoy ya está finalizada. Reabrila para seguir trabajando.',
  WORKDAY_PAUSED: 'Estás en pausa: reanudá tu jornada para continuar.',
  WORKDAY_NOT_PAUSED: 'Tu jornada no está en pausa.',
  WORKDAY_NOT_ENDED: 'Tu jornada todavía no está finalizada.',
  REASON_TOO_LONG: 'El motivo es demasiado largo (máximo 300 caracteres).',
  OUTSIDE_REASON_TOO_LONG:
    'El motivo es demasiado largo (máximo 300 caracteres).',
  SUPERVISION_OPEN:
    'Tenés una supervisión abierta: cerrala o descartala antes de pausar o finalizar la jornada.',
  COORDINATES_INCOMPLETE:
    'No pudimos usar tu ubicación. Probá de nuevo; el registro también funciona sin ubicación.',
  COORDINATES_OUT_OF_RANGE:
    'No pudimos usar tu ubicación. Probá de nuevo; el registro también funciona sin ubicación.',
  SHIFT_NOT_FOUND: 'No encontramos ese turno. Puede que ya no exista.',
  SHIFT_NOT_SUPERVISABLE: 'Este turno está cancelado: no se puede supervisar.',
  NOT_TODAY: 'Solo podés supervisar turnos de hoy.',
  SUPERVISION_ALREADY_OPEN:
    'Cerrá o descartá tu supervisión abierta antes de empezar otra.',
  ALREADY_SUPERVISED: 'Ya supervisaste este turno.',
  SUPERVISION_NOT_FOUND: 'No encontramos esa supervisión.',
  NOT_YOUR_SUPERVISION: 'Esa supervisión es de otro coordinador.',
  SUPERVISION_NOT_EDITABLE: 'Esa supervisión ya está cerrada o cancelada.',
  SUPERVISION_HAS_RATINGS:
    'Ya calificaste a alguien en esta supervisión: no se puede descartar.',
  NOT_STARTED: 'La supervisión todavía no tiene el inicio registrado.',
  RATING_WINDOW_CLOSED: 'El plazo para editar esta calificación terminó.',
  SELF_RATING_NOT_ALLOWED: 'No podés calificarte a vos mismo.',
}

/**
 * Texto para mostrar: el mensaje fijo del código si lo conocemos, si no el
 * `message` que mandó el servidor y, si el error no viene de la API (red, por
 * ejemplo), el texto de respaldo.
 */
export function coordinatorErrorMessage(
  error: unknown,
  fallback: string,
): string {
  if (isApiError(error)) {
    return (
      (error.hint && COORDINATOR_ERROR_MESSAGES[error.hint]) || error.message
    )
  }
  return fallback
}
