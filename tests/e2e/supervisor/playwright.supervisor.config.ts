import { defineConfig } from '@playwright/test'
import { configMovil } from '../../fixtures/movil-config.ts'

// TEST-018 (P18.2, F18): suite e2e "supervisor" (SUP-02 a SUP-09) contra App_dev, en móvil.
// Los archivos terminan en `.supervisor.ts`. Detalle de proyectos: `tests/fixtures/movil-config.ts`.
export default defineConfig(configMovil('**/*.supervisor.ts'))
