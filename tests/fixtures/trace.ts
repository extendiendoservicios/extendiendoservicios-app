// tests/fixtures/trace.ts — TEST-015/TEST-016 (P18.1)
//
// Rastro de cada test contra `09_Trazabilidad.md` (filas RB-xxx) y contra los casos borde de
// `08_Fases_y_Backlog.md` sección 3 (CB-xx). Se usa como segundo argumento de `test(...)`:
//
//   test('título', cubre('RB-A04', 'CB-10'), async ({ page }) => { ... })
//
// Deja el rastro de dos formas: etiquetas (`@RB-A04`, `@CB-10`) para correr por filtro
// (`--grep @CB-10`) y anotaciones que aparecen en el informe HTML.

type Trace = `RB-${string}` | `CB-${string}` | `P-${string}`

export function cubre(...ids: Trace[]): {
  tag: string[]
  annotation: Array<{ type: string; description: string }>
} {
  return {
    tag: ids.map((id) => `@${id}`),
    annotation: ids.map((id) => ({
      type: id.startsWith('CB-') ? 'caso-borde' : 'trazabilidad',
      description: id,
    })),
  }
}
