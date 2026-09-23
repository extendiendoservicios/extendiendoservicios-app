import { act, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AuthProvider, useAuth } from './AuthProvider'

/**
 * `AuthProvider` sin red ni `App_dev`: se mockea `@/lib/supabase` entero
 * (regla del encargo P06.2, "los tests unitarios no pueden depender de la
 * red") y se dispara el callback de `onAuthStateChange` a mano, como
 * haría `supabase-js` de verdad ante `INITIAL_SESSION`, `SIGNED_IN`,
 * `TOKEN_REFRESHED` o `SIGNED_OUT`.
 */
type AuthChangeCallback = (event: string, session: unknown) => void

const authStateCallbacks: AuthChangeCallback[] = []
const unsubscribeMock = vi.fn()
const signOutMock = vi.fn(() => Promise.resolve({ error: null }))
const onAuthStateChangeMock = vi.fn((callback: AuthChangeCallback) => {
  authStateCallbacks.push(callback)
  return { data: { subscription: { unsubscribe: unsubscribeMock } } }
})

interface ProfilesQueryBuilder {
  select: (columns: string) => ProfilesQueryBuilder
  eq: (column: string, value: string) => ProfilesQueryBuilder
  maybeSingle: () => Promise<{ data: unknown; error: unknown }>
}

let profilesResult: { data: unknown; error: unknown } = {
  data: null,
  error: null,
}
const fromMock = vi.fn((_table: string): ProfilesQueryBuilder => {
  const builder: ProfilesQueryBuilder = {
    select: vi.fn(() => builder),
    eq: vi.fn(() => builder),
    maybeSingle: vi.fn(() => Promise.resolve(profilesResult)),
  }
  return builder
})

vi.mock('@/lib/supabase', () => ({
  supabase: {
    auth: {
      onAuthStateChange: (callback: AuthChangeCallback) =>
        onAuthStateChangeMock(callback),
      signOut: () => signOutMock(),
    },
    from: (table: string) => fromMock(table),
  },
}))

/** JWT de prueba: header cualquiera, payload real (base64url), firma falsa. */
function fakeSession(
  userId: string,
  email: string,
  claims: Record<string, unknown>,
) {
  const payload = btoa(JSON.stringify({ sub: userId, ...claims }))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')
  return {
    access_token: `eyJhbGciOiJIUzI1NiJ9.${payload}.firma-falsa`,
    user: { id: userId, email },
  }
}

function Probe() {
  const auth = useAuth()
  return (
    <div>
      <p data-testid="status">{auth.status}</p>
      <p data-testid="roles">{auth.roles.join(',')}</p>
      <p data-testid="displayName">{auth.displayName}</p>
      <p data-testid="passwordRecovery">{String(auth.isPasswordRecovery)}</p>
      <button onClick={() => void auth.signOut()}>salir</button>
    </div>
  )
}

function renderProbe() {
  return render(
    <AuthProvider>
      <Probe />
    </AuthProvider>,
  )
}

beforeEach(() => {
  authStateCallbacks.length = 0
  unsubscribeMock.mockClear()
  signOutMock.mockClear()
  fromMock.mockClear()
  onAuthStateChangeMock.mockClear()
  profilesResult = { data: null, error: null }
})

