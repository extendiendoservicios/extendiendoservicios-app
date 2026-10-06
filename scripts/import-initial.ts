// scripts/import-initial.ts — DATA-003, DATA-004 (08_Fases_y_Backlog.md, F19)
//
// Importador de la carga inicial: lee `docs/plantilla-carga-inicial.xlsx` completada por la
// empresa, la valida por completo (informe de errores por hoja, fila y columna) y, solo si no
// hay errores, la carga en el entorno elegido con IMPORT_ENTORNO. Procedimiento completo, en
// `docs/carga-inicial.md`. Ayuda: `pnpm import:initial --ayuda`.
//
//   pnpm import:initial <planilla.xlsx> --dry-run --salida <carpeta>   (solo validar)
//   pnpm import:initial <planilla.xlsx>                                (cargar)
//   pnpm import:initial <planilla.xlsx> --resume                       (reintentar)
//
// Toda la lógica vive en `scripts/import-initial/`; este archivo solo conecta los argumentos y
// el entorno del proceso.

import { ejecutarImportacion } from './import-initial/ejecutar.ts'

ejecutarImportacion(process.argv.slice(2), {
  env: process.env,
  salida: {
    log: (mensaje) => console.log(mensaje),
    error: (mensaje) => console.error(mensaje),
  },
})
  .then((codigo) => {
    process.exitCode = codigo
  })
  .catch((error: unknown) => {
    console.error(
      `El importador se detuvo por un error inesperado: ${error instanceof Error ? error.message : String(error)}`,
    )
    process.exitCode = 3
  })
