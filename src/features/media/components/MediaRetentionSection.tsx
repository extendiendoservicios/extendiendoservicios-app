import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { Link } from 'react-router'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Field, FieldError, FieldLabel } from '@/components/ui/field'
import { Skeleton } from '@/components/ui/skeleton'
import { isApiError } from '@/api/errors'
import { RETENTION_MAX_DAYS, RETENTION_MIN_DAYS } from '@/api/mediaAdmin'
import {
  useMediaRetentionQuery,
  useSetMediaRetentionMutation,
  useStorageUsageQuery,
} from '@/features/media/queries'
import {
  mediaRetentionSchema,
  retentionValuesToInput,
  type MediaRetentionFormValues,
} from '@/features/media/schemas'
import { StorageMeter } from './StorageMeter'

/**
 * Sección «Fotos y videos» de ADM-28 (H-08, H-17): los dos plazos de
 * vencimiento y el medidor de espacio. La editan el dueño y los
 * administradores (`set_media_retention`); un plazo nuevo vale también para
 * lo ya guardado.
 */
function MediaRetentionSection() {
  const retentionQuery = useMediaRetentionQuery()
  const usageQuery = useStorageUsageQuery()
  const setRetention = useSetMediaRetentionMutation()

  const {
    register,
    handleSubmit,
    formState: { errors, isDirty },
  } = useForm<MediaRetentionFormValues>({
    resolver: zodResolver(mediaRetentionSchema),
    values: retentionQuery.data
      ? {
          photoDays: String(retentionQuery.data.photoDays),
          videoDays: String(retentionQuery.data.videoDays),
        }
      : undefined,
  })

  async function onSubmit(values: MediaRetentionFormValues) {
    try {
      await setRetention.mutateAsync(retentionValuesToInput(values))
      toast.success('Guardamos los plazos de fotos y videos.')
    } catch (error) {
      toast.error(
        isApiError(error) ? error.message : 'No pudimos guardar los plazos.',
      )
    }
  }

  return (
    <section
      aria-labelledby="media-retention-title"
      className="flex max-w-xl flex-col gap-4"
    >
      <form
        noValidate
        onSubmit={(event) => void handleSubmit(onSubmit)(event)}
        className="flex flex-col gap-4 rounded-lg border border-border bg-surface p-5"
      >
        <div className="flex flex-col gap-1">
          <h2
            id="media-retention-title"
            className="text-[14px] font-semibold text-text"
          >
            Fotos y videos
          </h2>
          <p className="text-[11.5px] text-text-3">
            Las fotos y los videos de los turnos se borran solos cuando pasa el
            plazo. Lo que marcás como «Conservar» en{' '}
            <Link
              to="/admin/fotos"
              className="font-semibold text-primary-800 underline"
            >
              Fotos y videos
            </Link>{' '}
            no vence nunca. De cada archivo borrado queda la constancia en el
            turno.
          </p>
        </div>

        {retentionQuery.isLoading ? (
          <div className="grid grid-cols-2 gap-3">
            <Skeleton className="h-9" />
            <Skeleton className="h-9" />
          </div>
        ) : (
          <>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field data-invalid={Boolean(errors.photoDays) || undefined}>
                <FieldLabel htmlFor="media-photo-days">
                  Las fotos vencen a los (días)
                </FieldLabel>
                <Input
                  id="media-photo-days"
                  type="number"
                  inputMode="numeric"
                  min={RETENTION_MIN_DAYS}
                  max={RETENTION_MAX_DAYS}
                  aria-invalid={Boolean(errors.photoDays)}
                  {...register('photoDays')}
                />
                {errors.photoDays && (
                  <FieldError>{errors.photoDays.message}</FieldError>
                )}
              </Field>
              <Field data-invalid={Boolean(errors.videoDays) || undefined}>
                <FieldLabel htmlFor="media-video-days">
                  Los videos vencen a los (días)
                </FieldLabel>
                <Input
                  id="media-video-days"
                  type="number"
                  inputMode="numeric"
                  min={RETENTION_MIN_DAYS}
                  max={RETENTION_MAX_DAYS}
                  aria-invalid={Boolean(errors.videoDays)}
                  {...register('videoDays')}
                />
                {errors.videoDays && (
                  <FieldError>{errors.videoDays.message}</FieldError>
                )}
              </Field>
            </div>
            <p className="text-[11px] text-text-3">
              De {RETENTION_MIN_DAYS} a {RETENTION_MAX_DAYS} días. Se cuentan
              desde que se subió el archivo. Por defecto: fotos 60 días y videos
              30. Un plazo nuevo se aplica también a lo que ya está guardado.
            </p>
            <Button
              type="submit"
              className="self-start"
              disabled={!isDirty}
              loading={setRetention.isPending}
            >
              Guardar plazos
            </Button>
          </>
        )}
      </form>

      {usageQuery.isLoading ? (
        <Skeleton className="h-28" />
      ) : usageQuery.data ? (
        <StorageMeter usage={usageQuery.data} />
      ) : null}
    </section>
  )
}

export { MediaRetentionSection }
