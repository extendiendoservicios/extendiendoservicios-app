import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import ResetPasswordPage from './ResetPasswordPage'
import { ApiError } from '@/api/errors'
import * as authModule from '@/features/auth/AuthProvider'
import type { AuthContextValue } from '@/features/auth/AuthProvider'

/**
 * COM-03 (AUTH-005/AUTH-006): la señal que distingue "llegué con el enlace
 * del email" de "ya tenía sesión y entré acá por mi cuenta" es
 * `isPasswordRecovery` (`AuthProvider`, ver su comentario) — estos tests
 * cubren las cuatro ramas de esa distinción, no el mecanismo de
 * `detectSessionInUrl` en sí (eso está comprobado contra `App_dev`, no es
 * algo que un test unitario sin red pueda reproducir — ver el reporte del
 * encargo).
 */
interface UpdateUserResult {
  data: { user: unknown } | null
  error: { code: string; message: string; status: number; name: string } | null
}
// `vi.hoisted`: ver el comentario largo de `LoginPage.test.tsx` — sin esto,
// referenciar `updateUserMock` directo dentro de la factory explota con la
// suite completa (`pnpm test`), aunque el archivo solo pase.
const { updateUserMock, changeOwnPasswordMock } = vi.hoisted(() => ({
  changeOwnPasswordMock:
    vi.fn<(newPassword: string, origin: string) => Promise<void>>(),
  updateUserMock:
    vi.fn<(attributes: { password: string }) => Promise<UpdateUserResult>>(),
}))
vi.mock('@/api/ownPassword', () => ({
  changeOwnPassword: changeOwnPasswordMock,
}))
vi.mock('@/lib/supabase', () => ({
  supabase: { auth: { updateUser: updateUserMock } },
}))

function authValue(overrides: Partial<AuthContextValue>): AuthContextValue {
  return {
    status: 'unauthenticated',
    userId: null,
    email: null,
    roles: [],
    capabilities: [],
    profile: null,
    displayName: 'Cuenta',
    isPasswordRecovery: false,
    signOut: vi.fn(),
    refreshProfile: vi.fn(),
    ...overrides,
  }
}

function mockViewportWidth(widthPx: number) {
  window.matchMedia = vi.fn().mockImplementation((query: string) => {
    const minWidthMatch = /min-width:\s*(\d+)px/.exec(query)
    const minWidth = minWidthMatch?.[1] ? Number(minWidthMatch[1]) : 0
    return {
      matches: widthPx >= minWidth,
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }
  })
}

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/restablecer']}>
      <Routes>
        <Route path="/restablecer" element={<ResetPasswordPage />} />
        <Route path="/recuperar" element={<p>Recuperar contraseña</p>} />
        <Route path="/perfil" element={<p>Mi perfil</p>} />
        <Route path="/app" element={<p>Hoy del empleado</p>} />
      </Routes>
    </MemoryRouter>,
  )
}

