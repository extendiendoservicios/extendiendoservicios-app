import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import ProfilePage from './ProfilePage'
import * as authModule from '@/features/auth/AuthProvider'
import type { AuthContextValue } from '@/features/auth/AuthProvider'

/**
 * COM-04 (AUTH-007): nombre y email de login de solo lectura, contacto y
 * contraseña editables, roles, consentimiento de ubicación. Sin red — se
 * mockea `@/lib/supabase` (dos tablas: `profiles` para guardar, y
 * `company_settings` para el texto legal de P-108) y `useAuth()` por test.
 */
interface UpdateUserResult {
  data: { user: unknown } | null
  error: { code: string; message: string; status: number; name: string } | null
}
interface ProfilesUpdatePayload {
  contact_email?: string | null
  phone?: string | null
  location_consent_at?: string | null
}
type ProfilesUpdateResult = { data: null; error: null }

// `vi.hoisted`: ver el comentario largo de `LoginPage.test.tsx` — sin esto,
// referenciar estos mocks (y el estado mutable de `company_settings`)
// directo dentro de la factory explota con la suite completa (`pnpm
// test`), aunque el archivo solo pase. `companySettings` va envuelto en un
// objeto (no un `let` suelto) para poder reasignar `.result` desde
// `beforeEach`/los tests sin volver a declarar la variable que ya capturó
// la factory.
const { updateUserMock, profilesUpdateMock, companySettings } = vi.hoisted(
  () => ({
    updateUserMock:
      vi.fn<(attributes: { password: string }) => Promise<UpdateUserResult>>(),
    profilesUpdateMock:
      vi.fn<
        (
          values: ProfilesUpdatePayload,
          column: string,
          value: unknown,
        ) => Promise<ProfilesUpdateResult>
      >(),
    companySettings: {
      result: {
        data: {
          location_consent_text: 'Texto legal de prueba de consentimiento.',
        },
        error: null,
      },
    },
  }),
)

vi.mock('@/lib/supabase', () => ({
  supabase: {
    auth: { updateUser: updateUserMock },
    from: (table: string) => {
      if (table === 'company_settings') {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: () => Promise.resolve(companySettings.result),
            }),
          }),
        }
      }
      if (table === 'profiles') {
        return {
          update: (values: ProfilesUpdatePayload) => ({
            eq: (column: string, value: unknown) =>
              profilesUpdateMock(values, column, value),
          }),
        }
      }
      throw new Error(`tabla no mockeada en el test: ${table}`)
    },
  },
}))

function authValue(overrides: Partial<AuthContextValue>): AuthContextValue {
  return {
    status: 'authenticated',
    userId: 'user-1',
    email: 'carlos.medina@extendiendoservicios.com',
    roles: ['employee'],
    capabilities: [],
    profile: {
      id: 'user-1',
      firstName: 'Carlos',
      lastName: 'Medina',
      displayName: 'Carlos Medina',
      contactEmail: null,
      phone: null,
      avatarPath: null,
      locationConsentAt: null,
    },
    displayName: 'Carlos Medina',
    isPasswordRecovery: false,
    signOut: vi.fn(),
    refreshProfile: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  }
}

