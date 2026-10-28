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
 * P26.2 (CR-10, CR-11): el bloque "Acceso a la app" -- las tres variantes
 * de `status`, el tapado a los 30 segundos, copiar sin mostrar y los
 * errores. Se mockean los hooks (sin red ni `QueryClientProvider`) y el
 * diálogo de reseteo (que ya tiene su propia cobertura).
 */
const { getCredentialsMock, resetDialogProps } = vi.hoisted(() => ({
  getCredentialsMock: vi.fn(),
  resetDialogProps: { current: null as null | { open: boolean } },
}))

vi.mock('@/features/users/queries', () => ({
  useGetCredentialsMutation: () => ({
    mutateAsync: getCredentialsMock,
    isPending: false,
  }),
  useUpdateEmailMutation: () => ({ mutateAsync: vi.fn(), isPending: false }),
}))

vi.mock('@/features/employees/components/EmployeeAccountDialogs', () => ({
  ResetEmployeePasswordDialog: (props: { open: boolean }) => {
    resetDialogProps.current = props
    return props.open ? <div role="dialog">Resetear contraseña</div> : null
  },
}))

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

async function flush() {
  await act(async () => {
    await Promise.resolve()
  })
}

const writeText = vi.fn()

beforeEach(() => {
  vi.useFakeTimers()
  getCredentialsMock.mockReset()
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
  it('nace tapado y no pide nada al servidor', () => {
    render(<AccessBlock person={person} />)
    expect(screen.getByTestId('access-password')).toHaveTextContent('••••••••')
    expect(getCredentialsMock).not.toHaveBeenCalled()
  })

  it('"Mostrar" pide el acceso, muestra la contraseña y su origen con fecha de Argentina', async () => {
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
    expect(screen.getByText('ana@ejemplo.com')).toBeInTheDocument()
    expect(
      screen.getByText(/Puesta por la administración · 28 oct 2026, 14:05/),
    ).toBeInTheDocument()
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

  it('"Copiar" usuario copia el email', async () => {
    getCredentialsMock.mockResolvedValue(credentials())
    render(<AccessBlock person={person} />)
    fireEvent.click(
      screen.getByRole('button', { name: /copiar usuario de ana gómez/i }),
    )
    await flush()
    expect(writeText).toHaveBeenCalledWith('ana@ejemplo.com')
  })

  it('con status "none" muestra el aviso y "Poner una nueva" abre el diálogo de reseteo', async () => {
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

    expect(
      screen.getByText(
        'No disponible. La cuenta se creó antes de que la app guardara las contraseñas.',
      ),
    ).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Poner una nueva' }))
    expect(resetDialogProps.current?.open).toBe(true)
  })

  it('con status "unreadable" muestra el aviso de copia ilegible', async () => {
    getCredentialsMock.mockResolvedValue(
      credentials({
        status: 'unreadable',
        password: null,
        source: 'created',
        setAt: '2026-10-01T12:00:00Z',
      }),
    )
    render(<AccessBlock person={person} />)
    fireEvent.click(screen.getByRole('button', { name: /mostrar contraseña/i }))
    await flush()

    expect(
      screen.getByText('No disponible. No se pudo leer la copia guardada.'),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Poner una nueva' }),
    ).toBeInTheDocument()
    expect(writeText).not.toHaveBeenCalled()
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
