import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { InstallBanner } from './InstallBanner'
import * as installPromptModule from '@/hooks/useInstallPrompt'

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

  it('iPhone con Safari: pasos numerados con el ícono de Compartir', async () => {
    mockMatchMedia(false)
    vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue(
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
    )
    vi.spyOn(installPromptModule, 'useInstallPrompt').mockReturnValue({
      available: false,
      promptInstall: vi.fn(),
    })

    render(<InstallBanner />)

    expect(await screen.findAllByRole('listitem')).toHaveLength(3)
    expect(screen.getByRole('img', { name: 'Compartir' })).toBeInTheDocument()
    expect(screen.getByText(/Agregar a pantalla de inicio/)).toBeInTheDocument()
  })

  it('iPhone con otro navegador: pide abrir en Safari y copia el enlace', async () => {
    mockMatchMedia(false)
    vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue(
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/126.0 Mobile/15E148 Safari/604.1',
    )
    vi.spyOn(installPromptModule, 'useInstallPrompt').mockReturnValue({
      available: false,
      promptInstall: vi.fn(),
    })
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText },
      configurable: true,
    })

    render(<InstallBanner />)

    expect(
      await screen.findByText(
        'Para instalar la app, abrí este enlace en Safari.',
      ),
    ).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Copiar enlace' }))
    await waitFor(() =>
      expect(writeText).toHaveBeenCalledWith(window.location.href),
    )
    expect(await screen.findByRole('status')).toHaveTextContent(
      'Enlace copiado',
    )
  })
})
