import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Field, FieldError, FieldLabel } from '@/components/ui/field'
import {
  Sheet,
  SheetContent,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { isApiError } from '@/api/errors'
import type { RatingCriterion } from '@/api/settings'
import {
  useCreateRatingCriterionMutation,
  useUpdateRatingCriterionMutation,
} from '@/features/settings/queries'
import {
  ratingCriterionSchema,
  type RatingCriterionFormValues,
} from '@/features/settings/schemas'

/**
 * Alta y edición de un criterio de calificación (ADM-30, USERS-015). En
 * edición, no toca `valid_from`/`valid_to` -- eso lo maneja "Cerrar" en la
 * pantalla (pone `valid_to`, `04` sección 2.5: "no se borra").
 */
function RatingCriterionFormSheet({
  criterion,
  nextPosition,
  actorId,
  open,
  onOpenChange,
}: {
  /** `null` para alta; la fila existente para edición. */
  criterion: RatingCriterion | null
  /** Posición para un criterio nuevo (al final de la lista). */
  nextPosition: number
  actorId: string
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const createCriterion = useCreateRatingCriterionMutation()
  const updateCriterion = useUpdateRatingCriterionMutation()
  const isPending = createCriterion.isPending || updateCriterion.isPending

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<RatingCriterionFormValues>({
    resolver: zodResolver(ratingCriterionSchema),
    defaultValues: { title: '', description: '' },
  })

  const [wasOpen, setWasOpen] = useState(open)
  if (open !== wasOpen) {
    setWasOpen(open)
    if (open) {
      reset({
        title: criterion?.title ?? '',
        description: criterion?.description ?? '',
      })
    }
  }

  async function onSubmit(values: RatingCriterionFormValues) {
    try {
      if (criterion) {
        await updateCriterion.mutateAsync({
          id: criterion.id,
          title: values.title,
          description: values.description ?? null,
          updatedBy: actorId,
        })
        toast.success('Actualizamos el criterio.')
      } else {
        await createCriterion.mutateAsync({
          title: values.title,
          description: values.description ?? null,
          position: nextPosition,
          createdBy: actorId,
        })
        toast.success('Agregamos el criterio.')
      }
      onOpenChange(false)
    } catch (error) {
      toast.error(
        isApiError(error) ? error.message : 'No pudimos guardar el criterio.',
      )
    }
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent>
        <SheetHeader>
          <SheetTitle>
            {criterion ? 'Editar criterio' : 'Nuevo criterio'}
          </SheetTitle>
        </SheetHeader>
        <form
          onSubmit={(event) => void handleSubmit(onSubmit)(event)}
          className="flex flex-1 flex-col gap-4 overflow-y-auto px-6"
        >
          <Field data-invalid={Boolean(errors.title) || undefined}>
            <FieldLabel htmlFor="criterion-title">Título</FieldLabel>
            <Input
              id="criterion-title"
              aria-invalid={Boolean(errors.title)}
              {...register('title')}
            />
            {errors.title && <FieldError>{errors.title.message}</FieldError>}
          </Field>
          <Field data-invalid={Boolean(errors.description) || undefined}>
            <FieldLabel htmlFor="criterion-description">Descripción</FieldLabel>
            <Textarea
              id="criterion-description"
              rows={4}
              aria-invalid={Boolean(errors.description)}
              {...register('description')}
            />
            {errors.description && (
              <FieldError>{errors.description.message}</FieldError>
            )}
          </Field>
        </form>
        <SheetFooter className="flex-row justify-end">
          <Button
            type="button"
            variant="ghost"
            onClick={() => onOpenChange(false)}
          >
            Cancelar
          </Button>
          <Button
            type="submit"
            loading={isPending}
            onClick={(event) => void handleSubmit(onSubmit)(event)}
          >
            {criterion ? 'Guardar cambios' : 'Agregar criterio'}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  )
}

export { RatingCriterionFormSheet }
