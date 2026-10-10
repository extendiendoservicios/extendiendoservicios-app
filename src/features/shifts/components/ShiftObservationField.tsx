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

/**
 * AJ2-15: observación del turno y casilla «Mostrar en la impresión». Es solo de
 * administración: no se muestra en el celular del empleado ni del supervisor.
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
      <FieldLabel htmlFor={`${id}-observation`}>Observación</FieldLabel>
      <Textarea id={`${id}-observation`} rows={3} {...textareaProps} />
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
