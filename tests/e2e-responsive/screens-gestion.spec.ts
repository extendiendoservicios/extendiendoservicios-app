// tests/e2e-responsive/screens-gestion.spec.ts — RESP-003/RESP-005 (P17.2, F17)
//
// Pantallas de gestión y configuración de administración (ADM-16 a ADM-31) a 390, 768 y 1024 px,
// y las principales también a 1366 y 1440. Ver `helpers/screenSuite.ts`.

import { defineScreenSuite } from './helpers/screenSuite.ts'
import { MANAGEMENT_SCREENS } from './helpers/screens.ts'

defineScreenSuite(
  'screens-gestion',
  'RESP-003: pantallas de gestión y configuración (ADM-16 a ADM-31) a cada ancho',
  MANAGEMENT_SCREENS,
)
