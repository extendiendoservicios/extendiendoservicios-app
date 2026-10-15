import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { MyShiftMedia } from '@/api/media'
import { ApiError } from '@/api/errors'

/**
 * Bloque «Fotos y videos» (módulo H, P21.3, EMP-07/EMP-11/SUP-03/SUP-04):
 * qué se ofrece según la sede, el servicio, la ventana de H-12 y la
 * conexión, y el flujo «Quitar». La subida y la compresión tienen sus
 * propios tests (`src/api/media.test.ts`, `src/components/media/`).
 */

const { signMediaUrlMock, removeMutateMock, mediaState } = vi.hoisted(() => ({
  signMediaUrlMock: vi.fn(),
  removeMutateMock: vi.fn(),
  mediaState: { rows: [] as unknown[], pending: false },
}))

vi.mock('@/api/media', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/api/media')>()),
  signMediaUrl: signMediaUrlMock,
}))

vi.mock('../mediaQueries', () => ({
  useMyShiftMediaQuery: () => ({ data: mediaState.rows }),
  useRefreshMyMedia: () => vi.fn().mockResolvedValue(undefined),
  useShiftMediaUpload: () => vi.fn(),
  useRemoveShiftMediaMutation: () => ({
    mutateAsync: removeMutateMock,
    isPending: mediaState.pending,
  }),
}))

const onlineState = vi.hoisted(() => ({ online: true }))
vi.mock('../useOnlineStatus', () => ({
  useOnlineStatus: () => onlineState.online,
}))

vi.mock('@/features/auth/AuthProvider', () => ({
  useAuth: () => ({ userId: 'user-1' }),
}))

import { ShiftMediaSection } from './ShiftMediaSection'

const HOUR = 60 * 60 * 1000

function iso(offsetMs: number): string {
  return new Date(Date.now() + offsetMs).toISOString()
}

function row(overrides: Partial<MyShiftMedia> = {}): MyShiftMedia {
  return {
    id: 'm1',
    shiftId: 'shift-1',
    kind: 'photo',
    storagePath: 'shift-1/m1.jpg',
    thumbPath: 'shift-1/m1_thumb.jpg',
    durationSeconds: null,
    takenAt: '2026-10-13T11:15:00Z',
    createdAt: '2026-10-13T11:20:00Z',
    keep: false,
    expiresOn: '2026-12-12',
    hasFile: true,
    deletedAt: null,
    deletedByFirstName: null,
    deletedByLastName: null,
    thumbUrl: 'https://s.test/m1_thumb.jpg',
    ...overrides,
  }
}

function renderSection(
  props: Partial<React.ComponentProps<typeof ShiftMediaSection>> = {},
) {
  return render(
    <MemoryRouter>
      <ShiftMediaSection
        shiftId="shift-1"
        counts={{ photos: 3, videos: 1 }}
        requiresPhotos={false}
        photosNotAllowed={false}
        startsAt={iso(-2 * HOUR)}
        endsAt={iso(2 * HOUR)}
        {...props}
      />
    </MemoryRouter>,
  )
}

