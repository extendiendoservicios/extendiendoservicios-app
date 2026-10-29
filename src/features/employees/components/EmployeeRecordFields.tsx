import { Controller, type UseFormReturn } from 'react-hook-form'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Field, FieldError, FieldLabel } from '@/components/ui/field'
import { formatTaxIdWhileTyping } from '@/lib/taxId'
import type { EmployeeRecordFormValues } from '@/features/employees/schemas'

/**
 * P26.8 (CR-17, CR-18): los campos de la ficha laboral (DNI, CUIL, legajo,
 * fechas, domicilio, notas y contacto de emergencia) para los formularios que
 * viven en un panel lateral: el alta de un usuario administrativo y
 * «Completar ficha laboral». Los dos usan el esquema `employeeRecordShape`,
 * así piden y validan exactamente lo mismo que el alta de empleado (ADM-18).
 *
 * `form` puede ser el formulario de cualquier pantalla cuyo tipo incluya los
 * campos de la ficha. React Hook Form tipa `register` por el esquema exacto,
 * así que se lo ve acá como el de la ficha sola (una única conversión de tipo,
 * los nombres de campo son los mismos).
 */
export function EmployeeRecordFields<T extends EmployeeRecordFormValues>({
  form,
  idPrefix,
  numberHint,
}: {
  form: UseFormReturn<T>
  idPrefix: string
  numberHint?: string
}) {
  const {
    control,
    register,
    formState: { errors },
  } = form as unknown as UseFormReturn<EmployeeRecordFormValues>

  return (
    <>
      <fieldset className="flex flex-col gap-3">
        <legend className="mb-1 text-[13px] font-semibold text-text">
          Datos personales
        </legend>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field data-invalid={Boolean(errors.dni) || undefined}>
            <FieldLabel htmlFor={`${idPrefix}-dni`}>DNI</FieldLabel>
            <Input
              id={`${idPrefix}-dni`}
              inputMode="numeric"
              aria-invalid={Boolean(errors.dni)}
              {...register('dni')}
            />
            {errors.dni && <FieldError>{errors.dni.message}</FieldError>}
          </Field>
          <Field data-invalid={Boolean(errors.cuil) || undefined}>
            <FieldLabel htmlFor={`${idPrefix}-cuil`}>CUIL</FieldLabel>
            <Controller
              control={control}
              name="cuil"
              render={({ field }) => (
                <Input
                  id={`${idPrefix}-cuil`}
                  inputMode="numeric"
                  placeholder="20-12345678-6"
                  aria-invalid={Boolean(errors.cuil)}
                  name={field.name}
                  ref={field.ref}
                  onBlur={field.onBlur}
                  value={field.value ?? ''}
                  onChange={(event) =>
                    field.onChange(formatTaxIdWhileTyping(event.target.value))
                  }
                />
              )}
            />
            {errors.cuil && <FieldError>{errors.cuil.message}</FieldError>}
          </Field>
          <Field data-invalid={Boolean(errors.birthDate) || undefined}>
            <FieldLabel htmlFor={`${idPrefix}-birth-date`}>
              Fecha de nacimiento
            </FieldLabel>
            <Input
              id={`${idPrefix}-birth-date`}
              type="date"
              aria-invalid={Boolean(errors.birthDate)}
              {...register('birthDate')}
            />
            {errors.birthDate && (
              <FieldError>{errors.birthDate.message}</FieldError>
            )}
          </Field>
          <Field>
            <FieldLabel htmlFor={`${idPrefix}-address`}>Domicilio</FieldLabel>
            <Input id={`${idPrefix}-address`} {...register('address')} />
          </Field>
        </div>
      </fieldset>

      <fieldset className="flex flex-col gap-3">
        <legend className="mb-1 text-[13px] font-semibold text-text">
          Datos laborales
        </legend>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field data-invalid={Boolean(errors.employeeNumber) || undefined}>
            <FieldLabel htmlFor={`${idPrefix}-number`}>Legajo</FieldLabel>
            <Input
              id={`${idPrefix}-number`}
              type="number"
              inputMode="numeric"
              aria-invalid={Boolean(errors.employeeNumber)}
              {...register('employeeNumber')}
            />
            {errors.employeeNumber ? (
              <FieldError>{errors.employeeNumber.message}</FieldError>
            ) : (
              numberHint && (
                <p className="text-[11px] text-text-3">{numberHint}</p>
              )
            )}
          </Field>
          <Field>
            <FieldLabel htmlFor={`${idPrefix}-hire-date`}>
              Fecha de ingreso
            </FieldLabel>
            <Input
              id={`${idPrefix}-hire-date`}
              type="date"
              {...register('hireDate')}
            />
          </Field>
        </div>
        <Field>
          <FieldLabel htmlFor={`${idPrefix}-notes`}>Notas</FieldLabel>
          <Textarea id={`${idPrefix}-notes`} rows={3} {...register('notes')} />
        </Field>
      </fieldset>

      <fieldset className="flex flex-col gap-3">
        <legend className="mb-1 text-[13px] font-semibold text-text">
          Contacto de emergencia
        </legend>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Field>
            <FieldLabel htmlFor={`${idPrefix}-emergency-name`}>
              Nombre
            </FieldLabel>
            <Input
              id={`${idPrefix}-emergency-name`}
              {...register('emergencyContactName')}
            />
          </Field>
          <Field>
            <FieldLabel htmlFor={`${idPrefix}-emergency-phone`}>
              Teléfono
            </FieldLabel>
            <Input
              id={`${idPrefix}-emergency-phone`}
              {...register('emergencyContactPhone')}
            />
          </Field>
          <Field>
            <FieldLabel htmlFor={`${idPrefix}-emergency-relationship`}>
              Vínculo
            </FieldLabel>
            <Input
              id={`${idPrefix}-emergency-relationship`}
              {...register('emergencyContactRelationship')}
            />
          </Field>
        </div>
      </fieldset>
    </>
  )
}
