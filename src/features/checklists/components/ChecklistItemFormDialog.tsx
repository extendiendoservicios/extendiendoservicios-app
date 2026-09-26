import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Checkbox } from '@/components/ui/checkbox'
import { Field, FieldError, FieldLabel } from '@/components/ui/field'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { isApiError } from '@/api/errors'
import type { ChecklistTemplateItem } from '@/api/checklists'
import { useAuth } from '@/features/auth/AuthProvider'
import {
  checklistItemFormSchema,
  checklistItemFormValuesToInput,
  type ChecklistItemFormValues,
} from '@/features/checklists/schemas'
import {
  useCreateTemplateItemMutation,
  useUpdateTemplateItemMutation,
} from '@/features/checklists/queries'

/**
 * ADM-26: alta y edición de un ítem de la plantilla (TASK-005, mismo
 * patrón que `ClientContactFormDialog`). `item` nulo = alta (se agrega al
 * final, `nextPosition`); con valor = edición (la posición no se toca acá,
 * ver `ChecklistItemsEditor.handleMove`).
 */
function ChecklistItemFormDialog({
  templateId,
  item,
  nextPosition,
  open,
  onOpenChange,
}: {
  templateId: string
  item: ChecklistTemplateItem | null
  nextPosition: number
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const auth = useAuth()
  const createItem = useCreateTemplateItemMutation()
  const updateItem = useUpdateTemplateItemMutation()
  const isSaving = createItem.isPending || updateItem.isPending

  const {
    register,
    handleSubmit,
    watch,
    setValue,
    reset,
    formState: { errors },
  } = useForm<ChecklistItemFormValues>({
    resolver: zodResolver(checklistItemFormSchema),
    values: {
      title: item?.title ?? '',
      description: item?.description ?? '',
      isRequired: item?.isRequired ?? true,
    },
  })
  const isRequired = watch('isRequired')

  function handleOpenChange(nextOpen: boolean) {
    if (!nextOpen) {
      reset()
    }
    onOpenChange(nextOpen)
  }

  async function onSubmit(values: ChecklistItemFormValues) {
    const input = checklistItemFormValuesToInput(values)
    try {
      if (item) {
        await updateItem.mutateAsync({
          id: item.id,
          input,
          updatedBy: auth.userId as string,
        })
        toast.success('Guardamos los cambios del ítem.')
      } else {
        await createItem.mutateAsync({
          templateId,
          position: nextPosition,
          input,
          createdBy: auth.userId as string,
        })
        toast.success('Agregamos el ítem.')
      }
      handleOpenChange(false)
    } catch (error) {
      toast.error(
        isApiError(error) ? error.message : 'No pudimos guardar el ítem.',
      )
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{item ? 'Editar ítem' : 'Nuevo ítem'}</DialogTitle>
          <DialogDescription>
            Una tarea del checklist que se copia a cada turno nuevo. Cambiarla
            acá no modifica los turnos ya generados.
          </DialogDescription>
        </DialogHeader>
        <form
          noValidate
          onSubmit={(event) => void handleSubmit(onSubmit)(event)}
          className="flex flex-col gap-[13px]"
        >
          <Field data-invalid={Boolean(errors.title) || undefined}>
            <FieldLabel htmlFor="checklist-item-title">Título</FieldLabel>
            <Input
              id="checklist-item-title"
              aria-invalid={Boolean(errors.title)}
              {...register('title')}
            />
            {errors.title && <FieldError>{errors.title.message}</FieldError>}
          </Field>

          <Field data-invalid={Boolean(errors.description) || undefined}>
            <FieldLabel htmlFor="checklist-item-description">
              Descripción
            </FieldLabel>
            <Textarea
              id="checklist-item-description"
              rows={2}
              {...register('description')}
            />
            {errors.description && (
              <FieldError>{errors.description.message}</FieldError>
            )}
          </Field>

          <label
            htmlFor="checklist-item-optional"
            className="flex items-center gap-2 text-[12.5px] text-text-2"
          >
            <Checkbox
              id="checklist-item-optional"
              checked={!isRequired}
              onCheckedChange={(checked) =>
                setValue('isRequired', checked !== true, {
                  shouldDirty: true,
                })
              }
            />
            Tarea opcional (si no la marcás, es obligatoria)
          </label>

          <DialogFooter className="mt-2">
            <Button
              type="button"
              variant="ghost"
              onClick={() => handleOpenChange(false)}
              disabled={isSaving}
            >
              Cancelar
            </Button>
            <Button type="submit" loading={isSaving}>
              Guardar
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

export { ChecklistItemFormDialog }
