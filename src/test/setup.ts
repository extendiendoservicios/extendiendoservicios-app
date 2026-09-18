import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/react'
import { afterEach } from 'vitest'

// `test.globals` está apagado (INFRA-004): sin esto, `@testing-library/react`
// no encuentra un `afterEach` global del que colgar su limpieza automática
// entre tests, y el DOM de cada `render()` se acumula dentro del mismo
// archivo (rompe cualquier suite con más de un test que renderice el mismo
// texto o rol). Se detectó al escribir los tests de DS-003/DS-004/DS-007
// (Button, StatusBadge, SegmentedControl, Stepper, WeekdayPicker), que sí
// tienen varios `it()` por archivo.
afterEach(() => {
  cleanup()
})
