import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { toast } from 'sonner'
import {
  KeyRound,
  LogOut,
  Mail,
  MoreHorizontal,
  ShieldCheck,
  UserCheck,
  UserX,
} from 'lucide-react'
import { IconButton } from '@/components/IconButton'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Field, FieldError, FieldLabel } from '@/components/ui/field'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { isApiError } from '@/api/errors'
import type { AdminUserRow } from '@/api/users'
import {
  useDeactivateUserMutation,
  useReactivateUserMutation,
  useResetPasswordMutation,
  useSignOutUserMutation,
  useUpdateEmailMutation,
} from '@/features/users/queries'
import {
  getVisibleUserActions,
  type UsersScreenActor,
} from '@/features/users/permissions'
import {
  resetPasswordSchema,
  updateEmailSchema,
  type ResetPasswordFormValues,
  type UpdateEmailFormValues,
} from '@/features/users/schemas'

/**
 * USERS-011: menú de acciones por usuario de ADM-27, más el atajo a
 * "Editar roles y capacidades" (USERS-010) cuando corresponde. Un solo
 * componente por fila para no repetir cinco veces la lógica de qué mostrar
 * (`permissions.ts`) ni los cinco diálogos.
 *
 * Si la fila no tiene NINGUNA acción disponible para `actor` (por ejemplo,
 * un administrador con `manage_users` mirando a otro administrador), no
 * renderiza ni siquiera el botón de menú -- una fila sin ninguna acción
 * posible no necesita un "…" que abra un menú vacío.
 */
function UserActionsMenu({
  user,
  actor,
  onEditRolesAndCapabilities,
}: {
  user: AdminUserRow
  actor: UsersScreenActor
  onEditRolesAndCapabilities: () => void
}) {
  type DialogKind =
    | 'reset-password'
    | 'update-email'
    | 'sign-out'
    | 'deactivate'
    | 'reactivate'
    | null
  const [openDialog, setOpenDialog] = useState<DialogKind>(null)

  // `getVisibleUserActions` (permissions.ts) es la única fuente de verdad de
  // qué botón va acá: se testea sola, sin tener que abrir este menú de
  // Radix en jsdom (frágil para simular con `fireEvent`, ver el reporte del
  // encargo).
  const visibleActions = getVisibleUserActions(actor, {
    roles: user.roles,
    deletedAt: user.deletedAt,
  })
  const canEditRoles = visibleActions.includes('edit-roles')
  const showActiveActions = visibleActions.includes('reset-password')
  const showReactivate = visibleActions.includes('reactivate')

  if (visibleActions.length === 0) {
    return null
  }

  const fullName = `${user.firstName} ${user.lastName}`

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <IconButton
            icon={MoreHorizontal}
            aria-label={`Acciones para ${fullName}`}
          />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {canEditRoles && (
            <DropdownMenuItem onSelect={onEditRolesAndCapabilities}>
              <ShieldCheck /> Editar roles y capacidades
            </DropdownMenuItem>
          )}
          {showActiveActions && (
            <>
              {canEditRoles && <DropdownMenuSeparator />}
              <DropdownMenuItem
                onSelect={() => setOpenDialog('reset-password')}
              >
                <KeyRound /> Resetear contraseña
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => setOpenDialog('update-email')}>
                <Mail /> Cambiar email
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => setOpenDialog('sign-out')}>
                <LogOut /> Cerrar sesiones
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                variant="destructive"
                onSelect={() => setOpenDialog('deactivate')}
              >
                <UserX /> Desactivar
              </DropdownMenuItem>
            </>
          )}
          {showReactivate && (
            <DropdownMenuItem onSelect={() => setOpenDialog('reactivate')}>
              <UserCheck /> Reactivar
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      <ResetPasswordDialog
        user={user}
        open={openDialog === 'reset-password'}
        onOpenChange={(open) => setOpenDialog(open ? 'reset-password' : null)}
      />
      <UpdateEmailDialog
        user={user}
        open={openDialog === 'update-email'}
        onOpenChange={(open) => setOpenDialog(open ? 'update-email' : null)}
      />
      <SignOutDialog
        user={user}
        open={openDialog === 'sign-out'}
        onOpenChange={(open) => setOpenDialog(open ? 'sign-out' : null)}
      />
      <DeactivateDialog
        user={user}
        open={openDialog === 'deactivate'}
        onOpenChange={(open) => setOpenDialog(open ? 'deactivate' : null)}
      />
      <ReactivateDialog
        user={user}
        open={openDialog === 'reactivate'}
        onOpenChange={(open) => setOpenDialog(open ? 'reactivate' : null)}
      />
    </>
  )
}

