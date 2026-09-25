// tests/e2e-assignments/helpers/assignToast.ts — ASSIGN-015 (P11.4)
//
// `assign_employee` puede devolver advertencias (`NOT_ENABLED_FOR_CLIENT`, `OUTSIDE_AVAILABILITY`,
// `ON_LEAVE`, P-034/P-035/P-033) que no bloquean la asignación, pero cambian el toast de éxito
// (`AssignEmployeeSheet.tsx`): "Asignamos al empleado." sin advertencias, "Asignamos igual, con
// advertencias: revisalas abajo." si hay alguna. Los specs de esta suite que NO están probando
// advertencias a propósito (solo quieren que la asignación se haya creado) usan personas reales
// del seed, cuyo estado (licencias, disponibilidad, habilitaciones) puede cambiar con el tiempo
// -- así que aceptan cualquiera de los dos toasts en vez de fallar por una advertencia que no es
// lo que se está probando (encontrado armando esta suite: Carlos Medina y Lucía Torres, ambos
// usados en otros specs, resultaron tener licencias o disponibilidad declarada que dispara
// `ON_LEAVE`/`OUTSIDE_AVAILABILITY` en la fecha usada, ver el reporte del encargo).

import { expect, type Page } from '@playwright/test'

export async function expectAssignSuccessToast(page: Page): Promise<void> {
  await expect(
    page.getByText(/Asignamos al empleado\.|Asignamos igual, con advertencias/),
  ).toBeVisible()
}
