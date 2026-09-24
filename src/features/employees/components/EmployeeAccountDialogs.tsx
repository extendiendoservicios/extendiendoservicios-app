import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { PasswordInput } from '@/components/ui/password-input'
import { Field, FieldError, FieldLabel } from '@/components/ui/field'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { isApiError } from '@/api/errors'
import type { EmployeeDetail } from '@/api/employees'
import {
  resetPasswordSchema,
  type ResetPasswordFormValues,
} from '@/features/users/schemas'
import {
  useResetEmployeePasswordMutation,
  useSignOutEmployeeMutation,
  useTerminateEmployeeMutation,
} from '@/features/employees/queries'

/**
 * EMP-005: los tres diálogos de acción de cuenta de ADM-17 (resetear
 * contraseña, cerrar sesiones, dar de baja). Mismo patrón que
 * `UserActionsMenu.tsx` (ADM-27) -- reutiliza el esquema de "resetear
 * contraseña" de `features/users/schemas.ts` (misma regla del servidor: al
 * menos 8 caracteres) en vez de declarar uno igual acá.
 */
function fullNameOf(employee: EmployeeDetail): string {
  return `${employee.firstName} ${employee.lastName}`
}

function apiErrorMessage(error: unknown, fallback: string): string {
  return isApiError(error) ? error.message : fallback
}

/** Resetear contraseña -- revoca las sesiones de la persona (`06` sección 2.1). */
function ResetEmployeePasswordDialog({
  employee,
  open,
  onOpenChange,
}: {
  employee: EmployeeDetail
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const resetPassword = useResetEmployeePasswordMutation()
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
        profileId: employee.profileId,
        newPassword: values.newPassword,
      })
      toast.success(
        `Restablecimos la contraseña de ${fullNameOf(employee)} y cerramos sus sesiones.`,
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
            Le vamos a asignar esta contraseña a {fullNameOf(employee)} y a
            cerrar todas sus sesiones activas.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={(event) => void handleSubmit(onSubmit)(event)}>
          <Field data-invalid={Boolean(errors.newPassword) || undefined}>
            <FieldLabel htmlFor="employee-reset-password-new">
              Contraseña nueva
            </FieldLabel>
            <PasswordInput
              id="employee-reset-password-new"
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

/** Cerrar sesiones -- sin motivo obligatorio (no está en la lista de `07` sección 2.4). */
function SignOutEmployeeDialog({
  employee,
  open,
  onOpenChange,
}: {
  employee: EmployeeDetail
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const signOutEmployee = useSignOutEmployeeMutation()

  async function handleConfirm() {
    try {
      await signOutEmployee.mutateAsync(employee.profileId)
      toast.success(`Cerramos todas las sesiones de ${fullNameOf(employee)}.`)
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
            ¿Cerrar todas las sesiones activas de {fullNameOf(employee)}? Va a
            tener que volver a iniciar sesión en todos sus dispositivos.
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
            loading={signOutEmployee.isPending}
            onClick={() => void handleConfirm()}
          >
            Cerrar sesiones
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/**
 * Dar de baja -- baja en dos pasos con motivo obligatorio (EMP-005, `05`
 * línea 66: "dos pasos: employees.status + Edge deactivate_user";
 * `ConfirmDialog`, DS-010, mismo patrón que `DeactivateDialog` de
 * `UserActionsMenu.tsx`).
 */
function TerminateEmployeeDialog({
  employee,
  updatedBy,
  open,
  onOpenChange,
}: {
  employee: EmployeeDetail
  updatedBy: string
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const terminateEmployee = useTerminateEmployeeMutation()

  async function handleConfirm(reason: string) {
    try {
      await terminateEmployee.mutateAsync({
        profileId: employee.profileId,
        reason,
        updatedBy,
      })
      toast.success(`Dimos de baja a ${fullNameOf(employee)}.`)
      onOpenChange(false)
    } catch (error) {
      toast.error(
        apiErrorMessage(error, 'No pudimos dar de baja a la persona.'),
      )
    }
  }

  return (
    <ConfirmDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Dar de baja"
      description={`${fullNameOf(employee)} no va a poder iniciar sesión y queda marcada como baja. El historial se conserva.`}
      reasonPlaceholder="Por ejemplo: renunció, fin de contrato…"
      confirmLabel="Dar de baja"
      variant="destructive"
      isLoading={terminateEmployee.isPending}
      onConfirm={(reason) => void handleConfirm(reason)}
    />
  )
}

export {
  ResetEmployeePasswordDialog,
  SignOutEmployeeDialog,
  TerminateEmployeeDialog,
}
