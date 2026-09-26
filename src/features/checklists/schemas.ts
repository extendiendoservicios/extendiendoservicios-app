import { z } from 'zod'
import type { ChecklistItemInput } from '@/api/checklists'

/**
 * Esquemas zod de ADM-26 (TASK-004, TASK-005): repiten las restricciones
 * que ya exige el servidor (`04_Modelo_de_Datos.md` sección 2.4,
 * `0008_checklists_tasks.sql`: `title not null`, `is_required` con
 * default `true`), no las reemplazan.
 */

/** Cadena vacía → `null` (mismo criterio que `emptyToNull` de `features/services/schemas.ts`). */
function emptyToNull(value: string | undefined): string | null {
  const trimmed = value?.trim() ?? ''
  return trimmed.length > 0 ? trimmed : null
}

export const checklistItemFormSchema = z.object({
  title: z
    .string()
    .trim()
    .min(1, 'El título es obligatorio.')
    .max(200, 'El título no puede superar los 200 caracteres.'),
  description: z
    .string()
    .trim()
    .max(500, 'La descripción no puede superar los 500 caracteres.')
    .optional(),
  /** `checklist_template_items.is_required`, `true` por defecto (P-059). */
  isRequired: z.boolean(),
})

export type ChecklistItemFormValues = z.infer<typeof checklistItemFormSchema>

export function checklistItemFormValuesToInput(
  values: ChecklistItemFormValues,
): ChecklistItemInput {
  return {
    title: values.title.trim(),
    description: emptyToNull(values.description),
    isRequired: values.isRequired,
  }
}
