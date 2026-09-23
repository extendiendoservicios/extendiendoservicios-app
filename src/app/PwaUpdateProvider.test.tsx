import { act, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PwaUpdateProvider, usePwaUpdate } from './PwaUpdateProvider'

/**
 * `PwaUpdateProvider` (RESP-009) envuelve `virtual:pwa-register/react`, un
 * módulo virtual que solo existe cuando corre el plugin de `vite-plugin-pwa`
 * (no en `vitest.config.ts`, que no lo agrega a propósito -- ver el
 * comentario de ese archivo). Estos tests mockean ese módulo para probar la
 * lógica propia de este archivo (el intervalo de chequeo, posponer sin
 * perder futuras actualizaciones, y la secuencia de `applyUpdate`), no el
 * registro real de un service worker -- esa prueba de punta a punta está en
 * el reporte del encargo, con `pnpm build` + `pnpm preview` y dos versiones
 * reales.
 */
interface FakeWorker {
  state: string
  addEventListener: ReturnType<typeof vi.fn>
  removeEventListener: ReturnType<typeof vi.fn>
  fireStateChange: (nextState: string) => void
}

function createFakeWorker(initialState: string): FakeWorker {
  const listeners: Array<() => void> = []
  const worker: FakeWorker = {
    state: initialState,
    addEventListener: vi.fn((_event: string, fn: () => void) => {
      listeners.push(fn)
    }),
    removeEventListener: vi.fn((_event: string, fn: () => void) => {
      const index = listeners.indexOf(fn)
      if (index >= 0) listeners.splice(index, 1)
    }),
    fireStateChange(nextState: string) {
      worker.state = nextState
      for (const listener of [...listeners]) listener()
    },
  }
  return worker
}

let registeredOptions:
  | Parameters<typeof import('virtual:pwa-register/react').useRegisterSW>[0]
  | undefined
const setNeedRefreshMock = vi.fn()
const updateServiceWorkerMock = vi.fn(() => Promise.resolve())

vi.mock('virtual:pwa-register/react', () => ({
  useRegisterSW: (options: unknown) => {
    registeredOptions = options as typeof registeredOptions
    return {
      needRefresh: [false, setNeedRefreshMock],
      offlineReady: [false, vi.fn()],
      updateServiceWorker: updateServiceWorkerMock,
    }
  },
}))

function Probe() {
  const { applyUpdate, postpone } = usePwaUpdate()
  return (
    <>
      <button onClick={applyUpdate}>aplicar</button>
      <button onClick={postpone}>posponer</button>
    </>
  )
}

beforeEach(() => {
  registeredOptions = undefined
  vi.stubGlobal('navigator', { ...navigator, onLine: true })
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('PwaUpdateProvider', () => {
  it('registra el service worker una sola vez y chequea cada hora mientras hay una registración', () => {
    vi.useFakeTimers()
    const registration = { waiting: null, update: vi.fn() }

    render(
      <PwaUpdateProvider>
        <Probe />
      </PwaUpdateProvider>,
    )
    act(() => {
      registeredOptions?.onRegisteredSW?.(
        '/sw.js',
        registration as unknown as ServiceWorkerRegistration,
      )
    })

    expect(registration.update).not.toHaveBeenCalled()
    act(() => {
      vi.advanceTimersByTime(60 * 60 * 1000)
    })
    expect(registration.update).toHaveBeenCalledTimes(1)

    act(() => {
      vi.advanceTimersByTime(60 * 60 * 1000)
    })
    expect(registration.update).toHaveBeenCalledTimes(2)
  })

  it('vuelve a chequear apenas la pestaña vuelve a estar visible', () => {
    const registration = { waiting: null, update: vi.fn() }
    render(
      <PwaUpdateProvider>
        <Probe />
      </PwaUpdateProvider>,
    )
    act(() => {
      registeredOptions?.onRegisteredSW?.(
        '/sw.js',
        registration as unknown as ServiceWorkerRegistration,
      )
    })

    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      value: 'visible',
    })
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'))
    })
    expect(registration.update).toHaveBeenCalledTimes(1)
  })

  it('posponer usa el setter del hook: el aviso se puede volver a mostrar si aparece otra actualización', () => {
    render(
      <PwaUpdateProvider>
        <Probe />
      </PwaUpdateProvider>,
    )

    screen.getByRole('button', { name: 'posponer' }).click()
    expect(setNeedRefreshMock).toHaveBeenCalledWith(false)
  })

  it('applyUpdate espera a que el worker en espera quede activado antes de recargar', async () => {
    const waitingWorker = createFakeWorker('installed')
    const registration = { waiting: waitingWorker, update: vi.fn() }
    // jsdom no deja redefinir `window.location.reload` con `spyOn` (la
    // propiedad no es configurable en su implementación): se reemplaza el
    // objeto entero con `stubGlobal`, que `vi.unstubAllGlobals()` (en el
    // `afterEach` de este archivo) deshace solo.
    const reloadSpy = vi.fn()
    vi.stubGlobal('location', { ...window.location, reload: reloadSpy })

    render(
      <PwaUpdateProvider>
        <Probe />
      </PwaUpdateProvider>,
    )
    act(() => {
      registeredOptions?.onRegisteredSW?.(
        '/sw.js',
        registration as unknown as ServiceWorkerRegistration,
      )
    })

    await act(async () => {
      screen.getByRole('button', { name: 'aplicar' }).click()
      // Deja correr el `.then()` de `updateServiceWorker()` antes de seguir.
      await Promise.resolve()
    })

    expect(updateServiceWorkerMock).toHaveBeenCalledTimes(1)
    // El worker en espera todavía no está activado: no se recargó todavía.
    expect(reloadSpy).not.toHaveBeenCalled()

    act(() => {
      waitingWorker.fireStateChange('activated')
    })
    expect(reloadSpy).toHaveBeenCalledTimes(1)
  })

  it('applyUpdate recarga directamente si no hay ningún worker en espera', async () => {
    const registration = { waiting: null, update: vi.fn() }
    const reloadSpy = vi.fn()
    vi.stubGlobal('location', { ...window.location, reload: reloadSpy })

    render(
      <PwaUpdateProvider>
        <Probe />
      </PwaUpdateProvider>,
    )
    act(() => {
      registeredOptions?.onRegisteredSW?.(
        '/sw.js',
        registration as unknown as ServiceWorkerRegistration,
      )
    })

    await act(async () => {
      screen.getByRole('button', { name: 'aplicar' }).click()
      await Promise.resolve()
    })

    expect(reloadSpy).toHaveBeenCalledTimes(1)
  })
})
