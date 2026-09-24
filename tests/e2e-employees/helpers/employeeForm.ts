// tests/e2e-employees/helpers/employeeForm.ts — EMP-014/TEST-006 (P09.5)
//
// Completa el alta de ADM-18 (`/admin/empleados/nuevo`) por interfaz: los campos obligatorios
// (nombre, apellido, DNI, email de login, contraseña) más los roles a marcar. El legajo queda el
// sugerido (no se toca): `EmployeeFormPage.tsx` lo completa solo mientras el campo no se haya
// tocado a mano.

import { expect, type Page } from '@playwright/test'

export interface EmployeeCreateFormInput {
  firstName: string
  lastName: string
  dni: string
  email: string
  password: string
  isEmployeeRole: boolean
  isSupervisorRole: boolean
}

/**
 * Va a `/admin/empleados/nuevo`, completa el formulario y confirma. Devuelve una vez que el
 * toast de éxito aparece (`Creamos a ${firstName} ${lastName} con el legajo…`) — quien llama
 * resuelve el `profileId` después, con la clave de servicio (por email, mismo patrón que
 * `tests/e2e-users/`).
 */
export async function createEmployeeViaForm(
  page: Page,
  input: EmployeeCreateFormInput,
): Promise<void> {
  await page.goto('/admin/empleados/nuevo')

  // "Empleado" está tildado por omisión (`defaultValues.isEmployeeRole: true`): se ajusta a lo
  // pedido en vez de asumir el estado inicial, así el helper sirve para cualquier combinación.
  const employeeCheckbox = page.getByRole('checkbox', { name: 'Empleado' })
  const supervisorCheckbox = page.getByRole('checkbox', { name: 'Supervisor' })
  if ((await employeeCheckbox.isChecked()) !== input.isEmployeeRole) {
    await employeeCheckbox.click()
  }
  if ((await supervisorCheckbox.isChecked()) !== input.isSupervisorRole) {
    await supervisorCheckbox.click()
  }

  await page.getByLabel('Email de login').fill(input.email)
  await page.getByLabel('Contraseña inicial').fill(input.password)
  await page.getByLabel('Nombre').fill(input.firstName)
  await page.getByLabel('Apellido').fill(input.lastName)
  await page.getByLabel('DNI').fill(input.dni)

  await page.getByRole('button', { name: 'Crear' }).click()
  await expect(
    page.getByText(
      `Creamos a ${input.firstName} ${input.lastName} con el legajo`,
      { exact: false },
    ),
  ).toBeVisible()
  // La creación navega a la ficha (`/admin/empleados/:id`): esperarla evita que un test
  // siguiente arranque todavía en el formulario.
  await expect(page).toHaveURL(/\/admin\/empleados\/[^/]+$/)
}
