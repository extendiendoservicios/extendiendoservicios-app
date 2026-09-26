import { render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { InstallBanner } from './InstallBanner'
import * as installPromptModule from '@/features/employee/useInstallPrompt'

/**
 * `InstallBanner` (COM-06, MOB-EMP-014): con `beforeinstallprompt`
 * disponible (Android/Chrome) muestra el botón "Instalar"; sin él y en un
 * dispositivo que no es iOS, no muestra nada; instalada (`display-mode:
 * standalone`), tampoco.
 */
afterEach(() => {
  vi.restoreAllMocks()
  window.localStorage.clear()
})

function mockMatchMedia(matches: boolean) {
  vi.stubGlobal(
    'matchMedia',
    vi.fn().mockImplementation((query: string) => ({
      matches,
      media: query,
      addListener: vi.fn(),
      removeListener: vi.fn(),
    })),
  )
}

describe('InstallBanner', () => {
  it('muestra "Instalar" cuando el navegador ofrece beforeinstallprompt', async () => {
    mockMatchMedia(false)
    vi.spyOn(installPromptModule, 'useInstallPrompt').mockReturnValue({
      available: true,
      promptInstall: vi.fn(),
    })

    render(<InstallBanner />)

    await waitFor(() =>
      expect(screen.getByText('Instalá la aplicación')).toBeInTheDocument(),
    )
    expect(screen.getByRole('button', { name: 'Instalar' })).toBeInTheDocument()
  })

  it('no muestra nada sin beforeinstallprompt en un navegador que no es iOS', async () => {
    mockMatchMedia(false)
    vi.spyOn(installPromptModule, 'useInstallPrompt').mockReturnValue({
      available: false,
      promptInstall: vi.fn(),
    })

    const { container } = render(<InstallBanner />)

    await waitFor(() => expect(container).toBeEmptyDOMElement())
  })

  it('no muestra nada si la app ya corre instalada (standalone)', async () => {
    mockMatchMedia(true)
    vi.spyOn(installPromptModule, 'useInstallPrompt').mockReturnValue({
      available: true,
      promptInstall: vi.fn(),
    })

    const { container } = render(<InstallBanner />)

    await waitFor(() => expect(container).toBeEmptyDOMElement())
  })
})
