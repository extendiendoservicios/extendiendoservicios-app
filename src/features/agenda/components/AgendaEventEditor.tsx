import { useEffect } from 'react'
import { Controller, useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Field, FieldError, FieldLabel } from '@/components/ui/field'
import { isApiError } from '@/api/errors'
import type { AgendaItem } from '@/api/agenda'
import { monthStartIso } from '../agendaMonth'
import { useSaveAgendaItemMutation } from '../queries'
import {
  WORK_TYPE_OPTIONS,
  agendaEventSchema,
  eventItemToValues,
  eventValuesToFields,
  type AgendaEventValues,
} from '../schemas'
import type { AgendaSuggestions } from '../useAgendaSuggestions'
import { AgendaColorPicker } from './AgendaColorPicker'
import {
  AgendaDeleteButton,
  AgendaDuplicateButton,
  AgendaResolvedCheck,
} from './AgendaItemActions'
import { SuggestInput } from './SuggestInput'

interface AgendaEventEditorProps {
  /** `null` = evento nuevo en `defaultDay`. */
  item: AgendaItem | null
  defaultDay: string
  suggestions: AgendaSuggestions
  /** Se llamó después de guardar un evento nuevo (para cerrar el formulario de alta). */
  onSaved?: (item: AgendaItem) => void
  onCancelNew?: () => void
}

/**
 * Un evento del día (AG-04 y AG-05): Trabajo, Hora, Lugar, Cliente/Persona,
 * Personas y Observación, colores, fecha (para moverlo de día), Resuelto,
 * Duplicar y Eliminar. La edición manda siempre el ítem completo, porque el
 * servidor reemplaza todos los campos.
 */
function AgendaEventEditor({
  item,
  defaultDay,
  suggestions,
  onSaved,
  onCancelNew,
}: AgendaEventEditorProps) {
  const save = useSaveAgendaItemMutation()
  const {
    control,
    register,
    handleSubmit,
    reset,
    setValue,
    formState: { errors, isDirty },
  } = useForm<AgendaEventValues>({
    resolver: zodResolver(agendaEventSchema),
    defaultValues: item
      ? eventItemToValues(item)
      : {
          workType: '',
          timeText: '',
          place: '',
          clientPerson: '',
          people: '',
          observation: '',
          day: defaultDay,
          borderColor: null,
          fillColor: null,
        },
  })

  // El check «Resuelto» cambia el relleno en el servidor: se refleja acá sin
  // pisar lo que se esté escribiendo.
  const serverFill = item?.fillColor
  useEffect(() => {
    if (item) {
      setValue('fillColor', serverFill ?? null)
    }
  }, [item, serverFill, setValue])

  async function onSubmit(values: AgendaEventValues) {
    try {
      const saved = await save.mutateAsync({
        id: item?.id ?? null,
        kind: 'evento',
        month: monthStartIso(
          Number(values.day.slice(0, 4)),
          Number(values.day.slice(5, 7)),
        ),
        day: values.day,
        fields: eventValuesToFields(values),
        borderColor: values.borderColor,
        fillColor: values.fillColor,
      })
      toast.success(item ? 'Guardamos los cambios.' : 'Agregamos el evento.')
      if (item) {
        reset(eventItemToValues(saved))
      }
      onSaved?.(saved)
    } catch (error) {
      toast.error(
        isApiError(error) ? error.message : 'No pudimos guardar el evento.',
      )
    }
  }

  const idBase = `agenda-event-${item?.id ?? 'nuevo'}`

  return (
    <form
      noValidate
      onSubmit={(event) => void handleSubmit(onSubmit)(event)}
      aria-label={item ? 'Evento' : 'Evento nuevo'}
      className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-3"
    >
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field data-invalid={Boolean(errors.workType) || undefined}>
          <FieldLabel htmlFor={`${idBase}-work`}>Trabajo</FieldLabel>
          <Controller
            control={control}
            name="workType"
            render={({ field }) => (
              <SuggestInput
                id={`${idBase}-work`}
                value={field.value}
                onChange={field.onChange}
                suggestions={[...WORK_TYPE_OPTIONS]}
                listAllWhenEmpty
                maxLength={1000}
              />
            )}
          />
          {errors.workType && (
            <FieldError>{errors.workType.message}</FieldError>
          )}
        </Field>
        <Field>
          <FieldLabel htmlFor={`${idBase}-time`}>Hora</FieldLabel>
          <Input
            id={`${idBase}-time`}
            placeholder="Por ejemplo: 8:30"
            maxLength={1000}
            {...register('timeText')}
          />
        </Field>
        <Field>
          <FieldLabel htmlFor={`${idBase}-place`}>Lugar</FieldLabel>
          <Controller
            control={control}
            name="place"
            render={({ field }) => (
              <SuggestInput
                id={`${idBase}-place`}
                value={field.value}
                onChange={field.onChange}
                suggestions={suggestions.places}
                maxLength={1000}
              />
            )}
          />
        </Field>
        <Field>
          <FieldLabel htmlFor={`${idBase}-client`}>
            Cliente / Persona
          </FieldLabel>
          <Controller
            control={control}
            name="clientPerson"
            render={({ field }) => (
              <SuggestInput
                id={`${idBase}-client`}
                value={field.value}
                onChange={field.onChange}
                suggestions={suggestions.clients}
                maxLength={1000}
              />
            )}
          />
        </Field>
        <Field className="sm:col-span-2">
          <FieldLabel htmlFor={`${idBase}-people`}>Personas</FieldLabel>
          <Controller
            control={control}
            name="people"
            render={({ field }) => (
              <SuggestInput
                id={`${idBase}-people`}
                value={field.value}
                onChange={field.onChange}
                suggestions={suggestions.employees}
                multiple
                placeholder="Separadas por coma"
                maxLength={1000}
              />
            )}
          />
        </Field>
        <Field className="sm:col-span-2">
          <FieldLabel htmlFor={`${idBase}-obs`}>Observación</FieldLabel>
          <Textarea
            id={`${idBase}-obs`}
            maxLength={1000}
            {...register('observation')}
          />
        </Field>
        <Field data-invalid={Boolean(errors.day) || undefined}>
          <FieldLabel htmlFor={`${idBase}-day`}>Fecha</FieldLabel>
          <Input id={`${idBase}-day`} type="date" {...register('day')} />
          {errors.day && <FieldError>{errors.day.message}</FieldError>}
        </Field>
        <Controller
          control={control}
          name="borderColor"
          render={({ field: borderField }) => (
            <Controller
              control={control}
              name="fillColor"
              render={({ field: fillField }) => (
                <div className="flex items-end">
                  <AgendaColorPicker
                    value={{
                      border: borderField.value,
                      fill: fillField.value,
                    }}
                    onChange={(next) => {
                      borderField.onChange(next.border)
                      fillField.onChange(next.fill)
                    }}
                  />
                </div>
              )}
            />
          )}
        />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {item && <AgendaResolvedCheck item={item} />}
        <div className="ml-auto flex flex-wrap items-center gap-2">
          {item && <AgendaDuplicateButton item={item} />}
          {item && <AgendaDeleteButton item={item} />}
          {!item && onCancelNew && (
            <Button type="button" variant="ghost" onClick={onCancelNew}>
              Cancelar
            </Button>
          )}
          <Button
            type="submit"
            loading={save.isPending}
            disabled={Boolean(item) && !isDirty}
          >
            {item ? 'Guardar' : 'Agregar'}
          </Button>
        </div>
      </div>
    </form>
  )
}

export { AgendaEventEditor }
