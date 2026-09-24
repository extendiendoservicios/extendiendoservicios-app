import { z } from 'zod'

/**
 * Esquemas zod de ADM-18 (EMP-001, EMP-003, EMP-004): repiten las
 * restricciones que ya exige el servidor (`supabase/migrations/
 * 0016_hardening.sql`: `dni ~ '^[0-9]+$'`, `cuil ~ '^[0-9]{11}$'`;
 * `0006_employees.sql`: `employee_number` único; `supabase/functions/
 * admin-users/index.ts`: email válido, contraseña de al menos 8
 * caracteres), no las reemplazan -- el servidor vuelve a validar todo esto.
 */

/** `0016_hardening.sql`: `employees_dni_format_check`. */
const dniSchema = z
  .string()
  .trim()
  .min(1, 'Falta el DNI.')
  .regex(/^[0-9]+$/, 'El DNI tiene que tener solo dígitos, sin puntos.')

/** `0016_hardening.sql`: `employees_cuil_format_check` (opcional, 11 dígitos si se carga). */
const cuilSchema = z
  .string()
  .trim()
  .optional()
  .refine(
    (value) => !value || /^[0-9]{11}$/.test(value),
    'El CUIL tiene que tener 11 dígitos, sin puntos ni guiones.',
  )

/**
 * `0006_employees.sql`: `employee_number integer not null unique`. Como
 * texto (no `z.coerce.number()`): el tipo de entrada y el de salida de
 * `z.coerce` no coinciden (`unknown` vs `number`), lo que rompe el tipado de
 * `zodResolver` con `useForm` -- mismo criterio que `cuit`/`cuil` en
 * `clients/schemas.ts`, convertido a `number` recién en
 * `commonValuesToInput`.
 */
const employeeNumberSchema = z
  .string()
  .trim()
  .min(1, 'Indicá el legajo.')
  .regex(/^[0-9]+$/, 'El legajo tiene que ser un número entero positivo.')
  .refine(
    (value) => Number(value) > 0,
    'El legajo tiene que ser mayor que cero.',
  )

/** Cadena vacía → `null` (así no se guarda `''` en una columna opcional). */
function emptyToNull(value: string | undefined): string | null {
  const trimmed = value?.trim() ?? ''
  return trimmed.length > 0 ? trimmed : null
}

/**
 * Campos comunes a alta y edición: datos personales y laborales de P-032
 * (nombre, apellido, DNI, CUIL, legajo, teléfono, domicilio, fecha de
 * nacimiento, fecha de ingreso, contacto de emergencia, notas) más los dos
 * roles que puede tener un empleado desde ADM-18 (`05` línea 67: "roles
 * (empleado, supervisor; admin y dueño solo desde ADM-27)").
 */
const employeeCommonFieldsSchema = z.object({
  firstName: z.string().trim().min(1, 'Falta el nombre.'),
  lastName: z.string().trim().min(1, 'Falta el apellido.'),
  dni: dniSchema,
  cuil: cuilSchema,
  employeeNumber: employeeNumberSchema,
  phone: z.string().trim().optional(),
  address: z.string().trim().optional(),
  birthDate: z.string().trim().optional(),
  hireDate: z.string().trim().optional(),
  emergencyContactName: z.string().trim().optional(),
  emergencyContactPhone: z.string().trim().optional(),
  emergencyContactRelationship: z.string().trim().optional(),
  notes: z.string().trim().optional(),
  isEmployeeRole: z.boolean(),
  isSupervisorRole: z.boolean(),
})

function refineAtLeastOneRole<
  T extends z.ZodType<{ isEmployeeRole: boolean; isSupervisorRole: boolean }>,
>(schema: T) {
  return schema.refine(
    (values) => values.isEmployeeRole || values.isSupervisorRole,
    {
      message: 'Elegí al menos un rol: empleado o supervisor.',
      path: ['isEmployeeRole'],
    },
  )
}

/** EMP-003: alta (ADM-18). Suma el usuario (email de login y contraseña inicial). */
export const employeeCreateSchema = refineAtLeastOneRole(
  employeeCommonFieldsSchema.extend({
    email: z.email('Ingresá un email válido.'),
    password: z
      .string()
      .min(8, 'La contraseña tiene que tener al menos 8 caracteres.'),
  }),
)
export type EmployeeCreateFormValues = z.infer<typeof employeeCreateSchema>

/**
 * EMP-004: edición (ADM-18). Sin email de login ni contraseña (`05` línea
 * 67 / instrucción del encargo: "sin cambiar el email de login acá: eso es
 * la acción de usuario") ni roles (cambiar roles no está en el alcance de
 * "editar datos laborales y personales" de EMP-004; queda para una fase
 * posterior -- ver el reporte del encargo). Suma el email de contacto
 * (`profiles.contact_email`, editable por O/A, `04` sección 7.2).
 */
export const employeeEditSchema = employeeCommonFieldsSchema
  .omit({ isEmployeeRole: true, isSupervisorRole: true })
  .extend({
    contactEmail: z
      .string()
      .trim()
      .optional()
      .refine(
        (value) => !value || z.email().safeParse(value).success,
        'Ingresá un email válido.',
      ),
  })
export type EmployeeEditFormValues = z.infer<typeof employeeEditSchema>

/** Roles elegidos (checkboxes) → arreglo `app_role[]` para la Edge Function. */
export function employeeRolesFromCheckboxes(values: {
  isEmployeeRole: boolean
  isSupervisorRole: boolean
}): ('employee' | 'supervisor')[] {
  const roles: ('employee' | 'supervisor')[] = []
  if (values.isEmployeeRole) roles.push('employee')
  if (values.isSupervisorRole) roles.push('supervisor')
  return roles
}

/** Normaliza los campos comunes antes de mandarlos a `src/api/employees.ts`. */
function commonValuesToInput(
  values: Omit<
    z.infer<typeof employeeCommonFieldsSchema>,
    'isEmployeeRole' | 'isSupervisorRole'
  >,
) {
  return {
    firstName: values.firstName.trim(),
    lastName: values.lastName.trim(),
    dni: values.dni.trim(),
    cuil: emptyToNull(values.cuil),
    employeeNumber: Number(values.employeeNumber),
    phone: emptyToNull(values.phone),
    address: emptyToNull(values.address),
    birthDate: emptyToNull(values.birthDate),
    hireDate: emptyToNull(values.hireDate),
    emergencyContactName: emptyToNull(values.emergencyContactName),
    emergencyContactPhone: emptyToNull(values.emergencyContactPhone),
    emergencyContactRelationship: emptyToNull(
      values.emergencyContactRelationship,
    ),
    notes: emptyToNull(values.notes),
  }
}

export function employeeCreateFormValuesToInput(
  values: EmployeeCreateFormValues,
) {
  return {
    ...commonValuesToInput(values),
    email: values.email.trim(),
    password: values.password,
    roles: employeeRolesFromCheckboxes(values),
  }
}

export function employeeEditFormValuesToInput(values: EmployeeEditFormValues) {
  return {
    ...commonValuesToInput(values),
    contactEmail: emptyToNull(values.contactEmail),
  }
}
