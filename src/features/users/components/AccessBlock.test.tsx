import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '@/api/errors'
import type { Credentials } from '@/api/credentials'
import {
  AccessBlock,
  PASSWORD_VISIBLE_MS,
  formatCredentialDate,
} from './AccessBlock'

/**
 * P26.2 / P26.2b (CR-10, CR-11): las filas de "Acceso a la app" -- el usuario
 * visible al montar desde `get_access_status` (sin llamar a
 * `get_credentials`), las tres variantes de `status`, el tapado a los 30
 * segundos, copiar sin mostrar y los errores. Se mockean los hooks (sin red
 * ni `QueryClientProvider`) y el diálogo de cambio de contraseña (que ya
 * tiene su propia cobertura).
 */
const { getCredentialsMock, accessState, invalidateMock, resetDialogProps } =
  vi.hoisted(() => ({
    getCredentialsMock: vi.fn(),
    invalidateMock: vi.fn(),
    accessState: { current: null as Record<string, unknown> | null },
    resetDialogProps: { current: null as null | { open: boolean } },
  }))

vi.mock('@/features/users/queries', () => ({
  useGetCredentialsMutation: () => ({
    mutateAsync: getCredentialsMock,
    isPending: false,
  }),
  useAccessStatusQuery: () => accessState.current,
  useInvalidateAccessStatus: () => invalidateMock,
  useUpdateEmailMutation: () => ({ mutateAsync: vi.fn(), isPending: false }),
}))

vi.mock('@/features/employees/components/EmployeeAccountDialogs', () => ({
  ResetEmployeePasswordDialog: (props: { open: boolean }) => {
    resetDialogProps.current = props
    return props.open ? <div role="dialog">Cambiar contraseña</div> : null
  },
}))

import type { AccessStatus } from '@/api/credentials'

const person = { profileId: 'p1', firstName: 'Ana', lastName: 'Gómez' }

function credentials(over: Partial<Credentials> = {}): Credentials {
  return {
    email: 'ana@ejemplo.com',
    password: 'Secreta-123',
    source: 'admin_reset',
    setAt: '2026-10-28T17:05:00Z',
    status: 'ok',
    ...over,
  }
}

function accessStatus(over: Partial<AccessStatus> = {}): AccessStatus {
  return {
    email: 'ana@ejemplo.com',
    hasCopy: true,
    readable: true,
    status: 'ok',
    source: 'admin_reset',
    setAt: '2026-10-28T17:05:00Z',
    ...over,
  }
}

function setAccess(data: AccessStatus | undefined, isError = false) {
  accessState.current = { data, isError, error: null }
}

async function flush() {
  await act(async () => {
    await Promise.resolve()
  })
}

const writeText = vi.fn()

beforeEach(() => {
  vi.useFakeTimers()
  getCredentialsMock.mockReset()
  invalidateMock.mockReset()
  setAccess(accessStatus())
  writeText.mockReset()
  writeText.mockResolvedValue(undefined)
  Object.defineProperty(navigator, 'clipboard', {
    value: { writeText },
    configurable: true,
  })
})

afterEach(() => {
  vi.useRealTimers()
})

