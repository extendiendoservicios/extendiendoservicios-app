import { useMemo } from 'react'
import { Controller, useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useNavigate } from 'react-router'
import { toast } from 'sonner'
import { Megaphone } from 'lucide-react'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Skeleton } from '@/components/ui/skeleton'
import { Field, FieldError, FieldLabel } from '@/components/ui/field'
import { DatePicker } from '@/components/DatePicker'
import { EmptyState } from '@/components/EmptyState'
import { SegmentedControl } from '@/components/SegmentedControl'
import {
  ANNOUNCEMENT_BODY_MAX,
  ANNOUNCEMENT_TITLE_MAX,
} from '@/api/announcements'
import { isApiError } from '@/api/errors'
import { useEmployeesQuery } from '@/features/employees/queries'
import { localDateToIsoDate } from '@/features/settings/dateOnly'
import {
  useAnnouncementQuery,
  useAnnouncementRecipientIdsQuery,
  useCreateAnnouncementMutation,
  useUpdateAnnouncementMutation,
} from '@/features/announcements/queries'
import {
  AUDIENCE_OPTIONS,
  EMPTY_ANNOUNCEMENT_FORM,
  announcementValuesToInput,
  createAnnouncementFormSchema,
  type AnnouncementFormValues,
} from '@/features/announcements/schemas'
import { RecipientPicker, type RecipientCandidate } from './RecipientPicker'

function isoDateToDate(isoDate: string): Date | undefined {
  return isoDate ? new Date(`${isoDate}T00:00:00`) : undefined
}

/**
 * Formulario de alta y edición de anuncios (AJ2-03): `/admin/anuncios/nuevo` y
 * `/admin/anuncios/:id/editar`. El modo lo decide `announcementId`.
 */
