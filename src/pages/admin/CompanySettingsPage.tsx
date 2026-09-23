import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Field, FieldError, FieldLabel } from '@/components/ui/field'
import { Skeleton } from '@/components/ui/skeleton'
import { isApiError } from '@/api/errors'
import { useAuth } from '@/features/auth/AuthProvider'
import { ConfigNav } from '@/features/settings/components/ConfigNav'
import { LogoUploader } from '@/features/settings/components/LogoUploader'
import {
  canEditCompanyDetails,
  canEditCompanyLogo,
} from '@/features/settings/permissions'
import {
  useCompanySettingsQuery,
  useUpdateCompanySettingsMutation,
} from '@/features/settings/queries'
import {
  companyDetailsSchema,
  type CompanyDetailsFormValues,
} from '@/features/settings/schemas'

/**
 * ADM-28 "Empresa" (USERS-012, `05` línea 92): nombre, logo, teléfono de
 * soporte y texto de consentimiento de ubicación. La visitan dueño y
 * administrador (`canEditCompanyLogo`), pero solo el dueño edita nombre,
 * teléfono y consentimiento (`canEditCompanyDetails`) -- para un
 * administrador esos tres campos ni se muestran (no un campo deshabilitado:
 * ocultarlo es más claro que un input gris sin explicación, y evita el error
 * de la revisión de P07.2 de "mostrar algo que el rol no puede tocar").
 */
export default function CompanySettingsPage() {
  const auth = useAuth()
  const canEditDetails = canEditCompanyDetails(auth)
  const canEditLogo = canEditCompanyLogo(auth)

  const companyQuery = useCompanySettingsQuery()
  const updateCompanySettings = useUpdateCompanySettingsMutation()

  const {
    register,
    handleSubmit,
    formState: { errors, isDirty },
  } = useForm<CompanyDetailsFormValues>({
    resolver: zodResolver(companyDetailsSchema),
    values: companyQuery.data
      ? {
          name: companyQuery.data.name ?? '',
          supportPhone: companyQuery.data.supportPhone ?? '',
          locationConsentText: companyQuery.data.locationConsentText ?? '',
        }
      : undefined,
  })

  async function onSubmit(values: CompanyDetailsFormValues) {
    try {
      await updateCompanySettings.mutateAsync({
        name: values.name ?? null,
        supportPhone: values.supportPhone ?? null,
        locationConsentText: values.locationConsentText ?? null,
        updatedBy: auth.userId as string,
      })
      toast.success('Guardamos los datos de la empresa.')
    } catch (error) {
      toast.error(
        isApiError(error) ? error.message : 'No pudimos guardar los cambios.',
      )
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <ConfigNav roles={auth.roles} />

      <div className="max-w-xl rounded-lg border border-border bg-surface p-5">
        <h2 className="mb-1 text-[14px] font-semibold text-text">Logo</h2>
        <p className="mb-3 text-[11.5px] text-text-3">
          Se muestra en la pantalla de ingreso y en el menú lateral.
        </p>
        {companyQuery.isLoading ? (
          <Skeleton className="h-16 w-48" />
        ) : (
          canEditLogo && (
            <LogoUploader
              logoPath={companyQuery.data?.logoPath ?? null}
              updatedBy={auth.userId as string}
            />
          )
        )}
      </div>

      {canEditDetails && (
        <form
          onSubmit={(event) => void handleSubmit(onSubmit)(event)}
          className="flex max-w-xl flex-col gap-4 rounded-lg border border-border bg-surface p-5"
        >
          <h2 className="text-[14px] font-semibold text-text">
            Datos generales
          </h2>

          {companyQuery.isLoading ? (
            <div className="flex flex-col gap-3">
              <Skeleton className="h-9" />
              <Skeleton className="h-9" />
              <Skeleton className="h-24" />
            </div>
          ) : (
            <>
              <Field data-invalid={Boolean(errors.name) || undefined}>
                <FieldLabel htmlFor="company-name">
                  Nombre de la empresa
                </FieldLabel>
                <Input
                  id="company-name"
                  aria-invalid={Boolean(errors.name)}
                  {...register('name')}
                />
                {errors.name && <FieldError>{errors.name.message}</FieldError>}
              </Field>

              <Field data-invalid={Boolean(errors.supportPhone) || undefined}>
                <FieldLabel htmlFor="company-support-phone">
                  Teléfono de soporte
                </FieldLabel>
                <Input
                  id="company-support-phone"
                  type="tel"
                  aria-invalid={Boolean(errors.supportPhone)}
                  {...register('supportPhone')}
                />
                {errors.supportPhone && (
                  <FieldError>{errors.supportPhone.message}</FieldError>
                )}
                <p className="text-[11px] text-text-3">
                  Se muestra en la pantalla de ingreso para quien no pueda
                  entrar.
                </p>
              </Field>

              <Field
                data-invalid={Boolean(errors.locationConsentText) || undefined}
              >
                <FieldLabel htmlFor="company-consent-text">
                  Texto de consentimiento de ubicación
                </FieldLabel>
                <Textarea
                  id="company-consent-text"
                  rows={4}
                  aria-invalid={Boolean(errors.locationConsentText)}
                  {...register('locationConsentText')}
                />
                {errors.locationConsentText && (
                  <FieldError>{errors.locationConsentText.message}</FieldError>
                )}
                <p className="text-[11px] text-text-3">
                  Se le muestra a cada empleado antes de pedirle permiso de
                  ubicación al fichar.
                </p>
              </Field>

              <Button
                type="submit"
                className="self-start"
                disabled={!isDirty}
                loading={updateCompanySettings.isPending}
              >
                Guardar cambios
              </Button>
            </>
          )}
        </form>
      )}
    </div>
  )
}
