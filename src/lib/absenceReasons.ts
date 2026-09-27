import type { Database } from '@/lib/database.types'

/**
 * `src/lib/absenceReasons.ts` (ABS-009, `02_Decisiones.md` P-073): la lista
 * de motivos de ausencia, en un módulo compartido entre `front-movil`
 * (EMP-12, `src/api/notices.ts`) y `front-admin` (ADM-10/ADM-11, que carga
 * la ausencia en nombre del empleado con el mismo motivo de lista — ver
 * `06_API.md` sección 10, `admin_record_attendance`/`notify_absence`).
 *
 * `AbsenceReason` sale del enum `absence_reason` (`0009_...sql`,
 * `attendance_notices.reason_code`): `illness`, `procedure`, `personal`,
 * `transport`, `other`. El orden de `ABSENCE_REASON_OPTIONS` es el mismo que
 * enumera P-073 ("enfermedad, trámite, problema personal, transporte,
 * otro"), con "otro" siempre al final porque exige texto obligatorio (`06`
 * sección 11, `REASON_REQUIRED`) — conviene que sea la última alternativa,
 * no una más del medio.
 */
export type AbsenceReason = Database['public']['Enums']['absence_reason']

export interface AbsenceReasonOption {
  value: AbsenceReason
  label: string
}

export const ABSENCE_REASON_OPTIONS: readonly AbsenceReasonOption[] = [
  { value: 'illness', label: 'Enfermedad' },
  { value: 'procedure', label: 'Trámite' },
  { value: 'personal', label: 'Problema personal' },
  { value: 'transport', label: 'Problema de transporte' },
  { value: 'other', label: 'Otro' },
]

export const ABSENCE_REASON_LABELS: Record<AbsenceReason, string> =
  Object.fromEntries(
    ABSENCE_REASON_OPTIONS.map((option) => [option.value, option.label]),
  ) as Record<AbsenceReason, string>

/** Etiqueta en voseo de un motivo de ausencia, para mostrar en pantalla ("Avisaste que no vas: enfermedad"). */
export function absenceReasonLabel(value: AbsenceReason): string {
  return ABSENCE_REASON_LABELS[value]
}

/** `06` sección 11: si el motivo es "otro", el texto libre es obligatorio (mismo `REASON_REQUIRED` que "sin motivo"). */
export function absenceReasonRequiresText(value: AbsenceReason): boolean {
  return value === 'other'
}