export function AnnouncementForm({
  announcementId,
}: {
  announcementId?: string
}) {
  const isEditMode = announcementId != null
  const navigate = useNavigate()

  const announcementQuery = useAnnouncementQuery(announcementId)
  const announcement = announcementQuery.data
  const savedIdsQuery = useAnnouncementRecipientIdsQuery(
    announcementId,
    announcement?.audience === 'custom',
  )
  // Empleados y supervisores no dados de baja (la licencia no los saca de la lista).
  const peopleQuery = useEmployeesQuery({ status: 'all' })
  const candidates = useMemo<RecipientCandidate[]>(
    () =>
      (peopleQuery.data ?? [])
        .filter(
          (person) =>
            person.effectiveStatus !== 'terminated' &&
            (person.roles.includes('employee') ||
              person.roles.includes('supervisor')),
        )
        .map((person) => ({
          profileId: person.profileId,
          name: `${person.firstName} ${person.lastName}`,
          employeeNumber: person.roles.includes('employee')
            ? person.employeeNumber
            : null,
          roles: person.roles,
        })),
    [peopleQuery.data],
  )

  const createMutation = useCreateAnnouncementMutation()
  const updateMutation = useUpdateAnnouncementMutation(announcementId ?? '')
  const isSaving = createMutation.isPending || updateMutation.isPending

  const schema = useMemo(
    () =>
      createAnnouncementFormSchema({
        originalVisibleUntil: announcement?.visibleUntil ?? null,
      }),
    [announcement?.visibleUntil],
  )

  // Valores de la edición: recién cuando está todo cargado. Las personas
  // guardadas que ya no son candidatas (baja) se descartan para que el
  // servidor no las rechace con RECIPIENT_INVALID.
  const editValues = useMemo<AnnouncementFormValues | undefined>(() => {
    if (!isEditMode || !announcement) {
      return undefined
    }
    if (announcement.audience === 'custom') {
      if (!savedIdsQuery.data || peopleQuery.isLoading) {
        return undefined
      }
    }
    const valid = new Set(candidates.map((candidate) => candidate.profileId))
    return {
      title: announcement.title,
      body: announcement.body,
      audience: announcement.audience,
      visibleUntil: announcement.visibleUntil ?? '',
      recipientIds: (savedIdsQuery.data ?? []).filter((id) => valid.has(id)),
    }
  }, [
    isEditMode,
    announcement,
    savedIdsQuery.data,
    peopleQuery.isLoading,
    candidates,
  ])

  const {
    control,
    register,
    handleSubmit,
    watch,
    formState: { errors },
  } = useForm<AnnouncementFormValues>({
    resolver: zodResolver(schema),
    defaultValues: EMPTY_ANNOUNCEMENT_FORM,
    values: editValues,
  })

  const audience = watch('audience')
  const bodyLength = (watch('body') ?? '').length
  const today = localDateToIsoDate(new Date())

  async function onSubmit(values: AnnouncementFormValues) {
    const input = announcementValuesToInput(values)
    try {
      if (isEditMode) {
        await updateMutation.mutateAsync(input)
        toast.success('Guardamos los cambios del anuncio.')
        void navigate(`/admin/anuncios/${announcementId}`)
      } else {
        const id = await createMutation.mutateAsync(input)
        toast.success('Publicamos el anuncio.')
        void navigate(`/admin/anuncios/${id}`)
      }
    } catch (error) {
      toast.error(
        isApiError(error) ? error.message : 'No pudimos guardar el anuncio.',
      )
    }
  }

  if (isEditMode && announcementQuery.isLoading) {
    return (
      <div className="flex max-w-2xl flex-col gap-3">
        <Skeleton className="h-9" />
        <Skeleton className="h-32" />
        <Skeleton className="h-9" />
      </div>
    )
  }

  if (isEditMode && !announcement) {
    return (
      <EmptyState
        icon={Megaphone}
        title="No encontramos este anuncio"
        description="Puede que se haya movido o que el enlace esté roto."
      />
    )
  }

  if (isEditMode && announcement?.status === 'archived') {
    return (
      <EmptyState
        icon={Megaphone}
        title="Este anuncio está archivado"
        description="Un anuncio archivado ya no se puede editar."
        action={
          <Button
            variant="ghost"
            onClick={() => void navigate(`/admin/anuncios/${announcementId}`)}
          >
            Volver al anuncio
          </Button>
        }
      />
    )
  }

  const cancelTo = isEditMode
    ? `/admin/anuncios/${announcementId}`
    : '/admin/anuncios'

  return (
    <form
      noValidate
      onSubmit={(event) => void handleSubmit(onSubmit)(event)}
      className="flex max-w-2xl flex-col gap-4"
    >
      {isEditMode && (
        <Alert>
          <AlertDescription>
            Si cambiás el título o el texto, quienes ya lo leyeron lo van a
            volver a ver.
          </AlertDescription>
        </Alert>
      )}

      <div className="flex flex-col gap-4 rounded-lg border border-border bg-surface p-5">
        <Field data-invalid={Boolean(errors.title) || undefined}>
          <FieldLabel htmlFor="announcement-title">Título</FieldLabel>
          <Input
            id="announcement-title"
            maxLength={ANNOUNCEMENT_TITLE_MAX + 20}
            aria-invalid={Boolean(errors.title)}
            {...register('title')}
          />
          {errors.title && <FieldError>{errors.title.message}</FieldError>}
        </Field>

        <Field data-invalid={Boolean(errors.body) || undefined}>
          <FieldLabel htmlFor="announcement-body">Texto</FieldLabel>
          <Textarea
            id="announcement-body"
            rows={6}
            aria-invalid={Boolean(errors.body)}
            {...register('body')}
          />
          <p
            className={
              bodyLength > ANNOUNCEMENT_BODY_MAX
                ? 'text-right text-[11px] text-danger'
                : 'text-right text-[11px] text-text-3'
            }
          >
            {bodyLength} / {ANNOUNCEMENT_BODY_MAX}
          </p>
          {errors.body && <FieldError>{errors.body.message}</FieldError>}
        </Field>
      </div>

      <div className="flex flex-col gap-4 rounded-lg border border-border bg-surface p-5">
        <Field>
          <FieldLabel>Destinatarios</FieldLabel>
          <Controller
            control={control}
            name="audience"
            render={({ field }) => (
              <SegmentedControl
                aria-label="Destinatarios"
                options={AUDIENCE_OPTIONS}
                value={field.value}
                onValueChange={field.onChange}
              />
            )}
          />
        </Field>

        {audience === 'custom' && (
          <Field data-invalid={Boolean(errors.recipientIds) || undefined}>
            <Controller
              control={control}
              name="recipientIds"
              render={({ field }) => (
                <RecipientPicker
                  candidates={candidates}
                  value={field.value}
                  onValueChange={field.onChange}
                  loading={peopleQuery.isLoading}
                />
              )}
            />
            {errors.recipientIds && (
              <FieldError>{errors.recipientIds.message}</FieldError>
            )}
          </Field>
        )}

        <Field data-invalid={Boolean(errors.visibleUntil) || undefined}>
          <FieldLabel>Se muestra hasta (opcional)</FieldLabel>
          <Controller
            control={control}
            name="visibleUntil"
            render={({ field }) => (
              <div className="flex items-center gap-2">
                <DatePicker
                  aria-label="Se muestra hasta"
                  value={isoDateToDate(field.value)}
                  onValueChange={(date) =>
                    field.onChange(date ? localDateToIsoDate(date) : '')
                  }
                  placeholder="Sin vencimiento"
                />
                {field.value !== '' && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => field.onChange('')}
                  >
                    Quitar
                  </Button>
                )}
              </div>
            )}
          />
          <p className="text-[11px] text-text-3">
            Sin fecha, el anuncio se muestra hasta que lo archives. Hoy es{' '}
            {today.split('-').reverse().join('/')}.
          </p>
          {errors.visibleUntil && (
            <FieldError>{errors.visibleUntil.message}</FieldError>
          )}
        </Field>
      </div>

      <div className="flex flex-wrap justify-end gap-2">
        <Button
          type="button"
          variant="ghost"
          disabled={isSaving}
          onClick={() => void navigate(cancelTo)}
        >
          Cancelar
        </Button>
        <Button type="submit" loading={isSaving}>
          {isEditMode ? 'Guardar cambios' : 'Publicar anuncio'}
        </Button>
      </div>
    </form>
  )
}