describe('AuthProvider / useAuth', () => {
  it('arranca en loading hasta que llega el primer evento de sesión', () => {
    renderProbe()

    expect(screen.getByTestId('status')).toHaveTextContent('loading')
  })

  it('sin sesión (INITIAL_SESSION con session null) pasa a unauthenticated', () => {
    renderProbe()

    act(() => {
      authStateCallbacks[0]?.('INITIAL_SESSION', null)
    })

    expect(screen.getByTestId('status')).toHaveTextContent('unauthenticated')
    expect(screen.getByTestId('roles')).toHaveTextContent('')
    expect(screen.getByTestId('displayName')).toHaveTextContent('Cuenta')
  })

  it('con sesión, decodifica roles del token y carga el perfil propio', async () => {
    profilesResult = {
      data: {
        id: 'user-1',
        first_name: 'María',
        last_name: 'Gómez',
        contact_email: null,
        phone: null,
        avatar_path: null,
      },
      error: null,
    }

    renderProbe()

    act(() => {
      authStateCallbacks[0]?.(
        'INITIAL_SESSION',
        fakeSession('user-1', 'maria.gomez@extendiendoservicios.com', {
          roles: ['employee'],
          capabilities: [],
        }),
      )
    })

    expect(screen.getByTestId('status')).toHaveTextContent('authenticated')
    expect(screen.getByTestId('roles')).toHaveTextContent('employee')

    // El perfil llega después (una consulta aparte a `profiles`): mientras
    // tanto el respaldo es el email, no un cartel vacío.
    expect(screen.getByTestId('displayName')).toHaveTextContent(
      'maria.gomez@extendiendoservicios.com',
    )

    await waitFor(() =>
      expect(screen.getByTestId('displayName')).toHaveTextContent(
        'María Gómez',
      ),
    )
  })

  it('un TOKEN_REFRESHED del mismo usuario no vuelve a pedir el perfil', async () => {
    profilesResult = {
      data: {
        id: 'user-1',
        first_name: 'María',
        last_name: 'Gómez',
        contact_email: null,
        phone: null,
        avatar_path: null,
      },
      error: null,
    }

    renderProbe()

    act(() => {
      authStateCallbacks[0]?.(
        'INITIAL_SESSION',
        fakeSession('user-1', 'maria.gomez@extendiendoservicios.com', {
          roles: ['employee'],
          capabilities: [],
        }),
      )
    })

    await waitFor(() =>
      expect(screen.getByTestId('displayName')).toHaveTextContent(
        'María Gómez',
      ),
    )
    expect(fromMock).toHaveBeenCalledTimes(1)

    act(() => {
      authStateCallbacks[0]?.(
        'TOKEN_REFRESHED',
        fakeSession('user-1', 'maria.gomez@extendiendoservicios.com', {
          roles: ['employee', 'supervisor'],
          capabilities: [],
        }),
      )
    })

    expect(screen.getByTestId('roles')).toHaveTextContent('employee,supervisor')
    expect(fromMock).toHaveBeenCalledTimes(1)
  })

  it('signOut() llama a supabase.auth.signOut()', () => {
    renderProbe()

    act(() => {
      authStateCallbacks[0]?.(
        'INITIAL_SESSION',
        fakeSession('user-1', 'maria.gomez@extendiendoservicios.com', {
          roles: ['employee'],
          capabilities: [],
        }),
      )
    })

    screen.getByRole('button', { name: 'salir' }).click()

    expect(signOutMock).toHaveBeenCalledTimes(1)
  })

  it('una revocación remota (el próximo evento llega con session null) deja todo limpio', () => {
    renderProbe()

    act(() => {
      authStateCallbacks[0]?.(
        'INITIAL_SESSION',
        fakeSession('user-1', 'maria.gomez@extendiendoservicios.com', {
          roles: ['employee'],
          capabilities: [],
        }),
      )
    })
    expect(screen.getByTestId('status')).toHaveTextContent('authenticated')

    // `supabase-js` dispara SIGNED_OUT con `session: null` cuando el
    // refresh token ya no sirve (revocado desde afuera, expirado): no hay
    // un estado intermedio raro, cae directo en `unauthenticated`.
    act(() => {
      authStateCallbacks[0]?.('SIGNED_OUT', null)
    })

    expect(screen.getByTestId('status')).toHaveTextContent('unauthenticated')
    expect(screen.getByTestId('roles')).toHaveTextContent('')
    expect(screen.getByTestId('displayName')).toHaveTextContent('Cuenta')
  })

  it('un evento PASSWORD_RECOVERY prende isPasswordRecovery (COM-03)', () => {
    renderProbe()

    expect(screen.getByTestId('passwordRecovery')).toHaveTextContent('false')

    // Así llega el enlace de COM-02 procesado por `detectSessionInUrl`: con
    // sesión completa (roles incluidos, ver `AuthProvider.tsx`), pero por el
    // evento `PASSWORD_RECOVERY`, no `SIGNED_IN`.
    act(() => {
      authStateCallbacks[0]?.(
        'PASSWORD_RECOVERY',
        fakeSession('user-1', 'carlos.medina@extendiendoservicios.com', {
          roles: ['employee'],
          capabilities: [],
        }),
      )
    })

    expect(screen.getByTestId('status')).toHaveTextContent('authenticated')
    expect(screen.getByTestId('passwordRecovery')).toHaveTextContent('true')
  })

  it('USER_UPDATED apaga isPasswordRecovery (la contraseña ya se cambió)', () => {
    renderProbe()

    act(() => {
      authStateCallbacks[0]?.(
        'PASSWORD_RECOVERY',
        fakeSession('user-1', 'carlos.medina@extendiendoservicios.com', {
          roles: ['employee'],
          capabilities: [],
        }),
      )
    })
    expect(screen.getByTestId('passwordRecovery')).toHaveTextContent('true')

    act(() => {
      authStateCallbacks[0]?.(
        'USER_UPDATED',
        fakeSession('user-1', 'carlos.medina@extendiendoservicios.com', {
          roles: ['employee'],
          capabilities: [],
        }),
      )
    })
    expect(screen.getByTestId('passwordRecovery')).toHaveTextContent('false')
  })

  it('SIGNED_OUT también apaga isPasswordRecovery', () => {
    renderProbe()

    act(() => {
      authStateCallbacks[0]?.(
        'PASSWORD_RECOVERY',
        fakeSession('user-1', 'carlos.medina@extendiendoservicios.com', {
          roles: ['employee'],
          capabilities: [],
        }),
      )
    })

    act(() => {
      authStateCallbacks[0]?.('SIGNED_OUT', null)
    })

    expect(screen.getByTestId('passwordRecovery')).toHaveTextContent('false')
  })
})
