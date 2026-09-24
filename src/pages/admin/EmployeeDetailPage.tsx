import { useMemo, useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router'
import { KeyRound, LogOut, Pencil, User, UserX } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Avatar } from '@/components/Avatar'
import { EmptyState } from '@/components/EmptyState'
import { StatusBadge } from '@/components/status'
import { avatarUrl } from '@/lib/avatarUrl'
import { formatShortDate } from '@/lib/format'
import { useAuth } from '@/features/auth/AuthProvider'
import { ROLE_LABELS } from '@/features/auth/session'
import {
  ResetEmployeePasswordDialog,
  SignOutEmployeeDialog,
  TerminateEmployeeDialog,
} from '@/features/employees/components/EmployeeAccountDialogs'
import {
  canEditEmployee,
  canManageEmployeeAccounts,
} from '@/features/employees/permissions'
import { useEmployeeDetailQuery } from '@/features/employees/queries'

const TABS = [
  'datos',
  'habilitaciones',
  'disponibilidad',
  'licencias',
  'proximos-turnos',
  'asistencia',
  'calificaciones',
] as const
type EmployeeDetailTab = (typeof TABS)[number]

function isEmployeeDetailTab(value: string | null): value is EmployeeDetailTab {
  return TABS.includes(value as EmployeeDetailTab)
}

/**
 * ADM-17 "Empleado · ficha" (EMP-005, `05` línea 66): cabecera (foto,
 * nombre, legajo, roles, estado efectivo) y pestaña Datos completa. Las
 * demás pestañas quedan con su estructura y un estado vacío -- se completan
 * en un encargo posterior (ver el reporte).
 */
export default function EmployeeDetailPage() {
  const { id } = useParams<{ id: string }>()
  const auth = useAuth()
  const actor = useMemo(
    () => ({ roles: auth.roles, capabilities: auth.capabilities }),
    [auth.roles, auth.capabilities],
  )
  const [searchParams, setSearchParams] = useSearchParams()
  const [openDialog, setOpenDialog] = useState<
    'reset-password' | 'sign-out' | 'terminate' | null
  >(null)

  const activeTab = isEmployeeDetailTab(searchParams.get('pestana'))
    ? (searchParams.get('pestana') as EmployeeDetailTab)
    : 'datos'

  function handleTabChange(value: string) {
    const next = new URLSearchParams(searchParams)
    if (value === 'datos') {
      next.delete('pestana')
    } else {
      next.set('pestana', value)
    }
    setSearchParams(next, { replace: true })
  }

  const employeeQuery = useEmployeeDetailQuery(id)

  if (!id) {
    return null
  }

  if (employeeQuery.isLoading) {
    return (
      <div className="flex flex-col gap-3">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-40" />
      </div>
    )
  }

  const employee = employeeQuery.data
  if (!employee) {
    return (
      <EmptyState
        icon={User}
        title="No encontramos a esta persona"
        description="Puede que se haya movido o que el enlace esté roto."
      />
    )
  }

  const isTerminated = employee.effectiveStatus === 'terminated'
  const canEdit = canEditEmployee(actor)
  const canManageAccount = canManageEmployeeAccounts(actor)

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-start justify-between gap-3 rounded-lg border border-border bg-surface p-5">
        <div className="flex min-w-0 items-center gap-4">
          <Avatar
            id={employee.profileId}
            name={`${employee.firstName} ${employee.lastName}`}
            src={employee.avatarPath ? avatarUrl(employee.avatarPath) : null}
            size="lg"
          />
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-[16px] font-semibold text-text">
                {employee.firstName} {employee.lastName}
              </h2>
              <StatusBadge
                domain="employee"
                status={employee.effectiveStatus}
              />
            </div>
            <p className="text-[12px] text-text-3">
              Legajo {employee.employeeNumber}
              {employee.roles.length > 0
                ? ` · ${employee.roles.map((role) => ROLE_LABELS[role]).join(', ')}`
                : ''}
            </p>
          </div>
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          {canManageAccount && !isTerminated && (
            <>
              <Button
                variant="ghost"
                size="sm"
                icon={KeyRound}
                onClick={() => setOpenDialog('reset-password')}
              >
                Resetear contraseña
              </Button>
              <Button
                variant="ghost"
                size="sm"
                icon={LogOut}
                onClick={() => setOpenDialog('sign-out')}
              >
                Cerrar sesiones
              </Button>
              <Button
                variant="ghost"
                size="sm"
                icon={UserX}
                onClick={() => setOpenDialog('terminate')}
              >
                Dar de baja
              </Button>
            </>
          )}
          {canEdit && (
            <Button asChild size="sm" icon={Pencil}>
              <Link to={`/admin/empleados/${employee.profileId}/editar`}>
                Editar
              </Link>
            </Button>
          )}
        </div>
      </div>

      <Tabs value={activeTab} onValueChange={handleTabChange}>
        <TabsList>
          <TabsTrigger value="datos">Datos</TabsTrigger>
          <TabsTrigger value="habilitaciones">Habilitaciones</TabsTrigger>
          <TabsTrigger value="disponibilidad">Disponibilidad</TabsTrigger>
          <TabsTrigger value="licencias">Licencias</TabsTrigger>
          <TabsTrigger value="proximos-turnos">Próximos turnos</TabsTrigger>
          <TabsTrigger value="asistencia">Asistencia</TabsTrigger>
          <TabsTrigger value="calificaciones">Calificaciones</TabsTrigger>
        </TabsList>

        <TabsContent value="datos" className="pt-3">
          <EmployeeDataTab employee={employee} />
        </TabsContent>

        <TabsContent value="habilitaciones" className="pt-3">
          <EmptyState
            title="Todavía no hay habilitaciones cargadas"
            description="Los clientes habilitados para esta persona se van a poder cargar acá."
          />
        </TabsContent>

        <TabsContent value="disponibilidad" className="pt-3">
          <EmptyState
            title="Todavía no hay disponibilidad cargada"
            description="Los horarios declarados por esta persona se van a poder cargar acá."
          />
        </TabsContent>

        <TabsContent value="licencias" className="pt-3">
          <EmptyState
            title="Todavía no hay licencias cargadas"
            description="Las licencias de esta persona se van a poder cargar acá."
          />
        </TabsContent>

        <TabsContent value="proximos-turnos" className="pt-3">
          <EmptyState
            title="Todavía no hay turnos próximos para mostrar"
            description="Los turnos asignados a esta persona se van a ver acá."
          />
        </TabsContent>

        <TabsContent value="asistencia" className="pt-3">
          <EmptyState
            title="Todavía no hay asistencia para mostrar"
            description="El historial de inicios y fines de esta persona se va a ver acá."
          />
        </TabsContent>

        <TabsContent value="calificaciones" className="pt-3">
          <EmptyState
            title="Todavía no hay calificaciones para mostrar"
            description="Las calificaciones recibidas por esta persona se van a ver acá."
          />
        </TabsContent>
      </Tabs>

      <ResetEmployeePasswordDialog
        employee={employee}
        open={openDialog === 'reset-password'}
        onOpenChange={(open) => setOpenDialog(open ? 'reset-password' : null)}
      />
      <SignOutEmployeeDialog
        employee={employee}
        open={openDialog === 'sign-out'}
        onOpenChange={(open) => setOpenDialog(open ? 'sign-out' : null)}
      />
      <TerminateEmployeeDialog
        employee={employee}
        updatedBy={auth.userId as string}
        open={openDialog === 'terminate'}
        onOpenChange={(open) => setOpenDialog(open ? 'terminate' : null)}
      />
    </div>
  )
}

