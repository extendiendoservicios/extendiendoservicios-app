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
 * Va a `/admin/empleados/nuevo`, completa el formulario y confirma. Devuelve una vez que la
 * página redirige a la ficha de la persona recién creada (`/admin/empleados/:id`) — esa
 * redirección es la señal de éxito definitiva (`EmployeeCreateForm.onSubmit`, `navigate()`
 * corre recién después de que la mutación resuelve bien), y a diferencia del toast de éxito
 * ("Creamos a…") no depende de ganarle una carrera a los 4 s que dura visible por omisión
 * (`sonner`): esperar el toast en vez de la URL hacía que este helper fallara de forma
 * intermitente cuando la corrida tardaba un poco más de lo habitual en llegar hasta acá
 * (encontrado corriendo esta suite tres veces seguidas contra `App_dev`, ver el reporte del
 * encargo P09.5 y la regla TEST-029). Quien llama resuelve el `profileId` después, con la clave
 * de servicio (por email, mismo patrón que `tests/e2e-users/`).
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
  // Por `id` (no `getByLabel('Nombre')`): la sección "Contacto de emergencia" del mismo
  // formulario también tiene un campo con la etiqueta exacta "Nombre"
  // (`emergencyContactName`), así que ese selector matchea dos elementos (encontrado corriendo
  // esta suite contra `App_dev`, ver el reporte del encargo P09.5). "Apellido" y "DNI" no se
  // repiten en esa sección, pero se usa el mismo criterio por `id` para las tres, así el helper
  // no vuelve a romperse si esa sección de emergencia sumara un campo "Apellido" a futuro.
  await page.locator('#employee-first-name').fill(input.firstName)
  await page.locator('#employee-last-name').fill(input.lastName)
  await page.locator('#employee-dni').fill(input.dni)

  await page.getByRole('button', { name: 'Crear' }).click()
  // Dos ajustes encontrados corriendo esta suite varias veces seguidas contra `App_dev` (ver el
  // reporte del encargo P09.5):
  // 1. El patrón excluye `nuevo` a propósito: `/\/admin\/empleados\/[^/]+$/` sin esa exclusión
  //    también matchea la URL DEL FORMULARIO (`/admin/empleados/nuevo`), así que la espera podía
  //    darse por cumplida sin que la persona se haya creado todavía.
  // 2. `timeout: 20_000` (el doble del que trae por omisión el config, 60 s de test completo
  //    dividido entre varios pasos): la Edge Function `create_user` a veces tarda más de 5 s en
  //    responder (arranque en frío), y el botón "Crear" se queda en "Cargando" mientras tanto —
  //    la espera por omisión de `expect` cortaba antes de que la mutación terminara.
  await expect(page).toHaveURL(/\/admin\/empleados\/(?!nuevo)[^/]+$/, {
    timeout: 20_000,
  })
  await expect(
    page.getByRole('heading', { name: `${input.firstName} ${input.lastName}` }),
  ).toBeVisible()
}
