// tests/e2e-responsive/screens-operacion.spec.ts — RESP-003/RESP-005 (P17.2, F17)
//
// Pantallas de operación de administración (ADM-02 a ADM-15) a 390, 768 y 1024 px, y las
// principales también a 1366 y 1440. Ver `helpers/screenSuite.ts`.

import { defineScreenSuite } from './helpers/screenSuite.ts'
import { OPERATION_SCREENS } from './helpers/screens.ts'

defineScreenSuite(
  'screens-operacion',
  'RESP-003: pantallas de operación (ADM-02 a ADM-15) a cada ancho',
  OPERATION_SCREENS,
)
