import { useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Sheet,
  SheetContent,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { ToggleRow } from '@/components/ToggleRow'
import { isApiError } from '@/api/errors'
import {
  ALL_ADMIN_CAPABILITIES,
  type AdminCapability,
  type AdminUserRow,
  type Role,
} from '@/api/users'
import { ROLE_LABELS } from '@/features/auth/session'
import {
  useAdminCapabilitiesQuery,
  useSetAdminCapabilityMutation,
  useSetUserRolesMutation,
} from '@/features/users/queries'

/** Orden fijo de `04_Modelo_de_Datos.md` sección 3: owner, admin, supervisor, employee. */
const ROLE_ORDER: Role[] = ['owner', 'admin', 'supervisor', 'employee']

/** Etiquetas y ayuda de `04_Modelo_de_Datos.md` sección 3 (fila `admin_capability`). */
const CAPABILITY_INFO: Record<
  AdminCapability,
  { label: string; description?: string }
> = {
  manage_users: {
    label: 'Gestionar usuarios',
    description:
      'Crear, desactivar y resetear usuarios con rol empleado o supervisor.',
  },
  cancel_shifts: { label: 'Cancelar turnos' },
  edit_ratings: { label: 'Editar calificaciones' },
  edit_checklists: { label: 'Editar plantillas de tareas' },
  manage_attendance: {
    label: 'Registrar asistencia por otros',
    description:
      'Registrar inicio, fin y avisos en nombre de empleados; cerrar asignaciones sin fin.',
  },
  generate_shifts: { label: 'Generar turnos del mes' },
  manage_supervisions: {
    label: 'Asignar supervisiones',
    description: 'Asignar y cancelar supervisiones.',
  },
}

/**
 * USERS-010: editor de roles y capacidades, solo para el dueño
 * (`canEditRolesAndCapabilities`, chequeado por quien abre este drawer --
 * acá no se vuelve a chequear porque el servidor es quien de verdad manda:
 * `set_user_roles`/`set_admin_capability` rechazan con `FORBIDDEN` a
 * cualquiera que no sea el dueño, ver `permissions.ts`).
 *
 * Roles y capacidades son dos acciones independientes (dos RPC distintas,
 * `06_API.md` sección 2.2): el botón "Guardar roles" reemplaza el conjunto
 * completo de una vez; las capacidades se guardan solas, al toquetear cada
 * `ToggleRow` (mismo patrón que cualquier panel de configuración con
 * switches, sin un botón "Guardar" aparte para ellas).
 */
function RolesCapabilitiesSheet({
  user,
  open,
  onOpenChange,
}: {
  user: AdminUserRow
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const [selectedRoles, setSelectedRoles] = useState<Role[]>(user.roles)
  const setUserRoles = useSetUserRolesMutation()

  // Vuelve a partir de los roles persistidos cada vez que se abre (no
  // arrastra la selección sin guardar de la vez anterior si se cerró sin
  // confirmar). Ajuste de estado durante el render (patrón de React para
  // "resetear estado cuando cambia una prop"), mismo criterio que
  // `ConfirmDialog` -- no un efecto, para no encadenar un render de más.
  const [wasOpen, setWasOpen] = useState(open)
  if (open !== wasOpen) {
    setWasOpen(open)
    if (open) {
      setSelectedRoles(user.roles)
    }
  }

  const isAdminNow = user.roles.includes('admin')
  const capabilitiesQuery = useAdminCapabilitiesQuery(
    user.profileId,
    open && isAdminNow,
  )
  const setAdminCapability = useSetAdminCapabilityMutation()

  const rolesChanged =
    selectedRoles.length !== user.roles.length ||
    selectedRoles.some((role) => !user.roles.includes(role))
  const willSignOut = user.roles.some((role) => !selectedRoles.includes(role))

  function toggleRole(role: Role, checked: boolean) {
    setSelectedRoles((current) =>
      checked ? [...current, role] : current.filter((r) => r !== role),
    )
  }

  async function handleSaveRoles() {
    try {
      await setUserRoles.mutateAsync({
        profileId: user.profileId,
        previousRoles: user.roles,
        roles: selectedRoles,
      })
      toast.success(
        `Actualizamos los roles de ${user.firstName} ${user.lastName}.`,
      )
    } catch (error) {
      toast.error(
        isApiError(error) ? error.message : 'No pudimos guardar los roles.',
      )
    }
  }

  async function handleToggleCapability(
    capability: AdminCapability,
    enabled: boolean,
  ) {
    try {
      await setAdminCapability.mutateAsync({
        profileId: user.profileId,
        capability,
        enabled,
      })
    } catch (error) {
      toast.error(
        isApiError(error) ? error.message : 'No pudimos guardar esa capacidad.',
      )
    }
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="overflow-y-auto">
        <SheetHeader>
          <SheetTitle>
            Roles y capacidades de {user.firstName} {user.lastName}
          </SheetTitle>
        </SheetHeader>
        <div className="flex flex-col gap-6 px-6">
          <section className="flex flex-col gap-3">
            <h3 className="text-[13px] font-semibold text-text">Roles</h3>
            <div className="flex flex-col gap-2">
              {ROLE_ORDER.map((role) => (
                <label
                  key={role}
                  className="flex items-center gap-[9px] text-[13px] text-text"
                >
                  <Checkbox
                    checked={selectedRoles.includes(role)}
                    onCheckedChange={(checked) =>
                      toggleRole(role, checked === true)
                    }
                  />
                  {ROLE_LABELS[role]}
                </label>
              ))}
            </div>
            {rolesChanged && willSignOut && (
              <p className="text-[11px] text-warning-800">
                Le vas a quitar al menos un rol: al guardar, vamos a cerrar
                todas sus sesiones para que el cambio tome efecto.
              </p>
            )}
            <Button
              type="button"
              size="sm"
              className="self-start"
              disabled={!rolesChanged}
              loading={setUserRoles.isPending}
              onClick={() => void handleSaveRoles()}
            >
              Guardar roles
            </Button>
          </section>

          {isAdminNow && (
            <section className="flex flex-col gap-1 border-t border-border pt-4">
              <h3 className="text-[13px] font-semibold text-text">
                Capacidades de administrador
              </h3>
              <p className="mb-2 text-[11px] text-text-3">
                Solo el dueño ve y edita estas capacidades. El dueño las tiene
                todas siempre, por eso no aparece en esta lista.
              </p>
              {capabilitiesQuery.isLoading ? (
                <div className="flex flex-col gap-2">
                  {ALL_ADMIN_CAPABILITIES.map((capability) => (
                    <Skeleton key={capability} className="h-9" />
                  ))}
                </div>
              ) : (
                ALL_ADMIN_CAPABILITIES.map((capability) => (
                  <ToggleRow
                    key={capability}
                    title={CAPABILITY_INFO[capability].label}
                    description={CAPABILITY_INFO[capability].description}
                    checked={capabilitiesQuery.data?.[capability] ?? false}
                    disabled={setAdminCapability.isPending}
                    onCheckedChange={(checked) =>
                      void handleToggleCapability(capability, checked)
                    }
                  />
                ))
              )}
            </section>
          )}
        </div>
        <SheetFooter>
          <Button
            type="button"
            variant="ghost"
            onClick={() => onOpenChange(false)}
          >
            Cerrar
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  )
}

export { RolesCapabilitiesSheet }
