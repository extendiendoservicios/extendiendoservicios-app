// scripts/entregar-credenciales.ts — DATA-008 (08_Fases_y_Backlog.md, F19)
//
// Genera la contraseña inicial de las cuentas que cargó el importador y todavía no entraron, y
// las guarda en un CSV fuera del repositorio para entregarlas por canal individual. Procedimiento
// completo en `docs/carga-inicial.md` (sección "Entrega de contraseñas"). Ayuda:
// `pnpm credenciales:inicial --ayuda`.
//
//   pnpm credenciales:inicial --emails <lista.txt> --salida <carpeta> --dry-run
//   pnpm credenciales:inicial --emails <lista.txt> --salida <carpeta>
//
// Toda la lógica vive en `scripts/entregar-credenciales/`; este archivo solo conecta los
// argumentos y el entorno del proceso.

import { ejecutarEntregaDeCredenciales } from './entregar-credenciales/ejecutar.ts'

ejecutarEntregaDeCredenciales(process.argv.slice(2), {
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
      `El script se detuvo por un error inesperado: ${error instanceof Error ? error.message : String(error)}`,
    )
    process.exitCode = 3
  })
