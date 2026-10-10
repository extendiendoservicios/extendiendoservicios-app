import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'
import * as api from '@/api/myAnnouncements'
import { ApiError } from '@/api/errors'
import type { MyAnnouncement } from '@/api/myAnnouncements'
import { AnnouncementsBanner } from './AnnouncementsBanner'
import { AnnouncementsHistory } from './AnnouncementsHistory'

/**
 * Anuncios del celular (AJ2-03): tarjeta, "Entendido" optimista con
 * reversión, "Ver N anuncios más" e historial.
 */
function announcement(n: number, over: Partial<MyAnnouncement> = {}) {
  return {
    id: `a${n}`,
    title: `Título ${n}`,
    body: `Línea uno ${n}\nLínea dos ${n}`,
    audience: 'all',
    visibleUntil: null,
    createdAt: '2026-10-09T12:00:00Z',
    contentUpdatedAt: '2026-10-09T12:00:00Z',
    readAt: null,
    wasEdited: false,
    ...over,
  } satisfies MyAnnouncement
}

afterEach(() => {
  vi.restoreAllMocks()
})

function renderWith(ui: React.ReactNode) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>{ui}</MemoryRouter>
    </QueryClientProvider>,
  )
}

describe('AnnouncementsBanner', () => {
  it('muestra título, texto completo, fecha y el botón Entendido', async () => {
    vi.spyOn(api, 'fetchMyAnnouncements').mockResolvedValue([
      announcement(1, { wasEdited: true }),
    ])
    renderWith(<AnnouncementsBanner />)
    const region = await screen.findByRole('region', {
      name: 'Anuncio: Título 1',
    })
    expect(region).toHaveTextContent('Línea uno 1')
    expect(region).toHaveTextContent('Línea dos 1')
    expect(region).toHaveTextContent('Actualizado')
    expect(screen.getByRole('button', { name: 'Entendido' })).toBeEnabled()
  })

  it('no muestra nada si falla la consulta o no hay pendientes', async () => {
    const fetch = vi
      .spyOn(api, 'fetchMyAnnouncements')
      .mockRejectedValue(new Error('red'))
    renderWith(<AnnouncementsBanner />)
    await waitFor(() => expect(fetch).toHaveBeenCalled())
    expect(screen.queryByTestId('announcements-banner')).toBeNull()
  })

  it('con más de 2 pendientes muestra 2 y "Ver N anuncios más" los despliega', async () => {
    vi.spyOn(api, 'fetchMyAnnouncements').mockResolvedValue([
      announcement(1),
      announcement(2),
      announcement(3),
      announcement(4),
    ])
    renderWith(<AnnouncementsBanner />)
    await screen.findByText('Título 1')
    expect(screen.queryByText('Título 3')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Ver 2 anuncios más' }))
    expect(screen.getByText('Título 3')).toBeInTheDocument()
    expect(screen.getByText('Título 4')).toBeInTheDocument()
  })

  it('Entendido saca la tarjeta al instante y llama a la RPC', async () => {
    // Como el servidor: después del "Entendido", la lista ya viene con la lectura.
    let acked = false
    vi.spyOn(api, 'fetchMyAnnouncements').mockImplementation(() =>
      Promise.resolve([
        announcement(1, acked ? { readAt: '2026-10-10T12:00:00Z' } : {}),
      ]),
    )
    const ack = vi
      .spyOn(api, 'acknowledgeAnnouncement')
      .mockImplementation(() => {
        acked = true
        return Promise.resolve()
      })
    renderWith(<AnnouncementsBanner />)
    fireEvent.click(await screen.findByRole('button', { name: 'Entendido' }))
    await waitFor(() => expect(screen.queryByText('Título 1')).toBeNull())
    expect(ack).toHaveBeenCalledWith('a1')
  })

  it('si falla por red, vuelve a mostrar la tarjeta con un aviso', async () => {
    vi.spyOn(api, 'fetchMyAnnouncements').mockResolvedValue([announcement(1)])
    vi.spyOn(api, 'acknowledgeAnnouncement').mockRejectedValue(
      new Error('network'),
    )
    renderWith(<AnnouncementsBanner />)
    fireEvent.click(await screen.findByRole('button', { name: 'Entendido' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'No pudimos registrar tu "Entendido"',
    )
    expect(screen.getByText('Título 1')).toBeInTheDocument()
  })

  it('si el anuncio ya no está disponible, lo saca y muestra el mensaje', async () => {
    let gone = false
    vi.spyOn(api, 'fetchMyAnnouncements').mockImplementation(() =>
      Promise.resolve(
        gone ? [announcement(2)] : [announcement(1), announcement(2)],
      ),
    )
    vi.spyOn(api, 'acknowledgeAnnouncement').mockImplementation(() => {
      gone = true
      return Promise.reject(
        new ApiError(
          'Ese anuncio ya no está disponible para vos.',
          'ANNOUNCEMENT_NOT_AVAILABLE',
        ),
      )
    })
    renderWith(<AnnouncementsBanner />)
    const buttons = await screen.findAllByRole('button', { name: 'Entendido' })
    fireEvent.click(buttons[0]!)
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Ese anuncio ya no está disponible para vos.',
    )
    expect(screen.queryByText('Título 1')).toBeNull()
    expect(screen.getByText('Título 2')).toBeInTheDocument()
  })
})

describe('AnnouncementsHistory', () => {
  it('muestra leídos con su fecha y pendientes con el botón', async () => {
    vi.spyOn(api, 'fetchMyAnnouncements').mockResolvedValue([
      announcement(1),
      announcement(2, { readAt: '2026-10-09T15:00:00Z' }),
    ])
    renderWith(<AnnouncementsHistory />)
    await screen.findByText('Título 1')
    expect(screen.getAllByRole('button', { name: 'Entendido' })).toHaveLength(1)
    expect(screen.getByText('Leído el 09/10')).toBeInTheDocument()
  })

  it('sin anuncios vigentes muestra el estado vacío', async () => {
    vi.spyOn(api, 'fetchMyAnnouncements').mockResolvedValue([])
    renderWith(<AnnouncementsHistory />)
    expect(
      await screen.findByText('No hay anuncios vigentes'),
    ).toBeInTheDocument()
  })
})