function fullNameOf(user: AdminUserRow): string {
  return `${user.firstName} ${user.lastName}`
}

function apiErrorMessage(error: unknown, fallback: string): string {
  return isApiError(error) ? error.message : fallback
}

/** USERS-011: resetear contraseña -- revoca las sesiones de la persona (06 sección 2.1). */
function ResetPasswordDialog({
  user,
  open,
  onOpenChange,
}: {
  user: AdminUserRow
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const resetPassword = useResetPasswordMutation()
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<ResetPasswordFormValues>({
    resolver: zodResolver(resetPasswordSchema),
  })

  function handleOpenChange(nextOpen: boolean) {
    if (!nextOpen) reset()
    onOpenChange(nextOpen)
  }

  async function onSubmit(values: ResetPasswordFormValues) {
    try {
      await resetPassword.mutateAsync({
        profileId: user.profileId,
        newPassword: values.newPassword,
      })
      toast.success(
        `Restablecimos la contraseña de ${fullNameOf(user)} y cerramos sus sesiones.`,
      )
      handleOpenChange(false)
    } catch (error) {
      toast.error(apiErrorMessage(error, 'No pudimos resetear la contraseña.'))
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Resetear contraseña</DialogTitle>
          <DialogDescription>
            Le vamos a asignar esta contraseña a {fullNameOf(user)} y a cerrar
            todas sus sesiones activas.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={(event) => void handleSubmit(onSubmit)(event)}>
          <Field data-invalid={Boolean(errors.newPassword) || undefined}>
            <FieldLabel htmlFor="reset-password-new">
              Contraseña nueva
            </FieldLabel>
            <Input
              id="reset-password-new"
              type="password"
              autoComplete="new-password"
              aria-invalid={Boolean(errors.newPassword)}
              {...register('newPassword')}
            />
            {errors.newPassword && (
              <FieldError>{errors.newPassword.message}</FieldError>
            )}
          </Field>
          <DialogFooter className="mt-4">
            <Button
              type="button"
              variant="ghost"
              onClick={() => handleOpenChange(false)}
            >
              Cancelar
            </Button>
            <Button type="submit" loading={resetPassword.isPending}>
              Resetear contraseña
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

/** USERS-011: cambiar el email de login (P-037: solo dueño/administrador). */
function UpdateEmailDialog({
  user,
  open,
  onOpenChange,
}: {
  user: AdminUserRow
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const updateEmail = useUpdateEmailMutation()
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<UpdateEmailFormValues>({
    resolver: zodResolver(updateEmailSchema),
  })

  function handleOpenChange(nextOpen: boolean) {
    if (!nextOpen) reset()
    onOpenChange(nextOpen)
  }

  async function onSubmit(values: UpdateEmailFormValues) {
    try {
      await updateEmail.mutateAsync({
        profileId: user.profileId,
        email: values.email,
      })
      toast.success(`Cambiamos el email de login de ${fullNameOf(user)}.`)
      handleOpenChange(false)
    } catch (error) {
      toast.error(apiErrorMessage(error, 'No pudimos cambiar el email.'))
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Cambiar email de login</DialogTitle>
          <DialogDescription>
            Nuevo email de login de {fullNameOf(user)}.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={(event) => void handleSubmit(onSubmit)(event)}>
          <Field data-invalid={Boolean(errors.email) || undefined}>
            <FieldLabel htmlFor="update-email-new">Email nuevo</FieldLabel>
            <Input
              id="update-email-new"
              type="email"
              aria-invalid={Boolean(errors.email)}
              {...register('email')}
            />
            {errors.email && <FieldError>{errors.email.message}</FieldError>}
          </Field>
          <DialogFooter className="mt-4">
            <Button
              type="button"
              variant="ghost"
              onClick={() => handleOpenChange(false)}
            >
              Cancelar
            </Button>
            <Button type="submit" loading={updateEmail.isPending}>
              Cambiar email
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

/**
 * USERS-011: cerrar sesiones. Sin motivo obligatorio (no está en la lista de
 * `07` sección 2.4 de acciones que lo piden) -- confirmación simple.
 */
function SignOutDialog({
  user,
  open,
  onOpenChange,
}: {
  user: AdminUserRow
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const signOutUser = useSignOutUserMutation()

  async function handleConfirm() {
    try {
      await signOutUser.mutateAsync(user.profileId)
      toast.success(`Cerramos todas las sesiones de ${fullNameOf(user)}.`)
      onOpenChange(false)
    } catch (error) {
      toast.error(apiErrorMessage(error, 'No pudimos cerrar sus sesiones.'))
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Cerrar sesiones</DialogTitle>
          <DialogDescription>
            ¿Cerrar todas las sesiones activas de {fullNameOf(user)}? Va a tener
            que volver a iniciar sesión en todos sus dispositivos.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button
            type="button"
            variant="ghost"
            onClick={() => onOpenChange(false)}
          >
            Cancelar
          </Button>
          <Button
            type="button"
            loading={signOutUser.isPending}
            onClick={() => void handleConfirm()}
          >
            Cerrar sesiones
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/** USERS-011: desactivar, con motivo obligatorio (`ConfirmDialog`, DS-010). */
function DeactivateDialog({
  user,
  open,
  onOpenChange,
}: {
  user: AdminUserRow
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const deactivateUser = useDeactivateUserMutation()

  async function handleConfirm(reason: string) {
    try {
      await deactivateUser.mutateAsync({ profileId: user.profileId, reason })
      // USERS-008: por defecto la lista solo muestra activos -- la persona
      // desactivada desaparece de la vista al confirmar, así que el aviso
      // aclara dónde encontrarla en vez de dejar que parezca que se borró.
      toast.success(
        `Desactivamos la cuenta de ${fullNameOf(user)}. Para volver a verla en la lista, activá "Mostrar desactivados".`,
      )
      onOpenChange(false)
    } catch (error) {
      toast.error(apiErrorMessage(error, 'No pudimos desactivar la cuenta.'))
    }
  }

  return (
    <ConfirmDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Desactivar usuario"
      description={`${fullNameOf(user)} no va a poder iniciar sesión hasta que se reactive la cuenta. El historial se conserva.`}
      reasonPlaceholder="Por ejemplo: renunció, cambio de tareas…"
      confirmLabel="Desactivar"
      variant="destructive"
      isLoading={deactivateUser.isPending}
      onConfirm={(reason) => void handleConfirm(reason)}
    />
  )
}

/** USERS-011: reactivar (solo el dueño, 06 sección 2.1). */
function ReactivateDialog({
  user,
  open,
  onOpenChange,
}: {
  user: AdminUserRow
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const reactivateUser = useReactivateUserMutation()

  async function handleConfirm() {
    try {
      await reactivateUser.mutateAsync(user.profileId)
      toast.success(`Reactivamos la cuenta de ${fullNameOf(user)}.`)
      onOpenChange(false)
    } catch (error) {
      toast.error(apiErrorMessage(error, 'No pudimos reactivar la cuenta.'))
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Reactivar usuario</DialogTitle>
          <DialogDescription>
            ¿Reactivar la cuenta de {fullNameOf(user)}? Va a poder iniciar
            sesión de nuevo.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button
            type="button"
            variant="ghost"
            onClick={() => onOpenChange(false)}
          >
            Cancelar
          </Button>
          <Button
            type="button"
            loading={reactivateUser.isPending}
            onClick={() => void handleConfirm()}
          >
            Reactivar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export { UserActionsMenu }
