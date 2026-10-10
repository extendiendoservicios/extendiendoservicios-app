import { useState } from 'react'
import { Controller, useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Field, FieldError, FieldLabel } from '@/components/ui/field'
import { ShiftObservationField } from '@/features/shifts/components/ShiftObservationField'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { isApiError } from '@/api/errors'
import { useUpdateShiftDetailsMutation } from '@/features/planning/queries'
import {
  shiftDetailsFormValuesToInput,
  shiftDetailsSchema,
  type ShiftDetailsFormValues,
} from '@/features/planning/schemas'

/**
 * Edita la dotación y la observación de un turno existente
 * (ASSIGN-013, `06` sección 7: `update_shift_details`). Cierra el pendiente
 * de `12_Registro_de_Progreso.md`: hasta P11.2 no existía ninguna RPC que
 * permitiera tocar `required_staff`/`notes` de un turno ya creado.
 */
interface ShiftDetailsDialogProps {
  shiftId: string
  currentRequiredStaff: number
  currentNotes: string | null
  /** null si el turno no tiene observación (se muestra tildada). */
  currentShowInPrint: boolean | null
  open: boolean
  onOpenChange: (open: boolean) => void
}

function ShiftDetailsDialog({
  shiftId,
  currentRequiredStaff,
  currentNotes,
  currentShowInPrint,
  open,
  onOpenChange,
}: ShiftDetailsDialogProps) {
  const updateShiftDetails = useUpdateShiftDetailsMutation()

  const {
    register,
    control,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<ShiftDetailsFormValues>({
    resolver: zodResolver(shiftDetailsSchema),
    defaultValues: {
      requiredStaff: String(currentRequiredStaff),
      notes: currentNotes ?? '',
      showInPrint: currentShowInPrint ?? true,
    },
  })

  const [wasOpen, setWasOpen] = useState(open)
  if (open !== wasOpen) {
    setWasOpen(open)
    if (open) {
      reset({
        requiredStaff: String(currentRequiredStaff),
        notes: currentNotes ?? '',
        showInPrint: currentShowInPrint ?? true,
      })
    }
  }

  async function onSubmit(values: ShiftDetailsFormValues) {
    const input = shiftDetailsFormValuesToInput(values)
    try {
      await updateShiftDetails.mutateAsync({ shiftId, ...input })
      toast.success('Actualizamos la dotación y la observación del turno.')
      onOpenChange(false)
    } catch (error) {
      toast.error(
        isApiError(error) ? error.message : 'No pudimos actualizar el turno.',
      )
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Dotación y observación del turno</DialogTitle>
        </DialogHeader>
        <form
          onSubmit={(event) => void handleSubmit(onSubmit)(event)}
          className="flex flex-col gap-4"
        >
          <Field data-invalid={Boolean(errors.requiredStaff) || undefined}>
            <FieldLabel htmlFor="shift-required-staff">Dotación</FieldLabel>
            <Input
              id="shift-required-staff"
              type="number"
              inputMode="numeric"
              min={1}
              max={10}
              aria-invalid={Boolean(errors.requiredStaff)}
              {...register('requiredStaff')}
            />
            {errors.requiredStaff && (
              <FieldError>{errors.requiredStaff.message}</FieldError>
            )}
          </Field>

          <Controller
            control={control}
            name="showInPrint"
            render={({ field }) => (
              <ShiftObservationField
                id="shift-details"
                textareaProps={register('notes')}
                showInPrint={field.value ?? true}
                onShowInPrintChange={field.onChange}
              />
            )}
          />

          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              onClick={() => onOpenChange(false)}
            >
              Cancelar
            </Button>
            <Button type="submit" loading={updateShiftDetails.isPending}>
              Guardar cambios
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

export { ShiftDetailsDialog }
