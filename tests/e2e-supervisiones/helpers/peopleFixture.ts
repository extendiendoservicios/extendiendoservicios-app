// tests/e2e-supervisiones/helpers/peopleFixture.ts — SUP-013/MOB-SUP-013/TEST-013 (P15.6)
//
// Cuentas descartables propias de esta suite (en vez de usar las del seed, `paula.lemos`,
// `maria.gomez` y compañía): el turno completo de punta a punta escribe estado real (asignación,
// supervisión, registro de asistencia, calificación) y el encargo pide datos propios de la
// suite, con el prefijo `E2E-P156`, sin tocar los turnos reales del seed. Mismo patrón que
// `tests/e2e-employee-shift/helpers/employeeFixture.ts`, sumándole el alta de una persona con rol
// `supervisor` (no hace falta probar el alta real por la Edge Function `admin-users`: eso ya lo
// cubre `tests/e2e-users/`).

import type { AdminClient } from './adminClient.ts'

export const PEOPLE_FIXTURE_PREFIX = 'E2E-P156'

export interface DisposablePerson {
  profileId: string
  email: string
  password: string
  firstName: string
  lastName: string
}

/** Email descartable único por corrida, en un dominio que no es el de la empresa real. */
function disposableEmail(slug: string): string {
  return `e2e-p156-${slug}-${Date.now()}@example.com`
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
 * Crea una cuenta completa con el rol dado (`employee` o `supervisor`): Auth (ya confirmada),
 * `profiles` (la crea sola el trigger `app.handle_new_user()` a partir de `user_metadata`),
 * `user_roles` y `employees` -- hace falta la fila de `employees` para los dos roles: la vista
 * `v_employees` que arma el selector de "Supervisor" de ADM-14
 * (`fetchSupervisorCandidates`, `src/api/supervisions.ts`) exige `status = 'active'` en
 * `employees` además del rol `supervisor` en `user_roles`.
 */
export async function createDisposablePerson(
  admin: AdminClient,
  slug: string,
  role: 'employee' | 'supervisor',
  seedPassword: string,
): Promise<DisposablePerson> {
  const email = disposableEmail(slug)
  const password = `${seedPassword}-${slug}`
  const firstName = 'E2E'
  const lastName = `${role === 'supervisor' ? 'Supervisor' : 'Empleado'} ${slug} ${Date.now()}`

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
    .insert({ profile_id: profileId, role })
  if (roleError) {
    throw new Error(
      `No se pudo dar el rol ${role} a ${email}: ${roleError.message}`,
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
 * 0): banea el login con la Admin API, marca `is_active = false` en `profiles` y
 * `status = terminated` en `employees`. Mismo criterio que
 * `tests/e2e-employee-shift/helpers/employeeFixture.ts` (`deactivateDisposableEmployee`), sirve
 * para los dos roles.
 */
export async function deactivateDisposablePerson(
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
