import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Checkbox } from '@/components/ui/checkbox'
import { Field, FieldError, FieldLabel } from '@/components/ui/field'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { isApiError } from '@/api/errors'
import type { ClientContact } from '@/api/clients'
import { useAuth } from '@/features/auth/AuthProvider'
import {
  clientContactFormSchema,
  clientContactFormValuesToInput,
  type ClientContactFormValues,
} from '@/features/clients/schemas'
import {
  useCreateClientContactMutation,
  useSetPrimaryClientContactMutation,
  useUpdateClientContactMutation,
} from '@/features/clients/queries'

/**
 * CLIENT-005: alta y edición de un contacto de ADM-21, en línea (sin ruta
 * propia — `05` línea 75 lo describe como "contactos en línea", parte de la
 * misma pantalla). `contact` nulo = alta; con valor = edición.
 *
 * Si la casilla "Contacto principal" queda tildada, primero llama a
 * `setPrimaryClientContact` (le saca la marca al contacto anterior, ver el
 * comentario de esa función en `src/api/clients.ts`) y recién después
 * guarda el resto de los datos -- así nunca hay dos "en true" a la vez, ni
 * siquiera durante el guardado.
 */
function ClientContactFormDialog({
  clientId,
  contact,
  open,
  onOpenChange,
}: {
  clientId: string
  contact: ClientContact | null
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const auth = useAuth()
  const createContact = useCreateClientContactMutation(clientId)
  const updateContact = useUpdateClientContactMutation(clientId)
  const setPrimaryContact = useSetPrimaryClientContactMutation(clientId)
  const isSaving =
    createContact.isPending ||
    updateContact.isPending ||
    setPrimaryContact.isPending

  const {
    register,
    handleSubmit,
    watch,
    setValue,
    reset,
    formState: { errors },
  } = useForm<ClientContactFormValues>({
    resolver: zodResolver(clientContactFormSchema),
    values: {
      name: contact?.name ?? '',
      roleTitle: contact?.roleTitle ?? '',
      phone: contact?.phone ?? '',
      email: contact?.email ?? '',
      isPrimary: contact?.isPrimary ?? false,
    },
  })
  const isPrimary = watch('isPrimary')

  function handleOpenChange(nextOpen: boolean) {
    if (!nextOpen) reset()
    onOpenChange(nextOpen)
  }

  async function onSubmit(values: ClientContactFormValues) {
    const input = clientContactFormValuesToInput(values)
    try {
      if (contact) {
        // Marcar principal es un paso aparte (dos updates en el servidor,
        // ver el comentario de `setPrimaryClientContact`): recién si hace
        // falta, y antes de guardar el resto de los campos.
        if (input.isPrimary && !contact.isPrimary) {
          await setPrimaryContact.mutateAsync({
            contactId: contact.id,
            updatedBy: auth.userId as string,
          })
        }
        await updateContact.mutateAsync({
          id: contact.id,
          input: {
            name: input.name,
            roleTitle: input.roleTitle,
            phone: input.phone,
            email: input.email,
          },
          updatedBy: auth.userId as string,
        })
        toast.success('Guardamos los cambios del contacto.')
      } else {
        const created = await createContact.mutateAsync({
          input: { ...input, isPrimary: false },
          createdBy: auth.userId as string,
        })
        if (input.isPrimary) {
          await setPrimaryContact.mutateAsync({
            contactId: created.id,
            updatedBy: auth.userId as string,
          })
        }
        toast.success('Agregamos el contacto.')
      }
      handleOpenChange(false)
    } catch (error) {
      toast.error(
        isApiError(error) ? error.message : 'No pudimos guardar el contacto.',
      )
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {contact ? 'Editar contacto' : 'Nuevo contacto'}
          </DialogTitle>
          <DialogDescription>
            Datos de una persona de contacto de este cliente.
          </DialogDescription>
        </DialogHeader>
        <form
          noValidate
          onSubmit={(event) => void handleSubmit(onSubmit)(event)}
          className="flex flex-col gap-[13px]"
        >
          <Field data-invalid={Boolean(errors.name) || undefined}>
            <FieldLabel htmlFor="contact-name">Nombre</FieldLabel>
            <Input
              id="contact-name"
              aria-invalid={Boolean(errors.name)}
              {...register('name')}
            />
            {errors.name && <FieldError>{errors.name.message}</FieldError>}
          </Field>

          <Field>
            <FieldLabel htmlFor="contact-role">Cargo</FieldLabel>
            <Input id="contact-role" {...register('roleTitle')} />
          </Field>

          <Field>
            <FieldLabel htmlFor="contact-phone">Teléfono</FieldLabel>
            <Input id="contact-phone" type="tel" {...register('phone')} />
          </Field>

          <Field data-invalid={Boolean(errors.email) || undefined}>
            <FieldLabel htmlFor="contact-email">Email</FieldLabel>
            <Input
              id="contact-email"
              type="email"
              aria-invalid={Boolean(errors.email)}
              {...register('email')}
            />
            {errors.email && <FieldError>{errors.email.message}</FieldError>}
          </Field>

          <label
            htmlFor="contact-is-primary"
            className="flex items-center gap-2 text-[12.5px] text-text-2"
          >
            <Checkbox
              id="contact-is-primary"
              checked={isPrimary}
              onCheckedChange={(checked) =>
                setValue('isPrimary', checked === true, { shouldDirty: true })
              }
            />
            Contacto principal
          </label>

          <DialogFooter className="mt-2">
            <Button
              type="button"
              variant="ghost"
              onClick={() => handleOpenChange(false)}
              disabled={isSaving}
            >
              Cancelar
            </Button>
            <Button type="submit" loading={isSaving}>
              Guardar
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

export { ClientContactFormDialog }