beforeEach(() => {
  onlineState.online = true
  mediaState.rows = []
  mediaState.pending = false
  signMediaUrlMock.mockReset()
  signMediaUrlMock.mockResolvedValue('https://s.test/m1.jpg')
  removeMutateMock.mockReset()
  removeMutateMock.mockResolvedValue(undefined)
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('ShiftMediaSection', () => {
  it('muestra los botones y los topes con lo que ya se subió', () => {
    renderSection()

    expect(screen.getByText('Fotos y videos')).toBeInTheDocument()
    expect(screen.getByText('3 de 10 fotos')).toBeInTheDocument()
    expect(screen.getByText('1 de 2 videos')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Sacar foto' })).toBeEnabled()
    expect(
      screen.queryByText('Este servicio pide fotos.'),
    ).not.toBeInTheDocument()
  })

  it('avisa cuando el servicio pide fotos', () => {
    renderSection({ requiresPhotos: true })
    expect(screen.getByText('Este servicio pide fotos.')).toBeInTheDocument()
  })

  it('en una sede sin fotos muestra solo el texto y ningún botón', () => {
    renderSection({ photosNotAllowed: true, requiresPhotos: true })

    expect(
      screen.getByText('En esta sede no se permiten fotos.'),
    ).toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'Sacar foto' }),
    ).not.toBeInTheDocument()
    expect(
      screen.queryByText('Este servicio pide fotos.'),
    ).not.toBeInTheDocument()
  })

  it('pasadas las 2 horas del fin saca los botones y dice por qué (AJ4-06)', () => {
    renderSection({ startsAt: iso(-8 * HOUR), endsAt: iso(-3 * HOUR) })

    expect(
      screen.queryByRole('button', { name: 'Sacar foto' }),
    ).not.toBeInTheDocument()
    expect(
      screen.getByText(/Ya pasó el plazo para subir fotos y videos/),
    ).toBeInTheDocument()
  })

  it('un turno que todavía no empezó apaga los botones y dice por qué', () => {
    renderSection({ startsAt: iso(HOUR), endsAt: iso(5 * HOUR) })

    expect(screen.getByRole('button', { name: 'Sacar foto' })).toBeDisabled()
    expect(screen.getByText(/desde que empiece el turno/)).toBeInTheDocument()
  })

  it('dentro de las 2 horas posteriores al fin sigue abierta', () => {
    renderSection({ startsAt: iso(-6 * HOUR), endsAt: iso(-1 * HOUR) })
    expect(screen.getByRole('button', { name: 'Sacar foto' })).toBeEnabled()
  })

  it('sin conexión apaga los botones y lo dice', () => {
    onlineState.online = false
    renderSection()

    expect(screen.getByRole('button', { name: 'Sacar foto' })).toBeDisabled()
    expect(screen.getByText(/Estás sin conexión/)).toBeInTheDocument()
  })

  it('con un motivo fijo (turno cancelado) apaga los botones con ese motivo', () => {
    renderSection({ blockedReason: 'Este turno está cancelado.' })

    expect(screen.getByRole('button', { name: 'Sacar foto' })).toBeDisabled()
    expect(screen.getByText('Este turno está cancelado.')).toBeInTheDocument()
  })

  describe('con archivos subidos', () => {
    beforeEach(() => {
      mediaState.rows = [row()]
    })

    it('muestra la grilla de lo propio', () => {
      renderSection()
      expect(screen.getByText('Lo que subiste')).toBeInTheDocument()
      expect(
        screen.getByRole('button', { name: /Foto de las 08:15/ }),
      ).toBeInTheDocument()
    })

    it('«Quitar» pide confirmación y recién entonces quita', async () => {
      renderSection()

      fireEvent.click(screen.getByRole('button', { name: /Foto de las 08:15/ }))
      fireEvent.click(await screen.findByRole('button', { name: 'Quitar' }))

      const dialog = await screen.findByRole('dialog', {
        name: '¿Quitar esta foto?',
      })
      expect(removeMutateMock).not.toHaveBeenCalled()

      fireEvent.click(within(dialog).getByRole('button', { name: 'Quitar' }))

      await waitFor(() =>
        expect(removeMutateMock).toHaveBeenCalledWith(
          expect.objectContaining({
            id: 'm1',
            storagePath: 'shift-1/m1.jpg',
            thumbPath: 'shift-1/m1_thumb.jpg',
          }),
        ),
      )
      await waitFor(() =>
        expect(
          screen.queryByRole('dialog', { name: '¿Quitar esta foto?' }),
        ).not.toBeInTheDocument(),
      )
    })

    it('«Cancelar» en la confirmación no quita nada', async () => {
      renderSection()

      fireEvent.click(screen.getByRole('button', { name: /Foto de las 08:15/ }))
      fireEvent.click(await screen.findByRole('button', { name: 'Quitar' }))
      const dialog = await screen.findByRole('dialog', {
        name: '¿Quitar esta foto?',
      })
      fireEvent.click(within(dialog).getByRole('button', { name: 'Cancelar' }))

      expect(removeMutateMock).not.toHaveBeenCalled()
    })

    it('si el servidor rechaza el quitado, muestra el motivo y deja el diálogo abierto', async () => {
      removeMutateMock.mockRejectedValue(
        new ApiError('Ya pasó el plazo para quitar.', 'MEDIA_WINDOW_CLOSED'),
      )
      renderSection()

      fireEvent.click(screen.getByRole('button', { name: /Foto de las 08:15/ }))
      fireEvent.click(await screen.findByRole('button', { name: 'Quitar' }))
      const dialog = await screen.findByRole('dialog', {
        name: '¿Quitar esta foto?',
      })
      fireEvent.click(within(dialog).getByRole('button', { name: 'Quitar' }))

      expect(
        await within(dialog).findByText('Ya pasó el plazo para quitar.'),
      ).toBeInTheDocument()
    })

    it('fuera de la ventana el visor no ofrece «Quitar»', async () => {
      renderSection({ startsAt: iso(-8 * HOUR), endsAt: iso(-3 * HOUR) })

      fireEvent.click(screen.getByRole('button', { name: /Foto de las 08:15/ }))

      await screen.findByRole('button', { name: 'Cerrar el visor' })
      expect(
        screen.queryByRole('button', { name: 'Quitar' }),
      ).not.toBeInTheDocument()
    })

    it('un archivo vencido se ve como constancia, sin poder quitarlo', () => {
      mediaState.rows = [row({ hasFile: false, thumbUrl: null })]
      renderSection()

      expect(screen.getByText(/venció|vencid/i)).toBeInTheDocument()
    })

    it('un archivo eliminado muestra la constancia y no carga la imagen', () => {
      mediaState.rows = [
        row({
          hasFile: false,
          thumbUrl: null,
          deletedAt: '2026-08-13T15:00:00Z',
          deletedByFirstName: 'Ana',
          deletedByLastName: 'Pérez',
        }),
      ]
      const { container } = renderSection()

      expect(
        screen.getByText('Eliminada por Ana Pérez el día jue 13 ago'),
      ).toBeInTheDocument()
      expect(container.querySelector('img')).toBeNull()
    })
  })
})
