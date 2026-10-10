import { Controller, useForm, useWatch } from 'react-hook-form'
import { formatTaxId, formatTaxIdWhileTyping } from '@/lib/taxId'
import { zodResolver } from '@hookform/resolvers/zod'
import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useNavigate, useParams } from 'react-router'
import { toast } from 'sonner'
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
import { MapPicker } from '@/components/map'
import { ClientPhotoUpload } from '@/components/ClientPhotoUpload'
import { PendingPhotoPicker } from '@/components/PendingPhotoPicker'
import { savePhoto } from '@/api/photos'
import { isApiError } from '@/api/errors'
import { useAuth } from '@/features/auth/AuthProvider'
import { BankDetailsFields } from '@/features/bank/components/BankDetailsFields'
import {
  bankDetailsToFormValues,
  bankFormValuesToInput,
  isBankFormEmpty,
} from '@/features/bank/schemas'
import {
  useClientBankDetailsQuery,
  useSetClientBankDetailsMutation,
} from '@/features/bank/queries'
import {
  clientsKeys,
  useClientDetailQuery,
  useCreateClientMutation,
  useUpdateClientMutation,
} from '@/features/clients/queries'
import {
  CLIENT_STATUS_OPTIONS,
  clientFormSchema,
  clientFormValuesToInput,
  type ClientFormValues,
} from '@/features/clients/schemas'

/**
 * ADM-20 "Cliente · formulario" (CLIENT-003, `05` línea 74): alta
 * (`/admin/clientes/nuevo`) y edición (`/admin/clientes/:id/editar`) en una
 * sola pantalla, mismo criterio que las páginas de F7 (`CompanySettingsPage`)
 * — el modo lo decide `useParams().id`.
 *
 * Coordenadas con `MapPicker` (SITE-004, P08.2): `clients.latitude`/
 * `longitude` existen en el modelo (`04` sección 2.2), así que la pantalla
 * las usa tal cual pide el encargo.
 */
