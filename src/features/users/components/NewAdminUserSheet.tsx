import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { PasswordInput } from '@/components/ui/password-input'
import { Field, FieldError, FieldLabel } from '@/components/ui/field'
import {
  Sheet,
  SheetContent,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { isApiError } from '@/api/errors'
import { useCreateAdminUserMutation } from '@/features/users/queries'
import {
  createAdminUserSchema,
  type CreateAdminUserFormValues,
} from '@/features/users/schemas'

/**
 * USERS-009: alta de un usuario administrativo (dueño). Siempre crea el rol
 * `admin` -- no hay selector de rol acá: `create_user` rechaza con
 * `FORBIDDEN` si quien llama no es el dueño y pide un rol privilegiado
 * (`admin`/`owner`), y `canCreateAdminUser` (`permissions.ts`) ya deja este
 * botón visible solo al dueño, así que "administrativo" es siempre `admin`.
 * Cuando el rol es `admin`, la propia Edge Function activa las siete
 * capacidades (confirmado por Mike el 23 sep 2026): esta pantalla no vuelve
 * a tocarlas, la persona ya queda con todo activo y el dueño puede
 * recortarlas después desde "Editar roles y capacidades".
 */
function NewAdminUserSheet({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const createAdminUser = useCreateAdminUserMutation()
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<CreateAdminUserFormValues>({
    resolver: zodResolver(createAdminUserSchema),
  })

  function handleOpenChange(nextOpen: boolean) {
    if (!nextOpen) {
      reset()
      createAdminUser.reset()
    }
    onOpenChange(nextOpen)
  }

  async function onSubmit(values: CreateAdminUserFormValues) {
    try {
      await createAdminUser.mutateAsync({
        firstName: values.firstName,
        lastName: values.lastName,
        email: values.email,
        password: values.password,
        roles: ['admin'],
      })
      toast.success(
        `Creamos la cuenta de ${values.firstName} ${values.lastName}.`,
      )
      handleOpenChange(false)
    } catch (error) {
      toast.error(
        isApiError(error) ? error.message : 'No pudimos crear el usuario.',
      )
    }
  }

  return (
    <Sheet open={open} onOpenChange={handleOpenChange}>
      <SheetContent>
        <SheetHeader>
          <SheetTitle>Nuevo administrador</SheetTitle>
        </SheetHeader>
        <form
          onSubmit={(event) => void handleSubmit(onSubmit)(event)}
          className="flex flex-1 flex-col gap-4 overflow-y-auto px-6"
        >
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field data-invalid={Boolean(errors.firstName) || undefined}>
              <FieldLabel htmlFor="new-admin-first-name">Nombre</FieldLabel>
              <Input
                id="new-admin-first-name"
                aria-invalid={Boolean(errors.firstName)}
                {...register('firstName')}
              />
              {errors.firstName && (
                <FieldError>{errors.firstName.message}</FieldError>
              )}
            </Field>
            <Field data-invalid={Boolean(errors.lastName) || undefined}>
              <FieldLabel htmlFor="new-admin-last-name">Apellido</FieldLabel>
              <Input
                id="new-admin-last-name"
                aria-invalid={Boolean(errors.lastName)}
                {...register('lastName')}
              />
              {errors.lastName && (
                <FieldError>{errors.lastName.message}</FieldError>
              )}
            </Field>
          </div>
          <Field data-invalid={Boolean(errors.email) || undefined}>
            <FieldLabel htmlFor="new-admin-email">Email de login</FieldLabel>
            <Input
              id="new-admin-email"
              type="email"
              aria-invalid={Boolean(errors.email)}
              {...register('email')}
            />
            {errors.email && <FieldError>{errors.email.message}</FieldError>}
          </Field>
          <Field data-invalid={Boolean(errors.password) || undefined}>
            <FieldLabel htmlFor="new-admin-password">
              Contraseña inicial
            </FieldLabel>
            <PasswordInput
              id="new-admin-password"
              autoComplete="new-password"
              aria-invalid={Boolean(errors.password)}
              {...register('password')}
            />
            {errors.password ? (
              <FieldError>{errors.password.message}</FieldError>
            ) : (
              <p className="text-[11px] text-text-3">
                La persona puede cambiarla después desde su perfil. No hace
                falta que la cambie al ingresar por primera vez.
              </p>
            )}
          </Field>
        </form>
        <SheetFooter className="flex-row justify-end">
          <Button
            type="button"
            variant="ghost"
            onClick={() => handleOpenChange(false)}
          >
            Cancelar
          </Button>
          <Button
            type="submit"
            loading={createAdminUser.isPending}
            onClick={(event) => void handleSubmit(onSubmit)(event)}
          >
            Crear administrador
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  )
}

export { NewAdminUserSheet }