function LabeledValue({
  label,
  value,
}: {
  label: string
  value: string | null | undefined
}) {
  // Regla común (encargos anteriores): en líneas con datos opcionales, se
  // omite la fila entera si el valor falta, sin dejar un "—" suelto.
  if (!value) {
    return null
  }
  return (
    <div>
      <dt className="text-[10px] font-semibold tracking-wide text-text-3 uppercase">
        {label}
      </dt>
      <dd className="text-[12.5px] text-text">{value}</dd>
    </div>
  )
}

function EmployeeDataTab({
  employee,
}: {
  employee: NonNullable<ReturnType<typeof useEmployeeDetailQuery>['data']>
}) {
  return (
    <div className="flex flex-col gap-4">
      <section className="rounded-lg border border-border bg-surface p-5">
        <h3 className="mb-3 text-[13px] font-semibold text-text">
          Datos personales
        </h3>
        <dl className="grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-3">
          <LabeledValue label="DNI" value={employee.dni} />
          <LabeledValue label="CUIL" value={employee.cuil} />
          <LabeledValue label="Teléfono" value={employee.phone} />
          <LabeledValue label="Domicilio" value={employee.address} />
          <LabeledValue
            label="Fecha de nacimiento"
            value={
              employee.birthDate ? formatShortDate(employee.birthDate) : null
            }
          />
        </dl>
      </section>

      <section className="rounded-lg border border-border bg-surface p-5">
        <h3 className="mb-3 text-[13px] font-semibold text-text">
          Datos laborales
        </h3>
        <dl className="grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-3">
          <LabeledValue
            label="Legajo"
            value={String(employee.employeeNumber)}
          />
          <LabeledValue
            label="Fecha de ingreso"
            value={
              employee.hireDate ? formatShortDate(employee.hireDate) : null
            }
          />
          <LabeledValue
            label="Fecha de baja"
            value={
              employee.terminatedAt
                ? formatShortDate(employee.terminatedAt)
                : null
            }
          />
        </dl>
        {employee.notes && (
          <p className="mt-3 text-[12px] text-text-2">{employee.notes}</p>
        )}
      </section>

      <section className="rounded-lg border border-border bg-surface p-5">
        <h3 className="mb-3 text-[13px] font-semibold text-text">
          Contacto de emergencia
        </h3>
        <dl className="grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-3">
          <LabeledValue label="Nombre" value={employee.emergencyContactName} />
          <LabeledValue
            label="Teléfono"
            value={employee.emergencyContactPhone}
          />
          <LabeledValue
            label="Vínculo"
            value={employee.emergencyContactRelationship}
          />
        </dl>
        {!employee.emergencyContactName &&
          !employee.emergencyContactPhone &&
          !employee.emergencyContactRelationship && (
            <p className="text-[12px] text-text-3">
              Todavía no se cargó un contacto de emergencia.
            </p>
          )}
      </section>

      <section className="rounded-lg border border-border bg-surface p-5">
        <h3 className="mb-3 text-[13px] font-semibold text-text">
          Usuario y roles
        </h3>
        <dl className="grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-3">
          <div>
            <dt className="text-[10px] font-semibold tracking-wide text-text-3 uppercase">
              Roles
            </dt>
            <dd className="text-[12.5px] text-text">
              {employee.roles.length > 0
                ? employee.roles.map((role) => ROLE_LABELS[role]).join(', ')
                : 'Sin rol asignado'}
            </dd>
          </div>
          <div>
            <dt className="text-[10px] font-semibold tracking-wide text-text-3 uppercase">
              Acceso
            </dt>
            <dd>
              <StatusBadge
                domain="user"
                status={employee.isActiveAccount ? 'activo' : 'desactivado'}
              />
            </dd>
          </div>
          <LabeledValue
            label="Email de contacto"
            value={employee.contactEmail}
          />
        </dl>
      </section>
    </div>
  )
}
