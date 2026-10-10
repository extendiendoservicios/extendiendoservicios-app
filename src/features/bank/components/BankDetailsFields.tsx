import { Input } from '@/components/ui/input'
import { Field, FieldError, FieldLabel } from '@/components/ui/field'
import {
  formatCbuWhileTyping,
  type BankFormValues,
} from '@/features/bank/schemas'

type BankField = keyof BankFormValues

interface BankDetailsFieldsProps {
  /** Prefijo de los ids (hay un formulario de cliente y uno de empleado). */
  id: string
  values: BankFormValues
  errors: Partial<Record<BankField, string | undefined>>
  onChange: (field: BankField, value: string) => void
}

/**
 * AJ2-04: sección «Datos bancarios» de los formularios de cliente y de
 * empleado (solo dueño y administrador). Es un componente controlado: cada
 * formulario lo conecta a su `react-hook-form`. El CBU se agrupa mientras se
 * escribe y se guarda solo con dígitos.
 */
function BankDetailsFields({
  id,
  values,
  errors,
  onChange,
}: BankDetailsFieldsProps) {
  return (
    <div className="grid grid-cols-1 gap-4 rounded-lg border border-border bg-surface p-5 sm:grid-cols-2">
      <h2 className="text-[14px] font-semibold text-text sm:col-span-2">
        Datos bancarios
      </h2>
      <Field
        className="sm:col-span-2"
        data-invalid={Boolean(errors.bankName) || undefined}
      >
        <FieldLabel htmlFor={`${id}-bank-name`}>Banco</FieldLabel>
        <Input
          id={`${id}-bank-name`}
          aria-invalid={Boolean(errors.bankName)}
          value={values.bankName ?? ''}
          onChange={(event) => onChange('bankName', event.target.value)}
        />
        {errors.bankName && <FieldError>{errors.bankName}</FieldError>}
      </Field>
      <Field data-invalid={Boolean(errors.cbu) || undefined}>
        <FieldLabel htmlFor={`${id}-cbu`}>CBU</FieldLabel>
        <Input
          id={`${id}-cbu`}
          inputMode="numeric"
          autoComplete="off"
          placeholder="22 dígitos"
          aria-invalid={Boolean(errors.cbu)}
          value={values.cbu ?? ''}
          onChange={(event) =>
            onChange('cbu', formatCbuWhileTyping(event.target.value))
          }
        />
        {errors.cbu && <FieldError>{errors.cbu}</FieldError>}
      </Field>
      <Field data-invalid={Boolean(errors.alias) || undefined}>
        <FieldLabel htmlFor={`${id}-alias`}>Alias</FieldLabel>
        <Input
          id={`${id}-alias`}
          autoComplete="off"
          autoCapitalize="none"
          aria-invalid={Boolean(errors.alias)}
          value={values.alias ?? ''}
          onChange={(event) => onChange('alias', event.target.value)}
        />
        {errors.alias && <FieldError>{errors.alias}</FieldError>}
      </Field>
    </div>
  )
}

export { BankDetailsFields }
