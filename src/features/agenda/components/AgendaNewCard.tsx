import { Controller, useForm } from 'react-hook-form'
import { useEffect, useState } from 'react'
import { zodResolver } from '@hookform/resolvers/zod'
import { Link, useLocation, useNavigate } from 'react-router'
import { Pencil, UserPlus } from 'lucide-react'
import { toast } from 'sonner'
import { cn } from 'cn'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Field, FieldError, FieldLabel } from '@/components/ui/field'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { isApiError } from '@/api/errors'
import type { AgendaItem } from '@/api/agenda'
import { agendaBlockStyle } from '../agendaColors'
import { newItemTitle } from '../agendaMonth'
import { buildClientPrefillState } from '../clientPrefill'
import { useSaveAgendaItemMutation } from '../queries'
import {
  agendaNewSchema,
  formatBudget,
  newItemToValues,
  newValuesToFields,
  type AgendaNewValues,
} from '../schemas'
import type { AgendaSuggestions } from '../useAgendaSuggestions'
import { AgendaColorPicker } from './AgendaColorPicker'
import {
  AgendaDeleteButton,
  AgendaDuplicateButton,
  AgendaResolvedCheck,
} from './AgendaItemActions'
import { SuggestInput } from './SuggestInput'

interface AgendaNewCardProps {
  /** `null` = bloque nuevo en `slot`. */
  item: AgendaItem | null
  slot: number
  /** Primer día del mes (`YYYY-MM-01`). */
  month: string
  suggestions: AgendaSuggestions
  /** Para el alta: cerrar el borrador (al guardar o cancelar). */
  onClose?: () => void
  /** Abre el formulario de entrada (borrador nuevo). */
  startEditing?: boolean
}

/**
 * Un bloque de «Nuevos» (AG-08 y AG-09): lo que todavía no es cliente ni
 * turno. Muestra un resumen con su borde y relleno y, al editar, los seis
 * campos (Nombre del lugar, Cliente, Dirección, Días y horario, Presupuesto y
 * Observación), la columna, los colores, Resuelto, Duplicar, Eliminar y
 * «Crear cliente».
 */
