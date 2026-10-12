import { act, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AuthProvider, useAuth } from './AuthProvider'
import { HIGH_CONTRAST_STORAGE_KEY } from '@/lib/contrast'

/** Alto contraste (AJ2-02): el valor del perfil manda sobre localStorage. */
type Callback = (event: string, session: unknown) => void
const { callbacks, profileRow } = vi.hoisted(() => ({
  callbacks: [] as Callback[],
  profileRow: { current: null as Record<string, unknown> | null },
}))

vi.mock('@/lib/supabase', () => ({
  supabase: {
    auth: {
      onAuthStateChange: (cb: Callback) => {
        callbacks.push(cb)
        return { data: { subscription: { unsubscribe: vi.fn() } } }
      },
      signOut: vi.fn(),
    },
    from: () => {
      const b = {
        select: () => b,
        eq: () => b,
        maybeSingle: () =>
          Promise.resolve({ data: profileRow.current, error: null }),
      }
      return b
    },
  },
}))

function session() {
  const payload = btoa(JSON.stringify({ sub: 'u1', roles: ['employee'] }))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')
  return {
    access_token: `x.${payload}.y`,
    user: { id: 'u1', email: 'a@b.com' },
  }
}

function Probe() {
  return <p data-testid="s">{useAuth().status}</p>
}

function row(highContrast: boolean) {
  return {
    id: 'u1',
    first_name: 'A',
    last_name: 'B',
    contact_email: null,
    phone: null,
    avatar_path: null,
    location_consent_at: null,
    high_contrast: highContrast,
  }
}

beforeEach(() => {
  callbacks.length = 0
  localStorage.clear()
  document.documentElement.removeAttribute('data-contrast')
})

describe('AuthProvider · alto contraste', () => {
  it('el perfil manda: aunque lo guardado diga que sí, si el perfil dice que no, se quita', async () => {
    localStorage.setItem(HIGH_CONTRAST_STORAGE_KEY, '1')
    document.documentElement.setAttribute('data-contrast', 'high')
    profileRow.current = row(false)
    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>,
    )
    act(() => callbacks[0]?.('INITIAL_SESSION', session()))
    await waitFor(() =>
      expect(document.documentElement.hasAttribute('data-contrast')).toBe(
        false,
      ),
    )
    expect(localStorage.getItem(HIGH_CONTRAST_STORAGE_KEY)).toBeNull()
  })

  it('si el perfil dice que sí, lo aplica y lo recuerda; al cerrar sesión lo quita', async () => {
    profileRow.current = row(true)
    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>,
    )
    act(() => callbacks[0]?.('INITIAL_SESSION', session()))
    await waitFor(() =>
      expect(document.documentElement.getAttribute('data-contrast')).toBe(
        'high',
      ),
    )
    expect(localStorage.getItem(HIGH_CONTRAST_STORAGE_KEY)).toBe('1')
    expect(screen.getByTestId('s')).toHaveTextContent('authenticated')

    act(() => callbacks[0]?.('SIGNED_OUT', null))
    expect(document.documentElement.hasAttribute('data-contrast')).toBe(false)
    expect(localStorage.getItem(HIGH_CONTRAST_STORAGE_KEY)).toBeNull()
  })
})
