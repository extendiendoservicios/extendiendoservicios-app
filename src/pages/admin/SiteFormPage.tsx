import { Controller, useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useNavigate, useParams, useSearchParams } from 'react-router'
import { toast } from 'sonner'
import { Building2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Switch } from '@/components/ui/switch'
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
import { MapPicker } from '@/components/map'
import { isApiError } from '@/api/errors'
import { useAuth } from '@/features/auth/AuthProvider'
import { useClientDetailQuery } from '@/features/clients/queries'
import {
  useCreateSiteMutation,
  useSiteDetailQuery,
  useUpdateSiteMutation,
} from '@/features/sites/queries'
import {
  SITE_STATUS_OPTIONS,
  siteFormSchema,
  siteFormValuesToInput,
  type SiteFormValues,
} from '@/features/sites/schemas'

/**
 * ADM-23 "Sede · formulario" (SITE-003, `05` línea 77): alta
 * (`/admin/sedes/nueva?cliente=`) y edición (`/admin/sedes/:id/editar`) en
 * una sola pantalla, mismo criterio que `ClientFormPage` — el modo lo
 * decide `useParams().id`. El cliente llega elegido: por el parámetro
 * `cliente` en el alta (lo pone el botón "Nueva sede" de la pestaña Sedes
 * de ADM-21) o por la sede misma en la edición; ninguno de los dos modos
 * deja elegir cliente en el formulario (una sede no cambia de dueño).
 */