beforeEach(() => {
  updateUserMock.mockReset()
  profilesUpdateMock.mockReset().mockResolvedValue({ data: null, error: null })
  companySettings.result = {
    data: { location_consent_text: 'Texto legal de prueba de consentimiento.' },
    error: null,
  }
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('ProfilePage (COM-04)', () => {
  it('muestra el nombre y el email de login de solo lectura, y los roles', () => {
    vi.spyOn(authModule, 'useAuth').mockReturnValue(
      authValue({ roles: ['employee', 'supervisor'] }),
    )

    render(<ProfilePage />)

    expect(screen.getByLabelText('Nombre')).toHaveValue('Carlos Medina')
    expect(screen.getByLabelText('Nombre')).toBeDisabled()
    expect(screen.getByLabelText('Email de login')).toHaveValue(
      'carlos.medina@extendiendoservicios.com',
    )
    expect(screen.getByLabelText('Email de login')).toBeDisabled()
    expect(screen.getByText('Empleado')).toBeInTheDocument()
    expect(screen.getByText('Supervisor')).toBeInTheDocument()
  })

  it('guarda el email de contacto y el teléfono, y refresca el perfil', async () => {
    const refreshProfile = vi.fn().mockResolvedValue(undefined)
    vi.spyOn(authModule, 'useAuth').mockReturnValue(
      authValue({ refreshProfile }),
    )

    render(<ProfilePage />)
    fireEvent.change(screen.getByLabelText('Email de contacto'), {
      target: { value: 'carlos.medina.contacto@gmail.com' },
    })
    fireEvent.change(screen.getByLabelText('Teléfono'), {
      target: { value: '11 5555-1234' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Guardar contacto' }))

    expect(
      await screen.findByText('Guardamos los cambios.'),
    ).toBeInTheDocument()
    expect(profilesUpdateMock).toHaveBeenCalledWith(
      {
        contact_email: 'carlos.medina.contacto@gmail.com',
        phone: '11 5555-1234',
      },
      'id',
      'user-1',
    )
    expect(refreshProfile).toHaveBeenCalledTimes(1)
  })

  it('avisa si las contraseñas nuevas no coinciden, sin llamar a updateUser', async () => {
    vi.spyOn(authModule, 'useAuth').mockReturnValue(authValue({}))

    render(<ProfilePage />)
    fireEvent.change(screen.getByLabelText('Contraseña nueva'), {
      target: { value: 'contraseña-larga-1' },
    })
    fireEvent.change(screen.getByLabelText('Confirmar contraseña'), {
      target: { value: 'otra-distinta-2' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Cambiar contraseña' }))

    expect(
      await screen.findByText('Las contraseñas no coinciden.'),
    ).toBeInTheDocument()
    expect(updateUserMock).not.toHaveBeenCalled()
  })

  it('cambia la contraseña con auth.updateUser', async () => {
    updateUserMock.mockResolvedValue({ data: { user: {} }, error: null })
    vi.spyOn(authModule, 'useAuth').mockReturnValue(authValue({}))

    render(<ProfilePage />)
    fireEvent.change(screen.getByLabelText('Contraseña nueva'), {
      target: { value: 'contraseña-larga-1' },
    })
    fireEvent.change(screen.getByLabelText('Confirmar contraseña'), {
      target: { value: 'contraseña-larga-1' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Cambiar contraseña' }))

    expect(
      await screen.findByText('Cambiamos tu contraseña.'),
    ).toBeInTheDocument()
    expect(updateUserMock).toHaveBeenCalledWith({
      password: 'contraseña-larga-1',
    })
  })

  it('sin consentimiento de ubicación, ofrece darlo y guarda la fecha actual', async () => {
    const refreshProfile = vi.fn().mockResolvedValue(undefined)
    vi.spyOn(authModule, 'useAuth').mockReturnValue(
      authValue({ refreshProfile }),
    )

    render(<ProfilePage />)
    expect(
      screen.getByText('Todavía no diste tu consentimiento de ubicación.'),
    ).toBeInTheDocument()
    expect(
      await screen.findByText('Texto legal de prueba de consentimiento.'),
    ).toBeInTheDocument()

    fireEvent.click(
      screen.getByRole('button', { name: 'Dar mi consentimiento' }),
    )

    // `refreshProfile()` (el contexto real, no este mock estático) es lo que
    // actualiza `auth.profile.locationConsentAt` en la app de verdad — acá
    // alcanza con comprobar que se guardó la fecha y que se pidió refrescar.
    await vi.waitFor(() => expect(profilesUpdateMock).toHaveBeenCalledTimes(1))
    const [payload] = profilesUpdateMock.mock.calls[0]!
    expect(payload.location_consent_at).not.toBeNull()
    await vi.waitFor(() => expect(refreshProfile).toHaveBeenCalledTimes(1))
  })

  it('con consentimiento ya dado, muestra la fecha y ofrece quitarlo', () => {
    vi.spyOn(authModule, 'useAuth').mockReturnValue(
      authValue({
        profile: {
          id: 'user-1',
          firstName: 'Carlos',
          lastName: 'Medina',
          displayName: 'Carlos Medina',
          contactEmail: null,
          phone: null,
          avatarPath: null,
          locationConsentAt: '2026-08-13T11:00:00.000Z',
        },
      }),
    )

    render(<ProfilePage />)

    expect(screen.getByText(/Diste tu consentimiento el/)).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Quitar consentimiento' }),
    ).toBeInTheDocument()
  })

  it('el botón "Cerrar sesión" llama a auth.signOut()', () => {
    const signOut = vi.fn()
    vi.spyOn(authModule, 'useAuth').mockReturnValue(authValue({ signOut }))

    render(<ProfilePage />)
    fireEvent.click(screen.getByRole('button', { name: 'Cerrar sesión' }))

    expect(signOut).toHaveBeenCalledTimes(1)
  })
})
