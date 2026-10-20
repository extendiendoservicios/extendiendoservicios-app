import { Controller, useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Field, FieldError, FieldLabel } from '@/components/ui/field'
import { RadioGroup } from '@/components/ui/radio-group'
import { OptionCard } from '@/components/OptionCard'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { isApiError } from '@/api/errors'
import { absenceErrorMessage } from '@/features/attendance/absenceErrors'
import { ABSENCE_REASON_LABELS } from '@/features/attendance/reasonLabels'
import { useAdminNotifyAbsenceMutation } from '@/features/attendance/queries'
import {
  absenceFormValuesToInput,
  notifyAbsenceSchema,
  type NotifyAbsenceFormValues,
} from '@/features/attendance/schemas'

const ABSENCE_REASON_OPTIONS = Object.entries(ABSENCE_REASON_LABELS) as [
  keyof typeof ABSENCE_REASON_LABELS,
  string,
][]

/**
 * Selector «Con certificado / Sin certificado» (obligatorio elegir), usado
 * al avisar la ausencia y al corregir el certificado.
 */
function CertificateChoice({
  value,
  onChange,
  error,
}: {
  value: string | undefined
  onChange: (value: string) => void
  error?: string
}) {
  return (
    <Field data-invalid={Boolean(error) || undefined}>
      <FieldLabel>Certificado</FieldLabel>
      <RadioGroup
        value={value ?? ''}
        onValueChange={onChange}
        aria-label="Certificado"
        className="gap-2"
      >
        <OptionCard value="yes" title="Con certificado" />
        <OptionCard value="no" title="Sin certificado" />
      </RadioGroup>
      {error && <FieldError>{error}</FieldError>}
    </Field>
  )
}

/**
 * Aviso de ausencia cargado por administración (`notify_absence`, P-073,
 * ABS-008, P19.11d): certificado obligatorio, motivo opcional (con texto
 * obligatorio si es «Otro»). Lo comparten el diálogo «Ausente» del detalle
 * del turno y la acción «Ausencia» de «Registrar en nombre».
 */
function AbsenceNoticeForm({
  assignmentId,
  submitLabel = 'Avisar ausencia',
  onDone,
  footer,
}: {
  assignmentId: string
  submitLabel?: string
  onDone: () => void
  /** Contenedor del botón de envío (el diálogo y la hoja lo disponen distinto). */
  footer?: (submit: React.ReactNode) => React.ReactNode
}) {
  const notifyAbsence = useAdminNotifyAbsenceMutation()

  const {
    register,
    control,
    handleSubmit,
    watch,
    setError,
    formState: { errors },
  } = useForm<NotifyAbsenceFormValues>({
    resolver: zodResolver(notifyAbsenceSchema),
    defaultValues: { reasonCode: 'none', reasonText: '' },
  })
  const reasonCode = watch('reasonCode')

  async function onSubmit(values: NotifyAbsenceFormValues) {
    const input = absenceFormValuesToInput({
      hasCertificate: values.hasCertificate,
      reasonCode: values.reasonCode,
      reasonText: values.reasonText,
    })
    try {
      await notifyAbsence.mutateAsync({
        assignmentId,
        hasCertificate: input.hasCertificate,
        reasonCode: input.reasonCode,
        reasonText: input.reasonText,
      })
      toast.success('Avisamos la ausencia.')
      onDone()
    } catch (error) {
      const message = absenceErrorMessage(
        error,
        'No pudimos avisar la ausencia.',
      )
      if (isApiError(error) && error.hint === 'CERTIFICATE_REQUIRED') {
        setError('hasCertificate', { message })
      }
      toast.error(message)
    }
  }

  const submit = (
    <Button type="submit" loading={notifyAbsence.isPending}>
      {submitLabel}
    </Button>
  )

  return (
    <form
      noValidate
      onSubmit={(event) => void handleSubmit(onSubmit)(event)}
      className="flex flex-col gap-4"
    >
      <Controller
        control={control}
        name="hasCertificate"
        render={({ field }) => (
          <CertificateChoice
            value={field.value}
            onChange={field.onChange}
            error={errors.hasCertificate?.message}
          />
        )}
      />
      <Field data-invalid={Boolean(errors.reasonCode) || undefined}>
        <FieldLabel htmlFor="absence-reason-code">Motivo (opcional)</FieldLabel>
        <Controller
          control={control}
          name="reasonCode"
          render={({ field }) => (
            <Select value={field.value} onValueChange={field.onChange}>
              <SelectTrigger
                id="absence-reason-code"
                aria-label="Elegir motivo"
              >
                <SelectValue placeholder="Sin motivo" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">Sin motivo</SelectItem>
                {ABSENCE_REASON_OPTIONS.map(([value, label]) => (
                  <SelectItem key={value} value={value}>
                    {label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        />
      </Field>
      <Field data-invalid={Boolean(errors.reasonText) || undefined}>
        <FieldLabel htmlFor="absence-reason-text">
          Detalle{reasonCode === 'other' ? '' : ' (opcional)'}
        </FieldLabel>
        <Textarea
          id="absence-reason-text"
          rows={3}
          placeholder="Por ejemplo: turno médico de urgencia"
          aria-invalid={Boolean(errors.reasonText)}
          {...register('reasonText')}
        />
        {errors.reasonText && (
          <FieldError>{errors.reasonText.message}</FieldError>
        )}
      </Field>
      {footer ? footer(submit) : submit}
    </form>
  )
}

export { AbsenceNoticeForm, CertificateChoice }
