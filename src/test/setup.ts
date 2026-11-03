import { afterEach } from 'vitest'

// Este setup corre en todos los archivos, también en los de entorno `node`
// (ver `vitest.config.ts`). Lo que depende del DOM se carga solo si hay
// `document`, para no pagar el import de `@testing-library/react` (y de
// `react-dom` con él) en los tests que no lo usan.
const hayDom = typeof document !== 'undefined'

// `ResizeObserver` (EMP-012, P09.2): jsdom no lo implementa, y `cmdk`
// (`Command`, base de `GlobalSearch`) lo usa para medir la lista de
// resultados apenas se monta — sin este polyfill mínimo, cualquier test que
// monte un `Command` (o algo de Radix que también lo use) explota con
// `ReferenceError: ResizeObserver is not defined` antes de llegar a la
// aserción. Polyfill global (no solo del archivo que lo necesitó primero)
// porque es una limitación de jsdom, no de un componente en particular.
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
if (hayDom && typeof globalThis.ResizeObserver === 'undefined') {
  globalThis.ResizeObserver = ResizeObserverStub
}

// `test.globals` está apagado (INFRA-004): sin esto, `@testing-library/react`
// no encuentra un `afterEach` global del que colgar su limpieza automática
// entre tests, y el DOM de cada `render()` se acumula dentro del mismo
// archivo (rompe cualquier suite con más de un test que renderice el mismo
// texto o rol). Se detectó al escribir los tests de DS-003/DS-004/DS-007
// (Button, StatusBadge, SegmentedControl, Stepper, WeekdayPicker), que sí
// tienen varios `it()` por archivo.
if (hayDom) {
  await import('@testing-library/jest-dom/vitest')
  const { cleanup } = await import('@testing-library/react')
  afterEach(() => {
    cleanup()
  })
}
