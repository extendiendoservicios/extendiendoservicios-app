import { useState } from 'react'
import { Controller, useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { Link, useNavigate, useParams } from 'react-router'
import { toast } from 'sonner'
import { PackageX } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Field, FieldError, FieldLabel } from '@/components/ui/field'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { EmptyState } from '@/components/EmptyState'
import { isApiError } from '@/api/errors'
import type { StockItem } from '@/api/stock'
import { useAuth } from '@/features/auth/AuthProvider'
import {
  useSaveSupplyMutation,
  useStockItemQuery,
  useSupplyCategoriesQuery,
  useSupplyImageUrls,
} from '@/features/stock/queries'
import {
  supplyCreateSchema,
  supplyEditSchema,
  supplyToFormValues,
  supplyValuesToInput,
  type SupplyCreateFormValues,
  type SupplyEditFormValues,
} from '@/features/stock/schemas'
import { canManageStock } from '@/features/stock/permissions'
import { SupplyImageField, type SupplyImageDraft } from './SupplyImageField'

const EMPTY_CREATE_VALUES: SupplyCreateFormValues = {
  code: '',
  name: '',
  presentation: '',
  categoryId: '',
  minQty: '',
  costPrice: '',
  salePrice: '',
  notes: '',
}

/**
 * Nuevo artículo y Editar artículo (`/admin/insumos/nuevo` y
 * `/admin/insumos/:id/editar`, IS-01 a IS-07). Código, nombre, presentación,
 * categoría, mínimo opcional, notas e imagen opcional. Los precios se cargan
 * solo en el alta; en la edición se cambian desde la ficha (historial).
 */
function SupplyFormScreen() {
  const { id } = useParams()
  const isEdit = id != null
  const auth = useAuth()
  const canManage = canManageStock(auth)
  const itemQuery = useStockItemQuery(id)
  const categoriesQuery = useSupplyCategoriesQuery()

  if (!canManage) {
    return (
      <EmptyState
        icon={PackageX}
        title="No tenés permiso para cargar ni editar artículos"
        description="Pedile a la dueña el permiso «Gestionar stock»."
        action={
          <Button asChild variant="ghost">
            <Link to="/admin/insumos">Volver a Insumos</Link>
          </Button>
        }
      />
    )
  }

  if (isEdit && (itemQuery.isLoading || categoriesQuery.isLoading)) {
    return (
      <div className="flex max-w-2xl flex-col gap-3">
        <Skeleton className="h-9" />
        <Skeleton className="h-9" />
        <Skeleton className="h-9" />
        <Skeleton className="h-32" />
      </div>
    )
  }

  if (isEdit && !itemQuery.data) {
    return (
      <EmptyState
        icon={PackageX}
        title="No encontramos este artículo"
        description="Puede que se haya movido o que el enlace esté roto."
        action={
          <Button asChild variant="ghost">
            <Link to="/admin/insumos">Volver a Insumos</Link>
          </Button>
        }
      />
    )
  }

  return <SupplyForm item={itemQuery.data ?? null} />
}