describe('AccessBlock', () => {
  it('al montar muestra el usuario, el origen y la fecha, la contraseña tapada y no llama a get_credentials', () => {
    render(<AccessBlock person={person} />)
    expect(screen.getByTestId('access-email')).toHaveTextContent(
      'ana@ejemplo.com',
    )
    expect(screen.getByTestId('access-password')).toHaveTextContent('••••••••')
    expect(
      screen.getByText(/Puesta por la administración · 28 oct 2026, 14:05/),
    ).toBeInTheDocument()
    expect(getCredentialsMock).not.toHaveBeenCalled()
  })

  it('mientras carga el estado no muestra datos ni botones de contraseña de más', () => {
    setAccess(undefined)
    render(<AccessBlock person={person} />)
    expect(screen.getByTestId('access-email')).toHaveTextContent('Cargando…')
    expect(
      screen.getByRole('button', { name: /copiar usuario/i }),
    ).toBeDisabled()
  })

  it('"Copiar" usuario copia el email sin llamar a get_credentials', async () => {
    render(<AccessBlock person={person} />)
    fireEvent.click(
      screen.getByRole('button', { name: /copiar usuario de ana gómez/i }),
    )
    await flush()
    expect(writeText).toHaveBeenCalledWith('ana@ejemplo.com')
    expect(getCredentialsMock).not.toHaveBeenCalled()
  })

  it('sin showChangePassword no hay "Cambiar" de la contraseña, pero sí el del usuario', () => {
    render(<AccessBlock person={person} showChangePassword={false} />)
    expect(
      screen.queryByRole('button', { name: /cambiar contraseña de/i }),
    ).not.toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: /cambiar usuario de/i }),
    ).toBeInTheDocument()
  })

  it('"Mostrar" llama a get_credentials y muestra la contraseña en fuente monoespaciada', async () => {
    getCredentialsMock.mockResolvedValue(credentials())
    render(<AccessBlock person={person} />)

    fireEvent.click(
      screen.getByRole('button', { name: /mostrar contraseña de ana gómez/i }),
    )
    await flush()

    expect(getCredentialsMock).toHaveBeenCalledWith('p1')
    expect(screen.getByTestId('access-password')).toHaveTextContent(
      'Secreta-123',
    )
    expect(screen.getByTestId('access-password')).toHaveClass('font-mono')
  })

  it('vuelve a tapar la contraseña a los 30 segundos', async () => {
    getCredentialsMock.mockResolvedValue(credentials())
    render(<AccessBlock person={person} />)
    fireEvent.click(screen.getByRole('button', { name: /mostrar contraseña/i }))
    await flush()
    expect(screen.getByTestId('access-password')).toHaveTextContent(
      'Secreta-123',
    )

    act(() => {
      vi.advanceTimersByTime(PASSWORD_VISIBLE_MS - 1)
    })
    expect(screen.getByTestId('access-password')).toHaveTextContent(
      'Secreta-123',
    )

    act(() => {
      vi.advanceTimersByTime(1)
    })
    expect(screen.getByTestId('access-password')).toHaveTextContent('••••••••')
    expect(screen.queryByText('Secreta-123')).not.toBeInTheDocument()
  })

  it('"Ocultar" tapa la contraseña enseguida', async () => {
    getCredentialsMock.mockResolvedValue(credentials())
    render(<AccessBlock person={person} />)
    fireEvent.click(screen.getByRole('button', { name: /mostrar contraseña/i }))
    await flush()
    fireEvent.click(screen.getByRole('button', { name: /ocultar contraseña/i }))
    expect(screen.queryByText('Secreta-123')).not.toBeInTheDocument()
  })

  it('"Copiar" copia la contraseña sin mostrarla y avisa en una región aria-live', async () => {
    getCredentialsMock.mockResolvedValue(credentials())
    render(<AccessBlock person={person} />)

    fireEvent.click(
      screen.getByRole('button', { name: /copiar contraseña de ana gómez/i }),
    )
    await flush()

    expect(writeText).toHaveBeenCalledWith('Secreta-123')
    expect(screen.getByTestId('access-password')).toHaveTextContent('••••••••')
    expect(screen.getByRole('status')).toHaveTextContent('Contraseña copiado.')
    expect(screen.getByRole('status')).toHaveAttribute('aria-live', 'polite')
  })

  it('con status "none" muestra "No disponible" con su ayuda y "Poner una nueva" abre el diálogo; sin Mostrar ni Copiar', () => {
    setAccess(
      accessStatus({
        status: 'none',
        hasCopy: false,
        readable: false,
        source: null,
        setAt: null,
      }),
    )
    render(<AccessBlock person={person} />)

    expect(screen.getByText('No disponible')).toBeInTheDocument()
    expect(
      screen.getByText(
        'La cuenta se creó antes de que la app guardara las contraseñas.',
      ),
    ).toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: /mostrar contraseña/i }),
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: /copiar contraseña/i }),
    ).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Poner una nueva' }))
    expect(resetDialogProps.current?.open).toBe(true)
  })

  it('con status "unreadable" muestra "No disponible" con la ayuda de copia ilegible y el mismo botón', () => {
    setAccess(
      accessStatus({
        status: 'unreadable',
        readable: false,
        source: 'created',
        setAt: '2026-10-01T12:00:00Z',
      }),
    )
    render(<AccessBlock person={person} />)

    expect(screen.getByText('No disponible')).toBeInTheDocument()
    expect(
      screen.getByText('No se pudo leer la copia guardada.'),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Poner una nueva' }),
    ).toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: /mostrar contraseña/i }),
    ).not.toBeInTheDocument()
    expect(getCredentialsMock).not.toHaveBeenCalled()
  })

  it('si get_credentials contradice el estado, refresca get_access_status', async () => {
    getCredentialsMock.mockResolvedValue(
      credentials({
        status: 'none',
        password: null,
        source: null,
        setAt: null,
      }),
    )
    render(<AccessBlock person={person} />)
    fireEvent.click(screen.getByRole('button', { name: /mostrar contraseña/i }))
    await flush()
    expect(invalidateMock).toHaveBeenCalled()
    expect(screen.getByTestId('access-password')).toHaveTextContent('••••••••')
  })

  it('con CREDENTIALS_NOT_CONFIGURED muestra el mensaje del servidor sin romper el bloque', async () => {
    getCredentialsMock.mockRejectedValue(
      new ApiError(
        'Falta configurar la clave de credenciales.',
        'CREDENTIALS_NOT_CONFIGURED',
      ),
    )
    render(<AccessBlock person={person} />)
    fireEvent.click(screen.getByRole('button', { name: /mostrar contraseña/i }))
    await flush()

    expect(screen.getByRole('alert')).toHaveTextContent(
      'Falta configurar la clave de credenciales.',
    )
    expect(screen.getByTestId('access-password')).toHaveTextContent('••••••••')
    expect(
      screen.getByRole('button', { name: /cambiar contraseña/i }),
    ).toBeInTheDocument()
  })

  it('al cambiar de persona se borra la contraseña de la anterior', async () => {
    getCredentialsMock.mockResolvedValue(credentials())
    const { rerender } = render(<AccessBlock key="p1" person={person} />)
    fireEvent.click(screen.getByRole('button', { name: /mostrar contraseña/i }))
    await flush()

    rerender(
      <AccessBlock
        key="p2"
        person={{ profileId: 'p2', firstName: 'Luis', lastName: 'Paz' }}
      />,
    )
    expect(screen.queryByText('Secreta-123')).not.toBeInTheDocument()
    expect(screen.getByTestId('access-password')).toHaveTextContent('••••••••')
  })
})

describe('formatCredentialDate', () => {
  it('usa la hora de Argentina', () => {
    expect(formatCredentialDate('2026-10-28T02:30:00Z')).toBe(
      '27 oct 2026, 23:30',
    )
  })
})
