import { useEffect } from 'react'
import { Controller, useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useNavigate, useParams } from 'react-router'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { PasswordInput } from '@/components/ui/password-input'
import { Textarea } from '@/components/ui/textarea'
import { Checkbox } from '@/components/ui/checkbox'
import { Field, FieldError, FieldLabel } from '@/components/ui/field'
import { Skeleton } from '@/components/ui/skeleton'
import { AvatarUpload } from '@/components/AvatarUpload'
import { EmptyState } from '@/components/EmptyState'
import { isApiError } from '@/api/errors'
import { useAuth } from '@/features/auth/AuthProvider'
import {
  employeeCreateFormValuesToInput,
  employeeCreateSchema,
  employeeEditFormValuesToInput,
  employeeEditSchema,
  type EmployeeCreateFormValues,
  type EmployeeEditFormValues,
} from '@/features/employees/schemas'
import {
  useCreateEmployeeMutation,
  useEmployeeDetailQuery,
  useSuggestedEmployeeNumberQuery,
  useUpdateEmployeeMutation,
} from '@/features/employees/queries'

/**
 * ADM-18 "Empleado · formulario" (EMP-003, EMP-004, `05` línea 67): alta
 * (`/admin/empleados/nuevo`) y edición (`/admin/empleados/:id/editar`) en
 * una sola ruta, mismo criterio que `ClientFormPage` — el modo lo decide
 * `useParams().id`, pero acá cada modo tiene bastantes campos propios
 * (usuario y roles solo al crear; foto y email de contacto solo al editar),
 * así que cada uno es un componente aparte con su propio formulario en vez
 * de un único formulario con campos condicionales -- los bloques de datos
 * personales/laborales/contacto de emergencia que comparten se repiten una
 * vez en cada uno (decisión menor: React Hook Form tipa `register` por el
 * esquema exacto del formulario, así que un componente "compartido" habría
 * necesitado forzar el tipo con `any` en vez de repetir JSX, ver el reporte
 * del encargo).
 */
export default function EmployeeFormPage() {
  const { id } = useParams<{ id: string }>()
  return id ? <EmployeeEditForm profileId={id} /> : <EmployeeCreateForm />
}

// -------------------------------------------------------------------------
// Alta (EMP-003)
// -------------------------------------------------------------------------