beforeEach(() => {
  updateUserMock.mockReset()
  changeOwnPasswordMock.mockReset()
  mockViewportWidth(1440)
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('ResetPasswordPage (COM-03)', () => {
  it('sin sesión (enlace vencido o ya usado) avisa y ofrece pedir uno nuevo', () => {
    vi.spyOn(authModule, 'useAuth').mockReturnValue(
      authValue({ status: 'unauthenticated' }),
    )

    renderPage()

    expect(
      screen.getByRole('heading', { name: 'El enlace no es válido' }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('link', { name: 'Pedir un enlace nuevo' }),
    ).toHaveAttribute('href', '/recuperar')
  })

  it('con sesión propia (no vino del enlace) manda a /perfil, no deja cambiar la contraseña acá', () => {
    vi.spyOn(authModule, 'useAuth').mockReturnValue(
      authValue({
        status: 'authenticated',
        roles: ['employee'],
        isPasswordRecovery: false,
      }),
    )

    renderPage()

    expect(screen.getByText('Mi perfil')).toBeInTheDocument()
  })

  it('con el enlace de recuperación, muestra el formulario de contraseña nueva', () => {
    vi.spyOn(authModule, 'useAuth').mockReturnValue(
      authValue({
        status: 'authenticated',
        roles: ['employee'],
        isPasswordRecovery: true,
      }),
    )

    renderPage()

    expect(
      screen.getByRole('heading', { name: 'Elegí una contraseña nueva' }),
    ).toBeInTheDocument()
  })

  it('avisa si las dos contraseñas no coinciden, sin llamar a la función', async () => {
    vi.spyOn(authModule, 'useAuth').mockReturnValue(
      authValue({
        status: 'authenticated',
        roles: ['employee'],
        isPasswordRecovery: true,
      }),
    )

    renderPage()
    fireEvent.change(screen.getByLabelText('Contraseña nueva'), {
      target: { value: 'contraseña-larga-1' },
    })
    fireEvent.change(screen.getByLabelText('Confirmar contraseña'), {
      target: { value: 'otra-distinta-2' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Guardar contraseña' }))

    expect(
      await screen.findByText('Las contraseñas no coinciden.'),
    ).toBeInTheDocument()
    expect(changeOwnPasswordMock).not.toHaveBeenCalled()
  })

  it('al guardar, llama change_own_password (recovery), cierra la recuperación y navega a la vía del rol', async () => {
    const finishPasswordRecovery = vi.fn()
    vi.spyOn(authModule, 'useAuth').mockReturnValue(
      authValue({
        status: 'authenticated',
        roles: ['employee'],
        isPasswordRecovery: true,
        finishPasswordRecovery,
      }),
    )
    changeOwnPasswordMock.mockResolvedValue(undefined)

    renderPage()
    fireEvent.change(screen.getByLabelText('Contraseña nueva'), {
      target: { value: 'contraseña-larga-1' },
    })
    fireEvent.change(screen.getByLabelText('Confirmar contraseña'), {
      target: { value: 'contraseña-larga-1' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Guardar contraseña' }))

    expect(await screen.findByText('Hoy del empleado')).toBeInTheDocument()
    expect(changeOwnPasswordMock).toHaveBeenCalledWith(
      'contraseña-larga-1',
      'recovery',
    )
    expect(finishPasswordRecovery).toHaveBeenCalledTimes(1)
    expect(updateUserMock).not.toHaveBeenCalled()
  })

  it('si la función falla, muestra el error y se queda en el formulario (CR-13)', async () => {
    const finishPasswordRecovery = vi.fn()
    vi.spyOn(authModule, 'useAuth').mockReturnValue(
      authValue({
        status: 'authenticated',
        roles: ['employee'],
        isPasswordRecovery: true,
        finishPasswordRecovery,
      }),
    )
    changeOwnPasswordMock.mockRejectedValue(
      new ApiError('Por el momento no se puede cambiar la contraseña.'),
    )

    renderPage()
    fireEvent.change(screen.getByLabelText('Contraseña nueva'), {
      target: { value: 'contraseña-larga-1' },
    })
    fireEvent.change(screen.getByLabelText('Confirmar contraseña'), {
      target: { value: 'contraseña-larga-1' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Guardar contraseña' }))

    expect(
      await screen.findByText(
        'Por el momento no se puede cambiar la contraseña.',
      ),
    ).toBeInTheDocument()
    expect(finishPasswordRecovery).not.toHaveBeenCalled()
    expect(screen.queryByText('Hoy del empleado')).toBeNull()
  })

  it('muestra el aviso de que la administración puede ver la contraseña (CR-12)', () => {
    vi.spyOn(authModule, 'useAuth').mockReturnValue(
      authValue({
        status: 'authenticated',
        roles: ['employee'],
        isPasswordRecovery: true,
      }),
    )

    renderPage()

    expect(
      screen.getByText(
        'La administración de la empresa puede ver tu contraseña. No uses una que tengas en otros servicios.',
      ),
    ).toBeInTheDocument()
  })
})