function AgendaNewCard({
  item,
  slot,
  month,
  suggestions,
  onClose,
  startEditing = false,
}: AgendaNewCardProps) {
  const [editing, setEditing] = useState(startEditing || item === null)
  const save = useSaveAgendaItemMutation()
  const navigate = useNavigate()
  const location = useLocation()

  const {
    control,
    register,
    handleSubmit,
    reset,
    setValue,
    getValues,
    formState: { errors },
  } = useForm<AgendaNewValues>({
    resolver: zodResolver(agendaNewSchema),
    defaultValues: item
      ? newItemToValues(item)
      : {
          placeName: '',
          clientName: '',
          address: '',
          daysHours: '',
          budget: '',
          observation: '',
          slot,
          borderColor: null,
          fillColor: null,
        },
  })

  // «Resuelto» cambia el relleno en el servidor: se refleja sin pisar el texto.
  const serverFill = item?.fillColor
  useEffect(() => {
    if (item) {
      setValue('fillColor', serverFill ?? null)
    }
  }, [item, serverFill, setValue])

  async function onSubmit(values: AgendaNewValues) {
    try {
      const saved = await save.mutateAsync({
        id: item?.id ?? null,
        kind: 'nuevo',
        month,
        slot: values.slot,
        fields: newValuesToFields(values),
        borderColor: values.borderColor,
        fillColor: values.fillColor,
      })
      toast.success(item ? 'Guardamos los cambios.' : 'Agregamos el bloque.')
      reset(newItemToValues(saved))
      setEditing(false)
      onClose?.()
    } catch (error) {
      toast.error(
        isApiError(error) ? error.message : 'No pudimos guardar el bloque.',
      )
    }
  }

  function createClient() {
    if (!item) {
      return
    }
    const values = getValues()
    void navigate('/admin/clientes/nuevo', {
      state: buildClientPrefillState({
        agendaItemId: item.id,
        legalName: values.clientName.trim() || values.placeName.trim(),
        adminAddress: values.address.trim(),
        notes: values.observation.trim(),
        returnTo: `${location.pathname}${location.search}`,
      }),
    })
  }

  const idBase = `agenda-new-${item?.id ?? `draft-${slot}`}`

  const summary = item ? (
    <div
      className="flex flex-col gap-1 rounded-lg border border-border bg-surface p-2.5 text-[12px] leading-snug"
      style={agendaBlockStyle(item.borderColor, item.fillColor)}
      data-testid="agenda-new-card"
    >
      <p className="text-[13px] font-semibold">{newItemTitle(item)}</p>
      {item.clientName && item.clientName !== newItemTitle(item) && (
        <p>{item.clientName}</p>
      )}
      {item.address && <p>{item.address}</p>}
      {item.daysHours && <p>{item.daysHours}</p>}
      {item.budget != null && <p>$ {formatBudget(item.budget)}</p>}
      {item.observation && <p>{item.observation}</p>}
      <div className="mt-1 flex flex-wrap items-center gap-1.5">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          icon={Pencil}
          onClick={() => setEditing(true)}
        >
          Editar
        </Button>
        {item.clientId && (
          <Link
            to={`/admin/clientes/${item.clientId}`}
            className={cn(
              'text-[12px] font-semibold underline underline-offset-2',
            )}
          >
            Ver cliente
          </Link>
        )}
      </div>
    </div>
  ) : null

  function closeForm() {
    reset(item ? newItemToValues(item) : undefined)
    setEditing(false)
    onClose?.()
  }

  const form = (
    <form
      noValidate
      onSubmit={(event) => void handleSubmit(onSubmit)(event)}
      aria-label={item ? 'Bloque de Nuevos' : 'Bloque nuevo de Nuevos'}
      className="flex flex-col gap-2.5"
    >
      <Field data-invalid={Boolean(errors.placeName) || undefined}>
        <FieldLabel htmlFor={`${idBase}-place`}>Nombre del lugar</FieldLabel>
        <Controller
          control={control}
          name="placeName"
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
        {errors.placeName && (
          <FieldError>{errors.placeName.message}</FieldError>
        )}
      </Field>
      <Field>
        <FieldLabel htmlFor={`${idBase}-client`}>Cliente</FieldLabel>
        <Controller
          control={control}
          name="clientName"
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
      <Field>
        <FieldLabel htmlFor={`${idBase}-address`}>Dirección</FieldLabel>
        <Input
          id={`${idBase}-address`}
          maxLength={1000}
          {...register('address')}
        />
      </Field>
      <Field>
        <FieldLabel htmlFor={`${idBase}-hours`}>Días y horario</FieldLabel>
        <Input
          id={`${idBase}-hours`}
          maxLength={1000}
          {...register('daysHours')}
        />
      </Field>
      <Field data-invalid={Boolean(errors.budget) || undefined}>
        <FieldLabel htmlFor={`${idBase}-budget`}>Presupuesto ($)</FieldLabel>
        <Input
          id={`${idBase}-budget`}
          inputMode="decimal"
          placeholder="Por ejemplo: 150.000"
          {...register('budget')}
        />
        {errors.budget && <FieldError>{errors.budget.message}</FieldError>}
      </Field>
      <Field>
        <FieldLabel htmlFor={`${idBase}-obs`}>Observación</FieldLabel>
        <Textarea
          id={`${idBase}-obs`}
          maxLength={1000}
          {...register('observation')}
        />
      </Field>
      <Field>
        <FieldLabel htmlFor={`${idBase}-slot`}>Columna</FieldLabel>
        <Controller
          control={control}
          name="slot"
          render={({ field }) => (
            <Select
              value={String(field.value)}
              onValueChange={(value) => field.onChange(Number(value))}
            >
              <SelectTrigger id={`${idBase}-slot`} aria-label="Columna">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Array.from({ length: 7 }, (_, index) => (
                  <SelectItem key={index} value={String(index)}>
                    Columna {index + 1}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        />
      </Field>
      <Controller
        control={control}
        name="borderColor"
        render={({ field: borderField }) => (
          <Controller
            control={control}
            name="fillColor"
            render={({ field: fillField }) => (
              <AgendaColorPicker
                value={{ border: borderField.value, fill: fillField.value }}
                onChange={(next) => {
                  borderField.onChange(next.border)
                  fillField.onChange(next.fill)
                }}
              />
            )}
          />
        )}
      />
      <div className="flex flex-wrap items-center gap-2">
        {item && <AgendaResolvedCheck item={item} />}
        {item && !item.clientId && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            icon={UserPlus}
            onClick={createClient}
          >
            Crear cliente
          </Button>
        )}
        {item?.clientId && (
          <Link
            to={`/admin/clientes/${item.clientId}`}
            className="text-[12px] font-semibold underline underline-offset-2"
          >
            Ver cliente
          </Link>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {item && <AgendaDuplicateButton item={item} />}
        {item && <AgendaDeleteButton item={item} />}
      </div>
      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" onClick={closeForm}>
          Cancelar
        </Button>
        <Button type="submit" loading={save.isPending}>
          Guardar
        </Button>
      </div>
    </form>
  )

  return (
    <>
      {summary}
      <Dialog
        open={editing}
        onOpenChange={(open) => {
          if (!open) {
            closeForm()
          }
        }}
      >
        <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{item ? 'Editar bloque' : 'Bloque nuevo'}</DialogTitle>
            <DialogDescription>
              Lo que todavía no es cliente ni turno.
            </DialogDescription>
          </DialogHeader>
          {form}
        </DialogContent>
      </Dialog>
    </>
  )
}

export { AgendaNewCard }
