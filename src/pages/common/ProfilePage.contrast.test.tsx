import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import ProfilePage from './ProfilePage'
import * as authModule from '@/features/auth/AuthProvider'
import type { AuthContextValue } from '@/features/auth/AuthProvider'
import { HIGH_CONTRAST_STORAGE_KEY } from '@/lib/contrast'

/** Alto contraste (AJ2-02): el interruptor de «Accesibilidad» en COM-04. */
const { setMyHighContrastMock, toastError } = vi.hoisted(() => ({
  setMyHighContrastMock: vi.fn<(enabled: boolean) => Promise<void>>(),
  toastError: vi.fn(),
}))
vi.mock('@/api/profile', () => ({ setMyHighContrast: setMyHighContrastMock }))
vi.mock('@/api/users', () => ({ updatePersonName: vi.fn() }))
vi.mock('sonner', () => ({ toast: { error: toastError, success: vi.fn() } }))
vi.mock('@/lib/supabase', () => ({
  supabase: {
    auth: { updateUser: vi.fn() },
    from: () => ({
      select: () => ({
        eq: () => ({ maybeSingle: () => Promise.resolve({ data: null }) }),
      }),
    }),
  },
}))

function authValue(highContrast: boolean): AuthContextValue {
  return {
    status: 'authenticated',
    userId: 'user-1',
    email: 'a@b.com',
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
      highContrast,
    },
    displayName: 'Carlos Medina',
    isPasswordRecovery: false,
    signOut: vi.fn(),
    refreshProfile: vi.fn().mockResolvedValue(undefined),
  }
}

beforeEach(() => {
  setMyHighContrastMock.mockReset().mockResolvedValue(undefined)
  toastError.mockReset()
  document.documentElement.removeAttribute('data-contrast')
  localStorage.clear()
})
afterEach(() => vi.restoreAllMocks())

describe('ProfilePage · alto contraste', () => {
  it('al activarlo llama a la RPC, pone el atributo y lo recuerda; al apagarlo lo quita', async () => {
    vi.spyOn(authModule, 'useAuth').mockReturnValue(authValue(false))
    render(<ProfilePage />)
    const toggle = screen.getByRole('switch', { name: 'Alto contraste' })
    expect(toggle).not.toBeChecked()

    fireEvent.click(toggle)
    expect(document.documentElement.getAttribute('data-contrast')).toBe('high')
    await waitFor(() =>
      expect(setMyHighContrastMock).toHaveBeenCalledWith(true),
    )
    expect(localStorage.getItem(HIGH_CONTRAST_STORAGE_KEY)).toBe('1')

    fireEvent.click(toggle)
    expect(document.documentElement.hasAttribute('data-contrast')).toBe(false)
    await waitFor(() =>
      expect(setMyHighContrastMock).toHaveBeenLastCalledWith(false),
    )
  })

  it('si la RPC falla vuelve atrás y avisa', async () => {
    setMyHighContrastMock.mockRejectedValue(new Error('boom'))
    vi.spyOn(authModule, 'useAuth').mockReturnValue(authValue(false))
    render(<ProfilePage />)
    fireEvent.click(screen.getByRole('switch', { name: 'Alto contraste' }))
    await waitFor(() => expect(toastError).toHaveBeenCalled())
    expect(document.documentElement.hasAttribute('data-contrast')).toBe(false)
    expect(
      screen.getByRole('switch', { name: 'Alto contraste' }),
    ).not.toBeChecked()
  })
})