function EmployeeCreateForm() {
  const navigate = useNavigate()
  const createEmployee = useCreateEmployeeMutation()
  const suggestedNumberQuery = useSuggestedEmployeeNumberQuery(true)

  const {
    control,
    register,
    handleSubmit,
    setValue,
    formState: { errors, dirtyFields },
  } = useForm<EmployeeCreateFormValues>({
    resolver: zodResolver(employeeCreateSchema),
    defaultValues: {
      firstName: '',
      lastName: '',
      dni: '',
      cuil: '',
      employeeNumber: '1',
      phone: '',
      address: '',
      birthDate: '',
      hireDate: '',
      emergencyContactName: '',
      emergencyContactPhone: '',
      emergencyContactRelationship: '',
      notes: '',
      isEmployeeRole: true,
      isSupervisorRole: false,
      email: '',
      password: '',
    },
  })

  // Legajo sugerido: se completa solo mientras la persona no haya tocado el
  // campo a mano (así no le pisa un valor que ya cambió).
  useEffect(() => {
    if (suggestedNumberQuery.data != null && !dirtyFields.employeeNumber) {
      setValue('employeeNumber', String(suggestedNumberQuery.data))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [suggestedNumberQuery.data])

  async function onSubmit(values: EmployeeCreateFormValues) {
    try {
      const input = employeeCreateFormValuesToInput(values)
      const result = await createEmployee.mutateAsync(input)
      if (result.employeeNumberWarning) {
        toast.warning(result.employeeNumberWarning)
      } else {
        toast.success(
          `Creamos a ${values.firstName} ${values.lastName} con el legajo ${result.employeeNumber}.`,
        )
      }
      void navigate(`/admin/empleados/${result.profileId}`)
    } catch (error) {
      toast.error(
        isApiError(error) ? error.message : 'No pudimos crear a la persona.',
      )
    }
  }

  return (
    <form
      noValidate
      onSubmit={(event) => void handleSubmit(onSubmit)(event)}
      className="flex max-w-2xl flex-col gap-4"
    >
      <div className="rounded-lg border border-border bg-surface p-5">
        <h2 className="mb-3 text-[14px] font-semibold text-text">Roles</h2>
        <div className="flex flex-wrap gap-4">
          <Controller
            control={control}
            name="isEmployeeRole"
            render={({ field }) => (
              <label
                htmlFor="employee-role-employee"
                className="flex items-center gap-2 text-[12.5px] text-text-2"
              >
                <Checkbox
                  id="employee-role-employee"
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
                htmlFor="employee-role-supervisor"
                className="flex items-center gap-2 text-[12.5px] text-text-2"
              >
                <Checkbox
                  id="employee-role-supervisor"
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
      </div>

      <div className="rounded-lg border border-border bg-surface p-5">
        <h2 className="mb-3 text-[14px] font-semibold text-text">
          Usuario y contraseña
        </h2>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field data-invalid={Boolean(errors.email) || undefined}>
            <FieldLabel htmlFor="employee-email">Email de login</FieldLabel>
            <Input
              id="employee-email"
              type="email"
              aria-invalid={Boolean(errors.email)}
              {...register('email')}
            />
            {errors.email && <FieldError>{errors.email.message}</FieldError>}
          </Field>
          <Field data-invalid={Boolean(errors.password) || undefined}>
            <FieldLabel htmlFor="employee-password">
              Contraseña inicial
            </FieldLabel>
            <PasswordInput
              id="employee-password"
              autoComplete="new-password"
              aria-invalid={Boolean(errors.password)}
              {...register('password')}
            />
            {errors.password ? (
              <FieldError>{errors.password.message}</FieldError>
            ) : (
              <p className="text-[11px] text-text-3">
                La persona puede cambiarla después desde su perfil.
              </p>
            )}
          </Field>
        </div>
        <p className="mt-3 text-[11px] text-text-3">
          Vas a poder cargar la foto de perfil después de crear la cuenta, desde
          la ficha de la persona.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 rounded-lg border border-border bg-surface p-5 sm:grid-cols-2">
        <h2 className="text-[14px] font-semibold text-text sm:col-span-2">
          Datos personales
        </h2>
        <Field data-invalid={Boolean(errors.firstName) || undefined}>
          <FieldLabel htmlFor="employee-first-name">Nombre</FieldLabel>
          <Input
            id="employee-first-name"
            aria-invalid={Boolean(errors.firstName)}
            {...register('firstName')}
          />
          {errors.firstName && (
            <FieldError>{errors.firstName.message}</FieldError>
          )}
        </Field>
        <Field data-invalid={Boolean(errors.lastName) || undefined}>
          <FieldLabel htmlFor="employee-last-name">Apellido</FieldLabel>
          <Input
            id="employee-last-name"
            aria-invalid={Boolean(errors.lastName)}
            {...register('lastName')}
          />
          {errors.lastName && (
            <FieldError>{errors.lastName.message}</FieldError>
          )}
        </Field>
        <Field data-invalid={Boolean(errors.dni) || undefined}>
          <FieldLabel htmlFor="employee-dni">DNI</FieldLabel>
          <Input
            id="employee-dni"
            inputMode="numeric"
            aria-invalid={Boolean(errors.dni)}
            {...register('dni')}
          />
          {errors.dni && <FieldError>{errors.dni.message}</FieldError>}
        </Field>
        <Field data-invalid={Boolean(errors.cuil) || undefined}>
          <FieldLabel htmlFor="employee-cuil">CUIL</FieldLabel>
          <Input
            id="employee-cuil"
            inputMode="numeric"
            placeholder="20123456786"
            aria-invalid={Boolean(errors.cuil)}
            {...register('cuil')}
          />
          {errors.cuil && <FieldError>{errors.cuil.message}</FieldError>}
        </Field>
        <Field data-invalid={Boolean(errors.phone) || undefined}>
          <FieldLabel htmlFor="employee-phone">Teléfono</FieldLabel>
          <Input id="employee-phone" {...register('phone')} />
          {errors.phone && <FieldError>{errors.phone.message}</FieldError>}
        </Field>
        <Field data-invalid={Boolean(errors.birthDate) || undefined}>
          <FieldLabel htmlFor="employee-birth-date">
            Fecha de nacimiento
          </FieldLabel>
          <Input
            id="employee-birth-date"
            type="date"
            aria-invalid={Boolean(errors.birthDate)}
            {...register('birthDate')}
          />
          {errors.birthDate && (
            <FieldError>{errors.birthDate.message}</FieldError>
          )}
        </Field>
        <Field className="sm:col-span-2">
          <FieldLabel htmlFor="employee-address">Domicilio</FieldLabel>
          <Input id="employee-address" {...register('address')} />
        </Field>
      </div>

      <div className="grid grid-cols-1 gap-4 rounded-lg border border-border bg-surface p-5 sm:grid-cols-2">
        <h2 className="text-[14px] font-semibold text-text sm:col-span-2">
          Datos laborales
        </h2>
        <Field data-invalid={Boolean(errors.employeeNumber) || undefined}>
          <FieldLabel htmlFor="employee-number">Legajo</FieldLabel>
          <Input
            id="employee-number"
            type="number"
            inputMode="numeric"
            aria-invalid={Boolean(errors.employeeNumber)}
            {...register('employeeNumber')}
          />
          {errors.employeeNumber ? (
            <FieldError>{errors.employeeNumber.message}</FieldError>
          ) : (
            <p className="text-[11px] text-text-3">
              Sugerido según el último cargado; podés cambiarlo.
            </p>
          )}
        </Field>
        <Field>
          <FieldLabel htmlFor="employee-hire-date">Fecha de ingreso</FieldLabel>
          <Input
            id="employee-hire-date"
            type="date"
            {...register('hireDate')}
          />
        </Field>
        <Field className="sm:col-span-2">
          <FieldLabel htmlFor="employee-notes">Notas</FieldLabel>
          <Textarea id="employee-notes" rows={3} {...register('notes')} />
        </Field>
      </div>

      <div className="grid grid-cols-1 gap-4 rounded-lg border border-border bg-surface p-5 sm:grid-cols-3">
        <h2 className="text-[14px] font-semibold text-text sm:col-span-3">
          Contacto de emergencia
        </h2>
        <Field>
          <FieldLabel htmlFor="employee-emergency-name">Nombre</FieldLabel>
          <Input
            id="employee-emergency-name"
            {...register('emergencyContactName')}
          />
        </Field>
        <Field>
          <FieldLabel htmlFor="employee-emergency-phone">Teléfono</FieldLabel>
          <Input
            id="employee-emergency-phone"
            {...register('emergencyContactPhone')}
          />
        </Field>
        <Field>
          <FieldLabel htmlFor="employee-emergency-relationship">
            Vínculo
          </FieldLabel>
          <Input
            id="employee-emergency-relationship"
            {...register('emergencyContactRelationship')}
          />
        </Field>
      </div>

      <div className="flex gap-2">
        <Button type="submit" loading={createEmployee.isPending}>
          Crear
        </Button>
        <Button
          type="button"
          variant="ghost"
          onClick={() => void navigate(-1)}
          disabled={createEmployee.isPending}
        >
          Cancelar
        </Button>
      </div>
    </form>
  )
}

// -------------------------------------------------------------------------
// Edición (EMP-004)
// -------------------------------------------------------------------------

function EmployeeEditForm({ profileId }: { profileId: string }) {
  const navigate = useNavigate()
  const auth = useAuth()
  const employeeQuery = useEmployeeDetailQuery(profileId)
  const updateEmployee = useUpdateEmployeeMutation()

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<EmployeeEditFormValues>({
    resolver: zodResolver(employeeEditSchema),
    defaultValues: {
      firstName: '',
      lastName: '',
      dni: '',
      cuil: '',
      employeeNumber: '1',
      phone: '',
      address: '',
      birthDate: '',
      hireDate: '',
      emergencyContactName: '',
      emergencyContactPhone: '',
      emergencyContactRelationship: '',
      notes: '',
      contactEmail: '',
    },
    values: employeeQuery.data
      ? {
          firstName: employeeQuery.data.firstName,
          lastName: employeeQuery.data.lastName,
          dni: employeeQuery.data.dni,
          cuil: employeeQuery.data.cuil ?? '',
          employeeNumber: String(employeeQuery.data.employeeNumber),
          phone: employeeQuery.data.phone ?? '',
          address: employeeQuery.data.address ?? '',
          birthDate: employeeQuery.data.birthDate ?? '',
          hireDate: employeeQuery.data.hireDate ?? '',
          emergencyContactName: employeeQuery.data.emergencyContactName ?? '',
          emergencyContactPhone: employeeQuery.data.emergencyContactPhone ?? '',
          emergencyContactRelationship:
            employeeQuery.data.emergencyContactRelationship ?? '',
          notes: employeeQuery.data.notes ?? '',
          contactEmail: employeeQuery.data.contactEmail ?? '',
        }
      : undefined,
  })

  async function onSubmit(formValues: EmployeeEditFormValues) {
    try {
      const input = employeeEditFormValuesToInput(formValues)
      await updateEmployee.mutateAsync({
        profileId,
        input,
        updatedBy: auth.userId as string,
      })
      toast.success('Guardamos los cambios.')
      void navigate(`/admin/empleados/${profileId}`)
    } catch (error) {
      toast.error(
        isApiError(error) ? error.message : 'No pudimos guardar los cambios.',
      )
    }
  }

  if (employeeQuery.isLoading) {
    return (
      <div className="flex max-w-xl flex-col gap-3">
        <Skeleton className="h-9" />
        <Skeleton className="h-9" />
        <Skeleton className="h-48" />
      </div>
    )
  }

  if (!employeeQuery.data) {
    return (
      <EmptyState
        title="No encontramos a esta persona"
        description="Puede que se haya movido o que el enlace esté roto."
      />
    )
  }

  return (
    <form
      noValidate
      onSubmit={(event) => void handleSubmit(onSubmit)(event)}
      className="flex max-w-2xl flex-col gap-4"
    >
      <div className="rounded-lg border border-border bg-surface p-5">
        <h2 className="mb-3 text-[14px] font-semibold text-text">
          Foto de perfil
        </h2>
        <AvatarUpload
          profileId={profileId}
          name={`${employeeQuery.data.firstName} ${employeeQuery.data.lastName}`}
          avatarPath={employeeQuery.data.avatarPath}
        />
      </div>

      <div className="grid grid-cols-1 gap-4 rounded-lg border border-border bg-surface p-5 sm:grid-cols-2">
        <h2 className="text-[14px] font-semibold text-text sm:col-span-2">
          Datos personales
        </h2>
        <Field data-invalid={Boolean(errors.firstName) || undefined}>
          <FieldLabel htmlFor="employee-first-name">Nombre</FieldLabel>
          <Input
            id="employee-first-name"
            aria-invalid={Boolean(errors.firstName)}
            {...register('firstName')}
          />
          {errors.firstName && (
            <FieldError>{errors.firstName.message}</FieldError>
          )}
        </Field>
        <Field data-invalid={Boolean(errors.lastName) || undefined}>
          <FieldLabel htmlFor="employee-last-name">Apellido</FieldLabel>
          <Input
            id="employee-last-name"
            aria-invalid={Boolean(errors.lastName)}
            {...register('lastName')}
          />
          {errors.lastName && (
            <FieldError>{errors.lastName.message}</FieldError>
          )}
        </Field>
        <Field data-invalid={Boolean(errors.dni) || undefined}>
          <FieldLabel htmlFor="employee-dni">DNI</FieldLabel>
          <Input
            id="employee-dni"
            inputMode="numeric"
            aria-invalid={Boolean(errors.dni)}
            {...register('dni')}
          />
          {errors.dni && <FieldError>{errors.dni.message}</FieldError>}
        </Field>
        <Field data-invalid={Boolean(errors.cuil) || undefined}>
          <FieldLabel htmlFor="employee-cuil">CUIL</FieldLabel>
          <Input
            id="employee-cuil"
            inputMode="numeric"
            placeholder="20123456786"
            aria-invalid={Boolean(errors.cuil)}
            {...register('cuil')}
          />
          {errors.cuil && <FieldError>{errors.cuil.message}</FieldError>}
        </Field>
        <Field data-invalid={Boolean(errors.phone) || undefined}>
          <FieldLabel htmlFor="employee-phone">Teléfono</FieldLabel>
          <Input id="employee-phone" {...register('phone')} />
          {errors.phone && <FieldError>{errors.phone.message}</FieldError>}
        </Field>
        <Field data-invalid={Boolean(errors.birthDate) || undefined}>
          <FieldLabel htmlFor="employee-birth-date">
            Fecha de nacimiento
          </FieldLabel>
          <Input
            id="employee-birth-date"
            type="date"
            aria-invalid={Boolean(errors.birthDate)}
            {...register('birthDate')}
          />
          {errors.birthDate && (
            <FieldError>{errors.birthDate.message}</FieldError>
          )}
        </Field>
        <Field className="sm:col-span-2">
          <FieldLabel htmlFor="employee-address">Domicilio</FieldLabel>
          <Input id="employee-address" {...register('address')} />
        </Field>
      </div>

      <div className="grid grid-cols-1 gap-4 rounded-lg border border-border bg-surface p-5 sm:grid-cols-2">
        <h2 className="text-[14px] font-semibold text-text sm:col-span-2">
          Datos laborales
        </h2>
        <Field data-invalid={Boolean(errors.employeeNumber) || undefined}>
          <FieldLabel htmlFor="employee-number">Legajo</FieldLabel>
          <Input
            id="employee-number"
            type="number"
            inputMode="numeric"
            aria-invalid={Boolean(errors.employeeNumber)}
            {...register('employeeNumber')}
          />
          {errors.employeeNumber && (
            <FieldError>{errors.employeeNumber.message}</FieldError>
          )}
        </Field>
        <Field>
          <FieldLabel htmlFor="employee-hire-date">Fecha de ingreso</FieldLabel>
          <Input
            id="employee-hire-date"
            type="date"
            {...register('hireDate')}
          />
        </Field>
        <Field className="sm:col-span-2">
          <FieldLabel htmlFor="employee-notes">Notas</FieldLabel>
          <Textarea id="employee-notes" rows={3} {...register('notes')} />
        </Field>
      </div>

      <div className="grid grid-cols-1 gap-4 rounded-lg border border-border bg-surface p-5 sm:grid-cols-3">
        <h2 className="text-[14px] font-semibold text-text sm:col-span-3">
          Contacto de emergencia
        </h2>
        <Field>
          <FieldLabel htmlFor="employee-emergency-name">Nombre</FieldLabel>
          <Input
            id="employee-emergency-name"
            {...register('emergencyContactName')}
          />
        </Field>
        <Field>
          <FieldLabel htmlFor="employee-emergency-phone">Teléfono</FieldLabel>
          <Input
            id="employee-emergency-phone"
            {...register('emergencyContactPhone')}
          />
        </Field>
        <Field>
          <FieldLabel htmlFor="employee-emergency-relationship">
            Vínculo
          </FieldLabel>
          <Input
            id="employee-emergency-relationship"
            {...register('emergencyContactRelationship')}
          />
        </Field>
      </div>

      <div className="rounded-lg border border-border bg-surface p-5">
        <h2 className="mb-3 text-[14px] font-semibold text-text">Contacto</h2>
        <Field data-invalid={Boolean(errors.contactEmail) || undefined}>
          <FieldLabel htmlFor="employee-contact-email">
            Email de contacto
          </FieldLabel>
          <Input
            id="employee-contact-email"
            type="email"
            aria-invalid={Boolean(errors.contactEmail)}
            {...register('contactEmail')}
          />
          {errors.contactEmail && (
            <FieldError>{errors.contactEmail.message}</FieldError>
          )}
        </Field>
      </div>

      <div className="flex gap-2">
        <Button type="submit" loading={updateEmployee.isPending}>
          Guardar cambios
        </Button>
        <Button
          type="button"
          variant="ghost"
          onClick={() => void navigate(-1)}
          disabled={updateEmployee.isPending}
        >
          Cancelar
        </Button>
      </div>
    </form>
  )
}
