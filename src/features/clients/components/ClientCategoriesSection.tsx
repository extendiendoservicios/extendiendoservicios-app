import { useState } from 'react'
import { toast } from 'sonner'
import { ArrowDown, ArrowUp, Pencil, Plus, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Field, FieldLabel } from '@/components/ui/field'
import { Skeleton } from '@/components/ui/skeleton'
import { IconButton } from '@/components/IconButton'
import { isApiError } from '@/api/errors'
import type { ClientCategory } from '@/api/clientCategories'
import { SimpleConfirmDialog } from '@/features/settings/components/SimpleConfirmDialog'
import {
  useClientCategoriesQuery,
  useClientCountsByCategoryQuery,
  useCreateClientCategoryMutation,
  useRemoveClientCategoryMutation,
  useRenameClientCategoryMutation,
  useReorderClientCategoriesMutation,
} from '@/features/clients/categoryQueries'
import {
  describeCategoryRemoval,
  moveCategory,
} from '@/features/clients/categories'

/**
 * OD-20: sección «Categorías de clientes» de Configuración (la editan el dueño
 * y los administradores). Alta, cambio de nombre, orden (subir y bajar, que
 * sirve también en el celular) y baja lógica: antes de dar de baja avisa
 * cuántos clientes quedan sin categoría.
 */
function ClientCategoriesSection() {
  const categoriesQuery = useClientCategoriesQuery()
  const countsQuery = useClientCountsByCategoryQuery()
  const create = useCreateClientCategoryMutation()
  const rename = useRenameClientCategoryMutation()
  const reorder = useReorderClientCategoriesMutation()
  const remove = useRemoveClientCategoryMutation()

  // `null` = cerrado; `{}` = alta; con `category` = cambio de nombre.
  const [nameDialog, setNameDialog] = useState<{
    category?: ClientCategory
  } | null>(null)
  const [toRemove, setToRemove] = useState<ClientCategory | null>(null)

  const categories = categoriesQuery.data ?? []

  async function handleMove(index: number, direction: -1 | 1) {
    const ids = moveCategory(
      categories.map((category) => category.id),
      index,
      direction,
    )
    try {
      await reorder.mutateAsync(ids)
    } catch (error) {
      toast.error(
        isApiError(error) ? error.message : 'No pudimos cambiar el orden.',
      )
    }
  }

  async function handleRemove() {
    if (!toRemove) {
      return
    }
    try {
      const cleared = await remove.mutateAsync(toRemove.id)
      toast.success(
        cleared > 0
          ? `Dimos de baja «${toRemove.name}». ${cleared} ${
              cleared === 1 ? 'cliente quedó' : 'clientes quedaron'
            } sin categoría.`
          : `Dimos de baja «${toRemove.name}».`,
      )
      setToRemove(null)
    } catch (error) {
      toast.error(
        isApiError(error)
          ? error.message
          : 'No pudimos dar de baja la categoría.',
      )
    }
  }

  return (
    <section className="flex max-w-xl flex-col gap-3 rounded-lg border border-border bg-surface p-5">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-[14px] font-semibold text-text">
          Categorías de clientes
        </h2>
        <Button
          type="button"
          size="sm"
          icon={Plus}
          onClick={() => setNameDialog({})}
        >
          Nueva categoría
        </Button>
      </div>
      <p className="text-[12.5px] text-text-3">
        Cada cliente puede tener una categoría (opcional). El listado de
        clientes se agrupa en este orden.
      </p>

      {categoriesQuery.isLoading ? (
        <Skeleton className="h-24" />
      ) : categories.length === 0 ? (
        <p className="text-[12.5px] text-text-3">
          Todavía no hay categorías. Agregá la primera con «Nueva categoría».
        </p>
      ) : (
        <ul className="flex flex-col divide-y divide-border rounded-md border border-border">
          {categories.map((category, index) => (
            <li
              key={category.id}
              className="flex items-center justify-between gap-2 px-3 py-2"
            >
              <span className="min-w-0 truncate text-[13px] font-medium text-text">
                {category.name}
              </span>
              <div className="flex shrink-0 items-center gap-1">
                <IconButton
                  icon={ArrowUp}
                  aria-label={`Subir ${category.name}`}
                  disabled={index === 0 || reorder.isPending}
                  onClick={() => void handleMove(index, -1)}
                />
                <IconButton
                  icon={ArrowDown}
                  aria-label={`Bajar ${category.name}`}
                  disabled={
                    index === categories.length - 1 || reorder.isPending
                  }
                  onClick={() => void handleMove(index, 1)}
                />
                <IconButton
                  icon={Pencil}
                  aria-label={`Cambiar el nombre de ${category.name}`}
                  onClick={() => setNameDialog({ category })}
                />
                <IconButton
                  icon={Trash2}
                  aria-label={`Dar de baja ${category.name}`}
                  onClick={() => setToRemove(category)}
                />
              </div>
            </li>
          ))}
        </ul>
      )}

      {nameDialog && (
        <CategoryNameDialog
          category={nameDialog.category}
          isPending={create.isPending || rename.isPending}
          onClose={() => setNameDialog(null)}
          onSubmit={async (name) => {
            if (nameDialog.category) {
              await rename.mutateAsync({ id: nameDialog.category.id, name })
              toast.success('Guardamos el nombre de la categoría.')
            } else {
              await create.mutateAsync(name)
              toast.success('Creamos la categoría.')
            }
            setNameDialog(null)
          }}
        />
      )}

      <SimpleConfirmDialog
        open={toRemove != null}
        onOpenChange={(open) => !open && setToRemove(null)}
        title={`Dar de baja «${toRemove?.name ?? ''}»`}
        description={describeCategoryRemoval(
          toRemove?.name ?? '',
          toRemove ? (countsQuery.data?.get(toRemove.id) ?? 0) : 0,
        )}
        confirmLabel="Dar de baja"
        isLoading={remove.isPending}
        onConfirm={() => void handleRemove()}
      />
    </section>
  )
}

/** Alta o cambio de nombre. El error del servidor (nombre repetido, vacío) va tal cual. */
function CategoryNameDialog({
  category,
  isPending,
  onClose,
  onSubmit,
}: {
  category?: ClientCategory
  isPending: boolean
  onClose: () => void
  onSubmit: (name: string) => Promise<void>
}) {
  const [name, setName] = useState(category?.name ?? '')
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault()
    setError(null)
    try {
      await onSubmit(name)
    } catch (failure) {
      setError(
        isApiError(failure)
          ? failure.message
          : 'No pudimos guardar la categoría.',
      )
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <form
          noValidate
          onSubmit={(event) => void handleSubmit(event)}
          className="flex flex-col gap-4"
        >
          <DialogHeader>
            <DialogTitle>
              {category ? 'Cambiar el nombre' : 'Nueva categoría'}
            </DialogTitle>
          </DialogHeader>
          <Field>
            <FieldLabel htmlFor="client-category-name">Nombre</FieldLabel>
            <Input
              id="client-category-name"
              value={name}
              maxLength={60}
              onChange={(event) => setName(event.target.value)}
            />
          </Field>
          {error && (
            <p role="alert" className="text-[12.5px] text-danger">
              {error}
            </p>
          )}
          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              onClick={onClose}
              disabled={isPending}
            >
              Cancelar
            </Button>
            <Button type="submit" loading={isPending}>
              Guardar
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

export { ClientCategoriesSection }
