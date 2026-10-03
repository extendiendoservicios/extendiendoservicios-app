import { defineConfig } from '@playwright/test'
import { configMovil } from '../../fixtures/movil-config.ts'

// TEST-017 (P18.2, F18): suite e2e "empleado" (EMP-03 a EMP-14) contra App_dev, en móvil.
// Los archivos terminan en `.empleado.ts`: el `testMatch` del config de humo de CI (`*.spec.ts`)
// no los toma. Detalle de proyectos y de por qué corren de a uno: `tests/fixtures/movil-config.ts`.
export default defineConfig(configMovil('**/*.empleado.ts'))
