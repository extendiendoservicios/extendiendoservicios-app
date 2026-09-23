import { useState } from 'react'
import { Controller, useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Field, FieldError, FieldLabel } from '@/components/ui/field'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { DatePicker } from '@/components/DatePicker'
import { isApiError } from '@/api/errors'
import { localDateToIsoDate } from '@/features/settings/dateOnly'
import { useCreateHolidayMutation } from '@/features/settings/queries'
import {
  createHolidaySchema,
  type CreateHolidayFormValues,
} from '@/features/settings/schemas'

/**
 * Alta manual de un feriado (ADM-29, USERS-014). `open`/`onOpenChange`
 * siguen el mismo patrón que `ConfirmDialog`: quien lo usa controla cuándo
 * se muestra, este componente no llama a ninguna otra pantalla.
 */
function HolidayFormDialog({
  year,
  createdBy,
  open,
  onOpenChange,
}: {
  year: number
  createdBy: string
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const createHoliday = useCreateHolidayMutation(year)
  const {
    control,
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<CreateHolidayFormValues>({
    resolver: zodResolver(createHolidaySchema),
    defaultValues: { holidayDate: '', name: '' },
  })

  const [wasOpen, setWasOpen] = useState(open)
  if (open !== wasOpen) {
    setWasOpen(open)
    if (open) {
      reset({ holidayDate: '', name: '' })
    }
  }

  async function onSubmit(values: CreateHolidayFormValues) {
    try {
      await createHoliday.mutateAsync({
        holidayDate: values.holidayDate,
        name: values.name,
        createdBy,
      })
      toast.success('Agregamos el feriado.')
      onOpenChange(false)
    } catch (error) {
      toast.error(
        isApiError(error) ? error.message : 'No pudimos agregar el feriado.',
      )
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Nuevo feriado</DialogTitle>
        </DialogHeader>
        <form
          onSubmit={(event) => void handleSubmit(onSubmit)(event)}
          className="flex flex-col gap-4"
        >
          <Field data-invalid={Boolean(errors.holidayDate) || undefined}>
            <FieldLabel htmlFor="holiday-date">Fecha</FieldLabel>
            <Controller
              control={control}
              name="holidayDate"
              render={({ field }) => (
                <DatePicker
                  aria-label="Fecha del feriado"
                  value={
                    field.value
                      ? new Date(`${field.value}T00:00:00`)
                      : undefined
                  }
                  onValueChange={(date) =>
                    field.onChange(date ? localDateToIsoDate(date) : '')
                  }
                />
              )}
            />
            {errors.holidayDate && (
              <FieldError>{errors.holidayDate.message}</FieldError>
            )}
          </Field>

          <Field data-invalid={Boolean(errors.name) || undefined}>
            <FieldLabel htmlFor="holiday-name">Nombre</FieldLabel>
            <Input
              id="holiday-name"
              aria-invalid={Boolean(errors.name)}
              {...register('name')}
            />
            {errors.name && <FieldError>{errors.name.message}</FieldError>}
          </Field>

          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              onClick={() => onOpenChange(false)}
            >
              Cancelar
            </Button>
            <Button type="submit" loading={createHoliday.isPending}>
              Agregar feriado
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

export { HolidayFormDialog }