export default function ClientFormPage() {
  const { id } = useParams<{ id: string }>()
  const isEditMode = id != null
  const navigate = useNavigate()
  const auth = useAuth()

  const clientQuery = useClientDetailQuery(id)
  const createClient = useCreateClientMutation()
  const updateClient = useUpdateClientMutation()
  const bankQuery = useClientBankDetailsQuery(id)
  const setBankDetails = useSetClientBankDetailsMutation()
  const isSaving =
    createClient.isPending || updateClient.isPending || setBankDetails.isPending
  const queryClient = useQueryClient()
  // AJ2-07: foto elegida en el alta; se sube después de crear el cliente.
  const [pendingPhoto, setPendingPhoto] = useState<Blob | null>(null)

  const {
    control,
    register,
    handleSubmit,
    setValue,
    formState: { errors },
  } = useForm<ClientFormValues>({
    resolver: zodResolver(clientFormSchema),
    defaultValues: {
      legalName: '',
      tradeName: '',
      cuit: '',
      adminAddress: '',
      coordinates: null,
      status: 'active',
      notes: '',
      bankName: '',
      cbu: '',
      alias: '',
    },
    values:
      clientQuery.data && !bankQuery.isLoading
        ? {
            legalName: clientQuery.data.legalName,
            tradeName: clientQuery.data.tradeName ?? '',
            cuit: formatTaxId(clientQuery.data.cuit) ?? '',
            adminAddress: clientQuery.data.adminAddress ?? '',
            coordinates:
              clientQuery.data.latitude != null &&
              clientQuery.data.longitude != null
                ? {
                    lat: clientQuery.data.latitude,
                    lng: clientQuery.data.longitude,
                  }
                : null,
            status: clientQuery.data.status,
            notes: clientQuery.data.notes ?? '',
            ...bankDetailsToFormValues(bankQuery.data),
          }
        : undefined,
  })

  const [
    watchedTradeName,
    watchedLegalName,
    watchedBankName,
    watchedCbu,
    watchedAlias,
  ] = useWatch({
    control,
    name: ['tradeName', 'legalName', 'bankName', 'cbu', 'alias'],
  })

  // AJ2-04: se guardan por RPC aparte, después del cliente. Si la lectura de lo
  // guardado falló no se pisa nada, y si no había datos ni se cargaron, no se llama.
  async function saveBankDetails(
    clientId: string,
    values: ClientFormValues,
  ): Promise<string | null> {
    if (isEditMode && bankQuery.isError) {
      return null
    }
    if (isBankFormEmpty(values) && !bankQuery.data) {
      return null
    }
    try {
      await setBankDetails.mutateAsync({
        clientId,
        input: bankFormValuesToInput(values),
      })
      return null
    } catch (error) {
      return isApiError(error)
        ? error.message
        : 'No pudimos guardar los datos bancarios.'
    }
  }

  async function onSubmit(values: ClientFormValues) {
    const input = clientFormValuesToInput(values)
    try {
      if (isEditMode) {
        const client = await updateClient.mutateAsync({
          id,
          input,
          updatedBy: auth.userId as string,
        })
        const bankError = await saveBankDetails(client.id, values)
        if (bankError) {
          toast.warning(
            `Guardamos los cambios del cliente, pero no los datos bancarios: ${bankError}`,
          )
          return
        }
        toast.success('Guardamos los cambios del cliente.')
        void navigate(`/admin/clientes/${client.id}`)
      } else {
        const client = await createClient.mutateAsync({
          input,
          createdBy: auth.userId as string,
        })
        const clientName =
          (values.tradeName ?? '').trim() || values.legalName.trim()
        // El alta ya está hecha: si los datos bancarios fallan, se avisa y se sigue.
        const bankError = await saveBankDetails(client.id, values)
        if (bankError) {
          toast.warning(
            `Se creó ${clientName}, pero no se guardaron los datos bancarios: ${bankError} Cargalos de nuevo desde Editar.`,
          )
          void navigate(`/admin/clientes/${client.id}`)
          return
        }
        if (pendingPhoto) {
          // El alta ya está hecha: si la foto falla, no se deshace (AJ2-07).
          try {
            await savePhoto('client', client.id, pendingPhoto)
            void queryClient.invalidateQueries({ queryKey: clientsKeys.all })
            toast.success('Creamos el cliente.')
          } catch {
            toast.warning(
              `Se creó ${clientName}, pero no se pudo guardar la foto. Probá de nuevo desde Editar.`,
            )
          }
        } else {
          toast.success('Creamos el cliente.')
        }
        void navigate(`/admin/clientes/${client.id}`)
      }
    } catch (error) {
      toast.error(
        isApiError(error) ? error.message : 'No pudimos guardar el cliente.',
      )
    }
  }

  // A la espera del detalle en modo edición: mismo esqueleto que
  // `CompanySettingsPage`, no bloquea el formulario entero.
  if (isEditMode && (clientQuery.isLoading || bankQuery.isLoading)) {
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
      <div className="rounded-lg border border-border bg-surface p-5">
        <h2 className="mb-3 text-[14px] font-semibold text-text">
          Foto del cliente
        </h2>
        {isEditMode && clientQuery.data ? (
          <ClientPhotoUpload
            clientId={clientQuery.data.id}
            name={clientQuery.data.tradeName ?? clientQuery.data.legalName}
            photoPath={clientQuery.data.photoPath}
            onChange={() =>
              void queryClient.invalidateQueries({ queryKey: clientsKeys.all })
            }
          />
        ) : (
          <PendingPhotoPicker
            name={watchedTradeName || watchedLegalName || ''}
            value={pendingPhoto}
            onChange={setPendingPhoto}
            label="Elegir foto del cliente"
          />
        )}
      </div>

      <div className="grid grid-cols-1 gap-4 rounded-lg border border-border bg-surface p-5 sm:grid-cols-2">
        <Field data-invalid={Boolean(errors.legalName) || undefined}>
          <FieldLabel htmlFor="client-legal-name">Razón social</FieldLabel>
          <Input
            id="client-legal-name"
            aria-invalid={Boolean(errors.legalName)}
            {...register('legalName')}
          />
          {errors.legalName && (
            <FieldError>{errors.legalName.message}</FieldError>
          )}
        </Field>

        <Field data-invalid={Boolean(errors.tradeName) || undefined}>
          <FieldLabel htmlFor="client-trade-name">
            Nombre de fantasía
          </FieldLabel>
          <Input id="client-trade-name" {...register('tradeName')} />
          {errors.tradeName && (
            <FieldError>{errors.tradeName.message}</FieldError>
          )}
        </Field>

        <Field data-invalid={Boolean(errors.cuit) || undefined}>
          <FieldLabel htmlFor="client-cuit">CUIT</FieldLabel>
          <Controller
            control={control}
            name="cuit"
            render={({ field }) => (
              <Input
                id="client-cuit"
                inputMode="numeric"
                placeholder="20-12345678-6"
                aria-invalid={Boolean(errors.cuit)}
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
          {errors.cuit && <FieldError>{errors.cuit.message}</FieldError>}
        </Field>

        <Field data-invalid={Boolean(errors.status) || undefined}>
          <FieldLabel htmlFor="client-status">Estado</FieldLabel>
          <Controller
            control={control}
            name="status"
            render={({ field }) => (
              <Select value={field.value} onValueChange={field.onChange}>
                <SelectTrigger id="client-status" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {CLIENT_STATUS_OPTIONS.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          />
        </Field>

        <Field
          className="sm:col-span-2"
          data-invalid={Boolean(errors.adminAddress) || undefined}
        >
          <FieldLabel htmlFor="client-admin-address">
            Dirección administrativa
          </FieldLabel>
          <Input id="client-admin-address" {...register('adminAddress')} />
          {errors.adminAddress && (
            <FieldError>{errors.adminAddress.message}</FieldError>
          )}
        </Field>

        <Field
          className="sm:col-span-2"
          data-invalid={Boolean(errors.notes) || undefined}
        >
          <FieldLabel htmlFor="client-notes">Notas</FieldLabel>
          <Textarea id="client-notes" rows={3} {...register('notes')} />
          {errors.notes && <FieldError>{errors.notes.message}</FieldError>}
        </Field>
      </div>

      <BankDetailsFields
        id="client"
        values={{
          bankName: watchedBankName,
          cbu: watchedCbu,
          alias: watchedAlias,
        }}
        errors={{
          bankName: errors.bankName?.message,
          cbu: errors.cbu?.message,
          alias: errors.alias?.message,
        }}
        onChange={(field, value) =>
          setValue(field, value, {
            shouldDirty: true,
            shouldValidate: Boolean(errors[field]),
          })
        }
      />

      <div className="rounded-lg border border-border bg-surface p-5">
        <h2 className="mb-1 text-[14px] font-semibold text-text">
          Ubicación (opcional)
        </h2>
        <p className="mb-3 text-[11.5px] text-text-3">
          Coordenadas de la dirección administrativa, para verlas en el mapa de
          clientes.
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
          {isEditMode ? 'Guardar cambios' : 'Crear cliente'}
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
