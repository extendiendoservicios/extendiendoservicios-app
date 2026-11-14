import type { ComponentProps } from 'react'
import { Checkbox } from '@/components/ui/checkbox'
import { Textarea } from '@/components/ui/textarea'
import { Field, FieldLabel } from '@/components/ui/field'

interface ShiftObservationFieldProps {
  /** Prefijo de los ids (hay más de un formulario de turno). */
  id: string
  /** Props del `register('notes')` de react-hook-form. */
  textareaProps: ComponentProps<typeof Textarea>
  showInPrint: boolean
  onShowInPrintChange: (value: boolean) => void
  className?: string
}

/** OG-05: texto del campo; los empleados asignados la ven como «Mensaje de la oficina». */
export const SHIFT_OBSERVATION_LABEL =
  'Observación (la ven los empleados asignados)'
export const SHIFT_OBSERVATION_HELP =
  'Sirve para mandarles un recado. Si la cambiás, les aparece como novedad.'

/**
 * AJ2-15: observación del turno y casilla «Mostrar en la impresión». Desde
 * OG-05 (P29) la ven los empleados asignados.
 */
function ShiftObservationField({
  id,
  textareaProps,
  showInPrint,
  onShowInPrintChange,
  className,
}: ShiftObservationFieldProps) {
  return (
    <Field className={className}>
      <FieldLabel htmlFor={`${id}-observation`}>
        {SHIFT_OBSERVATION_LABEL}
      </FieldLabel>
      <Textarea
        id={`${id}-observation`}
        rows={3}
        aria-describedby={`${id}-observation-help`}
        {...textareaProps}
      />
      <p id={`${id}-observation-help`} className="text-[11.5px] text-text-3">
        {SHIFT_OBSERVATION_HELP}
      </p>
      <label
        htmlFor={`${id}-show-in-print`}
        className="flex items-center gap-2 text-[13px] text-text"
      >
        <Checkbox
          id={`${id}-show-in-print`}
          checked={showInPrint}
          onCheckedChange={(value) => onShowInPrintChange(value === true)}
        />
        Mostrar en la impresión
      </label>
    </Field>
  )
}

export { ShiftObservationField }
