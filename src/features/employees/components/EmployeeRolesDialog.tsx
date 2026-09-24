import { Controller, useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { isApiError } from '@/api/errors'
import type { EmployeeDetail } from '@/api/employees'
import {
  employeeRolesEditSchema,
  nextEmployeeRoles,
  type EmployeeRolesEditFormValues,
} from '@/features/employees/schemas'
import { useSetEmployeeRolesMutation } from '@/features/employees/queries'

/**
 * Decisión de Mike del 24 sep 2026: los roles empleado y supervisor se
 * editan desde la ficha (pestaña Datos de ADM-17), con `set_user_roles`
 * (`0013_rpc_users.sql`) -- ya no hace falta ir a ADM-27 para esto. Dueño y
 * administrador no aparecen en este diálogo: si la persona ya tenía alguno
 * de esos dos roles (caso raro: alguien con `employees` que también es
 * admin), se preservan tal cual al armar el conjunto que se le manda a la
 * RPC -- esta pantalla ni los muestra ni los toca, siguen gestionándose en
 * ADM-27.
 *
 * Si el conjunto resultante le quita un rol a la persona (por ejemplo, le
 * sacan "supervisor"), la RPC no cierra sus sesiones por sí sola (P-015):
 * `useSetEmployeeRolesMutation` es quien decide llamar a `signOutUser`
 * después, y por eso pide `previousRoles` además de `roles`.
 */
function EmployeeRolesDialog({
  employee,
  open,
  onOpenChange,
}: {
  employee: EmployeeDetail
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const setRoles = useSetEmployeeRolesMutation(employee.profileId)
  const preservedRoles = employee.roles.filter(
    (role) => role === 'owner' || role === 'admin',
  )

  const {
    control,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<EmployeeRolesEditFormValues>({
    resolver: zodResolver(employeeRolesEditSchema),
    values: {
      isEmployeeRole: employee.roles.includes('employee'),
      isSupervisorRole: employee.roles.includes('supervisor'),
    },
  })

  function handleOpenChange(nextOpen: boolean) {
    if (!nextOpen) reset()
    onOpenChange(nextOpen)
  }

  async function onSubmit(values: EmployeeRolesEditFormValues) {
    const nextRoles = nextEmployeeRoles(employee.roles, values)
    try {
      await setRoles.mutateAsync({
        previousRoles: employee.roles,
        roles: nextRoles,
      })
      toast.success(
        `Actualizamos los roles de ${employee.firstName} ${employee.lastName}.`,
      )
      handleOpenChange(false)
    } catch (error) {
      toast.error(
        isApiError(error) ? error.message : 'No pudimos guardar los roles.',
      )
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Editar roles</DialogTitle>
          <DialogDescription>
            Elegí al menos uno de los dos roles para {employee.firstName}{' '}
            {employee.lastName}.
            {preservedRoles.length > 0 &&
              ' Sus otros roles de administración no se tocan acá: se gestionan desde Usuarios y roles.'}
          </DialogDescription>
        </DialogHeader>
        <form
          noValidate
          onSubmit={(event) => void handleSubmit(onSubmit)(event)}
        >
          <div className="flex flex-wrap gap-4">
            <Controller
              control={control}
              name="isEmployeeRole"
              render={({ field }) => (
                <label
                  htmlFor="employee-roles-dialog-employee"
                  className="flex items-center gap-2 text-[12.5px] text-text-2"
                >
                  <Checkbox
                    id="employee-roles-dialog-employee"
                    checked={field.value}
                    onCheckedChange={(checked) =>
                      field.onChange(checked === true)
                    }
                  />
                  Empleado
                </label>
              )}
            />
            <Controller
              control={control}
              name="isSupervisorRole"
              render={({ field }) => (
                <label
                  htmlFor="employee-roles-dialog-supervisor"
                  className="flex items-center gap-2 text-[12.5px] text-text-2"
                >
                  <Checkbox
                    id="employee-roles-dialog-supervisor"
                    checked={field.value}
                    onCheckedChange={(checked) =>
                      field.onChange(checked === true)
                    }
                  />
                  Supervisor
                </label>
              )}
            />
          </div>
          {errors.isEmployeeRole && (
            <p className="mt-2 text-[11px] text-danger">
              {errors.isEmployeeRole.message}
            </p>
          )}
          <DialogFooter className="mt-4">
            <Button
              type="button"
              variant="ghost"
              onClick={() => handleOpenChange(false)}
            >
              Cancelar
            </Button>
            <Button type="submit" loading={setRoles.isPending}>
              Guardar roles
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

export { EmployeeRolesDialog }