function SupplyForm({ item }: { item: StockItem | null }) {
  const isEdit = item != null
  const navigate = useNavigate()
  const categoriesQuery = useSupplyCategoriesQuery()
  const save = useSaveSupplyMutation()
  const [image, setImage] = useState<SupplyImageDraft>({ action: 'keep' })
  const imageUrls = useSupplyImageUrls([item?.imagePath ?? null])

  const {
    register,
    handleSubmit,
    control,
    setError,
    formState: { errors },
  } = useForm<SupplyCreateFormValues>({
    resolver: zodResolver(
      isEdit ? supplyEditSchema : supplyCreateSchema,
    ) as never,
    defaultValues: item
      ? { ...EMPTY_CREATE_VALUES, ...supplyToFormValues(item) }
      : EMPTY_CREATE_VALUES,
  })

  // Categorías activas; en una edición también la que ya tiene, aunque esté desactivada.
  const categoryOptions = (categoriesQuery.data ?? []).filter(
    (category) => category.active || category.id === item?.categoryId,
  )

  async function onSubmit(
    values: SupplyCreateFormValues | SupplyEditFormValues,
  ) {
    const input = supplyValuesToInput(values, item?.id)
    try {
      const saved = await save.mutateAsync({
        input,
        image: {
          action: image.action,
          blob: image.action === 'replace' ? image.blob : undefined,
          currentPath: item?.imagePath ?? null,
        },
      })
      toast.success(
        isEdit
          ? 'Guardamos los cambios del artículo.'
          : 'Cargamos el artículo.',
      )
      void navigate(`/admin/insumos/${saved.id}`)
    } catch (error) {
      if (isApiError(error) && error.hint === 'CODE_ALREADY_EXISTS') {
        setError('code', { message: error.message })
      }
      toast.error(
        isApiError(error) ? error.message : 'No pudimos guardar el artículo.',
      )
    }
  }

  return (
    <form
      noValidate
      onSubmit={(event) => void handleSubmit(onSubmit)(event)}
      className="flex max-w-2xl flex-col gap-4"
    >
      <div className="rounded-lg border border-border bg-surface p-5">
        <h2 className="mb-3 text-[14px] font-semibold text-text">
          Imagen del artículo
        </h2>
        <SupplyImageField
          currentPath={item?.imagePath ?? null}
          currentUrl={
            item?.imagePath ? imageUrls.get(item.imagePath) : undefined
          }
          value={image}
          onChange={setImage}
          disabled={save.isPending}
        />
      </div>

      <div className="grid grid-cols-1 gap-4 rounded-lg border border-border bg-surface p-5 sm:grid-cols-2">
        <Field data-invalid={Boolean(errors.code) || undefined}>
          <FieldLabel htmlFor="supply-code">Código interno</FieldLabel>
          <Input
            id="supply-code"
            autoComplete="off"
            aria-invalid={Boolean(errors.code)}
            {...register('code')}
          />
          {errors.code && <FieldError>{errors.code.message}</FieldError>}
        </Field>

        <Field data-invalid={Boolean(errors.categoryId) || undefined}>
          <FieldLabel htmlFor="supply-category">Categoría</FieldLabel>
          <Controller
            control={control}
            name="categoryId"
            render={({ field }) => (
              <Select value={field.value} onValueChange={field.onChange}>
                <SelectTrigger
                  id="supply-category"
                  aria-invalid={Boolean(errors.categoryId)}
                  className="w-full"
                >
                  <SelectValue placeholder="Elegí una categoría" />
                </SelectTrigger>
                <SelectContent>
                  {categoryOptions.map((category) => (
                    <SelectItem key={category.id} value={category.id}>
                      {category.name}
                      {category.active ? '' : ' (desactivada)'}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          />
          {errors.categoryId && (
            <FieldError>{errors.categoryId.message}</FieldError>
          )}
        </Field>

        <Field data-invalid={Boolean(errors.name) || undefined}>
          <FieldLabel htmlFor="supply-name">Artículo</FieldLabel>
          <Input
            id="supply-name"
            autoComplete="off"
            aria-invalid={Boolean(errors.name)}
            {...register('name')}
          />
          {errors.name && <FieldError>{errors.name.message}</FieldError>}
        </Field>

        <Field data-invalid={Boolean(errors.presentation) || undefined}>
          <FieldLabel htmlFor="supply-presentation">
            Presentación (opcional)
          </FieldLabel>
          <Input
            id="supply-presentation"
            autoComplete="off"
            placeholder="Por ejemplo, bidón de 5 L"
            aria-invalid={Boolean(errors.presentation)}
            {...register('presentation')}
          />
          {errors.presentation && (
            <FieldError>{errors.presentation.message}</FieldError>
          )}
        </Field>

        <Field data-invalid={Boolean(errors.minQty) || undefined}>
          <FieldLabel htmlFor="supply-min">Stock mínimo (opcional)</FieldLabel>
          <Input
            id="supply-min"
            inputMode="numeric"
            autoComplete="off"
            aria-invalid={Boolean(errors.minQty)}
            {...register('minQty')}
          />
          <p className="text-[11px] text-text-3">
            Si el stock llega a este número o baja de él, la fila se marca en
            amarillo. Sin mínimo, no avisa.
          </p>
          {errors.minQty && <FieldError>{errors.minQty.message}</FieldError>}
        </Field>

        {!isEdit && (
          <>
            <Field data-invalid={Boolean(errors.costPrice) || undefined}>
              <FieldLabel htmlFor="supply-cost">Precio de costo ($)</FieldLabel>
              <Input
                id="supply-cost"
                inputMode="decimal"
                autoComplete="off"
                aria-invalid={Boolean(errors.costPrice)}
                {...register('costPrice')}
              />
              {errors.costPrice && (
                <FieldError>{errors.costPrice.message}</FieldError>
              )}
            </Field>
            <Field data-invalid={Boolean(errors.salePrice) || undefined}>
              <FieldLabel htmlFor="supply-sale">Precio de venta ($)</FieldLabel>
              <Input
                id="supply-sale"
                inputMode="decimal"
                autoComplete="off"
                aria-invalid={Boolean(errors.salePrice)}
                {...register('salePrice')}
              />
              {errors.salePrice && (
                <FieldError>{errors.salePrice.message}</FieldError>
              )}
            </Field>
          </>
        )}

        <Field
          className="sm:col-span-2"
          data-invalid={Boolean(errors.notes) || undefined}
        >
          <FieldLabel htmlFor="supply-notes">Notas (opcional)</FieldLabel>
          <Textarea
            id="supply-notes"
            rows={3}
            aria-invalid={Boolean(errors.notes)}
            {...register('notes')}
          />
          {errors.notes && <FieldError>{errors.notes.message}</FieldError>}
        </Field>

        {isEdit && (
          <p className="text-[11.5px] text-text-3 sm:col-span-2">
            Los precios se cambian desde la ficha del artículo, con «Cambiar
            precios»: así queda el historial.
          </p>
        )}
      </div>

      <div className="flex flex-wrap justify-end gap-2">
        <Button asChild variant="ghost">
          <Link to={item ? `/admin/insumos/${item.id}` : '/admin/insumos'}>
            Cancelar
          </Link>
        </Button>
        <Button type="submit" loading={save.isPending}>
          {isEdit ? 'Guardar cambios' : 'Cargar artículo'}
        </Button>
      </div>
    </form>
  )
}

export { SupplyFormScreen }
