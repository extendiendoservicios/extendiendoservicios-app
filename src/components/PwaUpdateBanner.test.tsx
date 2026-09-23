import { render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { PwaUpdateContextValue } from '@/app/PwaUpdateProvider'
import { PwaUpdateBanner } from './PwaUpdateBanner'

// `PwaUpdateBanner` solo consume `usePwaUpdate()` (RESP-009): estos tests
// prueban el componente de presentación, no el registro real del service
// worker (eso no se puede probar con un test unitario -- ver el reporte del
// encargo para la prueba de punta a punta con `pnpm build` + `pnpm preview`
// y dos versiones reales).
const usePwaUpdateMock = vi.fn<() => PwaUpdateContextValue>()
vi.mock('@/app/PwaUpdateProvider', () => ({
  usePwaUpdate: () => usePwaUpdateMock(),
}))

afterEach(() => {
  vi.restoreAllMocks()
})

describe('PwaUpdateBanner', () => {
  it('sin actualización pendiente, no renderiza nada', () => {
    usePwaUpdateMock.mockReturnValue({
      needRefresh: false,
      applying: false,
      applyUpdate: vi.fn(),
      postpone: vi.fn(),
    })
    const { container } = render(<PwaUpdateBanner />)
    expect(container).toBeEmptyDOMElement()
  })

  it('con una actualización pendiente, muestra el aviso sin interrumpir (role="status", no "alert")', () => {
    usePwaUpdateMock.mockReturnValue({
      needRefresh: true,
      applying: false,
      applyUpdate: vi.fn(),
      postpone: vi.fn(),
    })
    render(<PwaUpdateBanner />)

    expect(
      screen.getByText('Hay una versión nueva de la aplicación'),
    ).toBeInTheDocument()
    expect(screen.getByRole('status')).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('"Actualizar ahora" llama a applyUpdate', () => {
    const applyUpdate = vi.fn()
    usePwaUpdateMock.mockReturnValue({
      needRefresh: true,
      applying: false,
      applyUpdate,
      postpone: vi.fn(),
    })
    render(<PwaUpdateBanner />)

    screen.getByRole('button', { name: 'Actualizar ahora' }).click()
    expect(applyUpdate).toHaveBeenCalledTimes(1)
  })

  it('"Más tarde" llama a postpone y no a applyUpdate', () => {
    const applyUpdate = vi.fn()
    const postpone = vi.fn()
    usePwaUpdateMock.mockReturnValue({
      needRefresh: true,
      applying: false,
      applyUpdate,
      postpone,
    })
    render(<PwaUpdateBanner />)

    screen.getByRole('button', { name: 'Más tarde' }).click()
    expect(postpone).toHaveBeenCalledTimes(1)
    expect(applyUpdate).not.toHaveBeenCalled()
  })

  it('mientras se aplica, los dos botones quedan deshabilitados', () => {
    usePwaUpdateMock.mockReturnValue({
      needRefresh: true,
      applying: true,
      applyUpdate: vi.fn(),
      postpone: vi.fn(),
    })
    render(<PwaUpdateBanner />)

    expect(
      screen.getByRole('button', { name: /Actualizar ahora/ }),
    ).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Más tarde' })).toBeDisabled()
  })
})