export default function SiteFormPage() {
  const { id } = useParams<{ id: string }>()
  const isEditMode = id != null
  const [searchParams] = useSearchParams()
  const clientIdFromQuery = searchParams.get('cliente')
  const navigate = useNavigate()
  const auth = useAuth()

  const siteQuery = useSiteDetailQuery(id)
  const clientId = isEditMode ? siteQuery.data?.clientId : clientIdFromQuery
  const clientQuery = useClientDetailQuery(
    isEditMode ? undefined : (clientIdFromQuery ?? undefined),
  )
  const clientName = isEditMode
    ? siteQuery.data?.clientName
    : (clientQuery.data?.tradeName ?? clientQuery.data?.legalName)

  const createSite = useCreateSiteMutation(clientId ?? '')
  const updateSite = useUpdateSiteMutation(clientId ?? '')
  const isSaving = createSite.isPending || updateSite.isPending

  const {
    control,
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<SiteFormValues>({
    resolver: zodResolver(siteFormSchema),
    defaultValues: {
      name: '',
      address: '',
      city: '',
      coordinates: null,
      contactName: '',
      contactPhone: '',
      accessInstructions: '',
      buildingHours: '',
      phoneRestricted: false,
      photosNotAllowed: false,
      restrictionsNotes: '',
      status: 'active',
    },
    values: siteQuery.data
      ? {
          name: siteQuery.data.name,
          address: siteQuery.data.address,
          city: siteQuery.data.city ?? '',
          coordinates:
            siteQuery.data.latitude != null && siteQuery.data.longitude != null
              ? { lat: siteQuery.data.latitude, lng: siteQuery.data.longitude }
              : null,
          contactName: siteQuery.data.contactName ?? '',
          contactPhone: siteQuery.data.contactPhone ?? '',
          accessInstructions: siteQuery.data.accessInstructions ?? '',
          buildingHours: siteQuery.data.buildingHours ?? '',
          phoneRestricted: siteQuery.data.phoneRestricted,
          photosNotAllowed: siteQuery.data.photosNotAllowed,
          restrictionsNotes: siteQuery.data.restrictionsNotes ?? '',
          status: siteQuery.data.status,
        }
      : undefined,
  })

  async function onSubmit(values: SiteFormValues) {
    if (!clientId) {
      toast.error('Falta el cliente de esta sede.')
      return
    }
    const input = siteFormValuesToInput(values)
    try {
      if (isEditMode) {
        const site = await updateSite.mutateAsync({
          id,
          input,
          updatedBy: auth.userId as string,
        })
        toast.success('Guardamos los cambios de la sede.')
        void navigate(`/admin/sedes/${site.id}`)
      } else {
        const site = await createSite.mutateAsync({
          input,
          createdBy: auth.userId as string,
        })
        toast.success('Creamos la sede.')
        void navigate(`/admin/sedes/${site.id}`)
      }
    } catch (error) {
      toast.error(
        isApiError(error) ? error.message : 'No pudimos guardar la sede.',
      )
    }
  }

  if (!isEditMode && !clientIdFromQuery) {
    return (
      <EmptyState
        icon={Building2}
        title="Falta elegir el cliente"
        description='Entrá a esta pantalla desde "Nueva sede" en la ficha de un cliente.'
      />
    )
  }

  // A la espera del detalle en modo edición: mismo esqueleto que `ClientFormPage`.
  if (isEditMode && siteQuery.isLoading) {
    return (
      <div className="flex max-w-xl flex-col gap-3">
        <Skeleton className="h-9" />
        <Skeleton className="h-9" />
        <Skeleton className="h-9" />
        <Skeleton className="h-48" />
      </div>
    )
  }

  return (
    <form
      noValidate
      onSubmit={(event) => void handleSubmit(onSubmit)(event)}
      className="flex max-w-2xl flex-col gap-4"
    >
      {clientName && (
        <p className="text-[12px] text-text-3">
          Sede de{' '}
          <span className="font-semibold text-text-2">{clientName}</span>
        </p>
      )}

      <div className="grid grid-cols-1 gap-4 rounded-lg border border-border bg-surface p-5 sm:grid-cols-2">
        <Field data-invalid={Boolean(errors.name) || undefined}>
          <FieldLabel htmlFor="site-name">Nombre</FieldLabel>
          <Input
            id="site-name"
            aria-invalid={Boolean(errors.name)}
            {...register('name')}
          />
          {errors.name && <FieldError>{errors.name.message}</FieldError>}
        </Field>

        <Field data-invalid={Boolean(errors.status) || undefined}>
          <FieldLabel htmlFor="site-status">Estado</FieldLabel>
          <Controller
            control={control}
            name="status"
            render={({ field }) => (
              <Select value={field.value} onValueChange={field.onChange}>
                <SelectTrigger id="site-status" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {SITE_STATUS_OPTIONS.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          />
        </Field>

        <Field data-invalid={Boolean(errors.address) || undefined}>
          <FieldLabel htmlFor="site-address">Dirección</FieldLabel>
          <Input
            id="site-address"
            aria-invalid={Boolean(errors.address)}
            {...register('address')}
          />
          {errors.address && <FieldError>{errors.address.message}</FieldError>}
        </Field>

        <Field data-invalid={Boolean(errors.city) || undefined}>
          <FieldLabel htmlFor="site-city">Localidad</FieldLabel>
          <Input id="site-city" {...register('city')} />
          {errors.city && <FieldError>{errors.city.message}</FieldError>}
        </Field>

        <Field data-invalid={Boolean(errors.contactName) || undefined}>
          <FieldLabel htmlFor="site-contact-name">
            Contacto en la sede
          </FieldLabel>
          <Input id="site-contact-name" {...register('contactName')} />
          {errors.contactName && (
            <FieldError>{errors.contactName.message}</FieldError>
          )}
        </Field>

        <Field data-invalid={Boolean(errors.contactPhone) || undefined}>
          <FieldLabel htmlFor="site-contact-phone">
            Teléfono de contacto
          </FieldLabel>
          <Input id="site-contact-phone" {...register('contactPhone')} />
          {errors.contactPhone && (
            <FieldError>{errors.contactPhone.message}</FieldError>
          )}
        </Field>

        <Field data-invalid={Boolean(errors.buildingHours) || undefined}>
          <FieldLabel htmlFor="site-building-hours">
            Horario del edificio
          </FieldLabel>
          <Input
            id="site-building-hours"
            placeholder="Lun a vie 7 a 20"
            {...register('buildingHours')}
          />
          {errors.buildingHours && (
            <FieldError>{errors.buildingHours.message}</FieldError>
          )}
        </Field>

        <Field
          className="sm:col-span-2"
          data-invalid={Boolean(errors.accessInstructions) || undefined}
        >
          <FieldLabel htmlFor="site-access-instructions">
            Instrucciones de acceso
          </FieldLabel>
          <Textarea
            id="site-access-instructions"
            rows={2}
            {...register('accessInstructions')}
          />
          {errors.accessInstructions && (
            <FieldError>{errors.accessInstructions.message}</FieldError>
          )}
        </Field>
      </div>

      <div className="flex flex-col gap-4 rounded-lg border border-border bg-surface p-5">
        <h2 className="text-[14px] font-semibold text-text">
          Restricciones informativas
        </h2>
        <div className="flex flex-col gap-3">
          <label
            htmlFor="site-phone-restricted"
            className="flex items-center justify-between gap-3 text-[13px] font-medium text-text"
          >
            No usar el teléfono en la sede
            <Controller
              control={control}
              name="phoneRestricted"
              render={({ field }) => (
                <Switch
                  id="site-phone-restricted"
                  checked={field.value}
                  onCheckedChange={field.onChange}
                />
              )}
            />
          </label>
          <label
            htmlFor="site-photos-not-allowed"
            className="flex items-center justify-between gap-3 text-[13px] font-medium text-text"
          >
            No se permiten fotos
            <Controller
              control={control}
              name="photosNotAllowed"
              render={({ field }) => (
                <Switch
                  id="site-photos-not-allowed"
                  checked={field.value}
                  onCheckedChange={field.onChange}
                />
              )}
            />
          </label>
        </div>
        <Field data-invalid={Boolean(errors.restrictionsNotes) || undefined}>
          <FieldLabel htmlFor="site-restrictions-notes">
            Otras restricciones
          </FieldLabel>
          <Textarea
            id="site-restrictions-notes"
            rows={2}
            {...register('restrictionsNotes')}
          />
          {errors.restrictionsNotes && (
            <FieldError>{errors.restrictionsNotes.message}</FieldError>
          )}
        </Field>
      </div>

      <div className="rounded-lg border border-border bg-surface p-5">
        <h2 className="mb-1 text-[14px] font-semibold text-text">
          Ubicación (opcional)
        </h2>
        <p className="mb-3 text-[11.5px] text-text-3">
          Coordenadas de la sede, para verla en el mapa de sedes.
        </p>
        <Controller
          control={control}
          name="coordinates"
          render={({ field }) => (
            <MapPicker value={field.value} onChange={field.onChange} />
          )}
        />
      </div>

      <div className="flex gap-2">
        <Button type="submit" loading={isSaving}>
          {isEditMode ? 'Guardar cambios' : 'Crear sede'}
        </Button>
        <Button
          type="button"
          variant="ghost"
          onClick={() => void navigate(-1)}
          disabled={isSaving}
        >
          Cancelar
        </Button>
      </div>
    </form>
  )
}
