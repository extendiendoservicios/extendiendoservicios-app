// tests/e2e-employee-shift/helpers/employeeFixture.ts — MOB-EMP-017/TEST-010 (P13.4)
//
// Un empleado descartable propio para esta suite (en vez de usar los del seed, `maria.gomez` y
// compañía): el turno completo de punta a punta escribe estado real (registro de inicio y fin,
// tareas, observación) y el encargo pide datos propios de la suite, sin tocar los turnos reales
// del seed. Mismo patrón que `tests/e2e-auth/helpers/adminClient.ts` (cuenta descartable con
// `auth.admin.createUser`), sumándole lo que le falta a esa cuenta para ser un empleado de verdad
// (`user_roles` + `employees`, ADR-007, 04 sección 2.1) sin pasar por la Edge Function
// `admin-users` (no hace falta probar el alta acá: eso ya lo cubre `tests/e2e-employees/`).

import type { AdminClient } from './adminClient.ts'

export const EMPLOYEE_FIXTURE_PREFIX = 'E2E-P134'

export interface DisposableEmployee {
  profileId: string
  email: string
  password: string
  firstName: string
  lastName: string
}

/** Email descartable único por corrida, en un dominio que no es el de la empresa real. */
function disposableEmail(slug: string): string {
  return `e2e-p134-${slug}-${Date.now()}@example.com`
}

/**
 * DNI único por corrida (la base solo exige "solo números", sin largo fijo ni dígito
 * verificador, `employees_dni_format_check`): milisegundos de `Date.now()` más un dígito al azar.
 */
function disposableDni(): string {
  const randomDigit = Math.floor(Math.random() * 10).toString()
  return `${Date.now()}${randomDigit}`
}

/**
 * Crea una cuenta con rol `employee` completa: Auth (ya confirmada), `profiles` (la crea sola el
 * trigger `app.handle_new_user()` a partir de `user_metadata`), `user_roles` y `employees`. La
 * contraseña se deriva de `SEED_DEV_PASSWORD` (nunca un literal nuevo en el código, regla común
 * 6) más el `slug`, mismo criterio que `tests/e2e-auth/deactivated-user.spec.ts`.
 */
export async function createDisposableEmployee(
  admin: AdminClient,
  slug: string,
  seedPassword: string,
): Promise<DisposableEmployee> {
  const email = disposableEmail(slug)
  const password = `${seedPassword}-${slug}`
  const firstName = 'E2E'
  const lastName = `Empleado ${slug} ${Date.now()}`

  const { data: userData, error: userError } =
    await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { first_name: firstName, last_name: lastName },
    })
  if (userError || !userData.user) {
    throw new Error(
      `No se pudo crear la cuenta descartable ${email}: ${userError?.message ?? 'sin usuario'}`,
    )
  }
  const profileId = userData.user.id

  const { error: roleError } = await admin
    .from('user_roles')
    .insert({ profile_id: profileId, role: 'employee' })
  if (roleError) {
    throw new Error(
      `No se pudo dar el rol employee a ${email}: ${roleError.message}`,
    )
  }

  const { error: employeeError } = await admin.from('employees').insert({
    profile_id: profileId,
    dni: disposableDni(),
    hire_date: new Date().toISOString().slice(0, 10),
    status: 'active',
  })
  if (employeeError) {
    throw new Error(
      `No se pudo crear la ficha de employees para ${email}: ${employeeError.message}`,
    )
  }

  return { profileId, email, password, firstName, lastName }
}

/**
 * Deja la cuenta descartable inutilizable, sin borrado físico (`04_Modelo_de_Datos.md` sección
 * 0): banea el login con la Admin API (igual que `deactivate_user`), marca `is_active = false` en
 * `profiles` y `status = terminated` en `employees`. Mismo criterio que
 * `tests/e2e-employees/helpers/adminEmployeesClient.ts` (`terminateEmployeeDirectly`).
 */
export async function deactivateDisposableEmployee(
  admin: AdminClient,
  profileId: string,
): Promise<void> {
  const { error: banError } = await admin.auth.admin.updateUserById(profileId, {
    ban_duration: '876000h',
  })
  if (banError) {
    throw new Error(
      `No se pudo banear la cuenta descartable ${profileId} en la limpieza: ${banError.message}`,
    )
  }
  await admin
    .from('profiles')
    .update({ is_active: false, deleted_at: new Date().toISOString() })
    .eq('id', profileId)
  await admin
    .from('employees')
    .update({
      status: 'terminated',
      terminated_at: new Date().toISOString().slice(0, 10),
    })
    .eq('profile_id', profileId)
}
