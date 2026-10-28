import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
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
import type { SupplyCategory } from '@/api/stock'
import { useUpsertSupplyCategoryMutation } from '@/features/stock/queries'
import {
  categorySchema,
  type CategoryFormValues,
} from '@/features/stock/schemas'

/**
 * Alta y edición de una categoría (IS-03): solo el nombre. `category` nulo =
 * alta (queda al final del orden); con valor = edición (conserva su lugar y
 * su estado). El nombre es único sin distinguir mayúsculas
 * (`CATEGORY_NAME_EXISTS`).
 */
function CategoryFormDialog({
  category,
  nextSortOrder,
  open,
  onOpenChange,
}: {
  category: SupplyCategory | null
  /** Posición de una categoría nueva (después de la última). */
  nextSortOrder: number
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const upsert = useUpsertSupplyCategoryMutation()
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<CategoryFormValues>({
    resolver: zodResolver(categorySchema),
    values: { name: category?.name ?? '' },
  })

  function handleOpenChange(next: boolean) {
    if (!next) reset()
    onOpenChange(next)
  }

  async function onSubmit(values: CategoryFormValues) {
    try {
      await upsert.mutateAsync({
        id: category?.id,
        name: values.name.trim(),
        sortOrder: category?.sortOrder ?? nextSortOrder,
        active: category?.active ?? true,
      })
      toast.success(
        category ? 'Guardamos la categoría.' : 'Agregamos la categoría.',
      )
      handleOpenChange(false)
    } catch (error) {
      toast.error(
        isApiError(error) ? error.message : 'No pudimos guardar la categoría.',
      )
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {category ? 'Editar categoría' : 'Nueva categoría'}
          </DialogTitle>
          <DialogDescription>
            Sirve para ordenar y filtrar los artículos (por ejemplo, químicos o
            descartables).
          </DialogDescription>
        </DialogHeader>
        <form
          noValidate
          onSubmit={(event) => void handleSubmit(onSubmit)(event)}
          className="flex flex-col gap-[13px]"
        >
          <Field data-invalid={Boolean(errors.name) || undefined}>
            <FieldLabel htmlFor="category-name">Nombre</FieldLabel>
            <Input
              id="category-name"
              autoComplete="off"
              aria-invalid={Boolean(errors.name)}
              {...register('name')}
            />
            {errors.name && <FieldError>{errors.name.message}</FieldError>}
          </Field>
          <DialogFooter className="mt-2">
            <Button
              type="button"
              variant="ghost"
              onClick={() => handleOpenChange(false)}
              disabled={upsert.isPending}
            >
              Cancelar
            </Button>
            <Button type="submit" loading={upsert.isPending}>
              Guardar
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

export { CategoryFormDialog }
