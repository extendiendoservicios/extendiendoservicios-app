import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Field, FieldError, FieldLabel } from '@/components/ui/field'
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
 * Edita la dotación y las notas administrativas de un turno existente
 * (ASSIGN-013, `06` sección 7: `update_shift_details`). Cierra el pendiente
 * de `12_Registro_de_Progreso.md`: hasta P11.2 no existía ninguna RPC que
 * permitiera tocar `required_staff`/`notes` de un turno ya creado.
 */
interface ShiftDetailsDialogProps {
  shiftId: string
  currentRequiredStaff: number
  currentNotes: string | null
  open: boolean
  onOpenChange: (open: boolean) => void
}

function ShiftDetailsDialog({
  shiftId,
  currentRequiredStaff,
  currentNotes,
  open,
  onOpenChange,
}: ShiftDetailsDialogProps) {
  const updateShiftDetails = useUpdateShiftDetailsMutation()

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<ShiftDetailsFormValues>({
    resolver: zodResolver(shiftDetailsSchema),
    defaultValues: {
      requiredStaff: String(currentRequiredStaff),
      notes: currentNotes ?? '',
    },
  })

  const [wasOpen, setWasOpen] = useState(open)
  if (open !== wasOpen) {
    setWasOpen(open)
    if (open) {
      reset({
        requiredStaff: String(currentRequiredStaff),
        notes: currentNotes ?? '',
      })
    }
  }

  async function onSubmit(values: ShiftDetailsFormValues) {
    const input = shiftDetailsFormValuesToInput(values)
    try {
      await updateShiftDetails.mutateAsync({ shiftId, ...input })
      toast.success('Actualizamos la dotación y las notas del turno.')
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
          <DialogTitle>Dotación y notas del turno</DialogTitle>
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

          <Field>
            <FieldLabel htmlFor="shift-notes">Notas administrativas</FieldLabel>
            <Textarea id="shift-notes" rows={3} {...register('notes')} />
          </Field>

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
