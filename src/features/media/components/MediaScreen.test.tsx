import { MemoryRouter } from 'react-router'
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ShiftMediaFilters, StorageUsage } from '@/api/mediaAdmin'
import { mediaRow } from '@/features/media/testRows'
import { MediaError } from '@/lib/media/errors'

/**
 * ADM-32 «Fotos y videos»: filtros, grilla agrupada por turno con enlace al
 * detalle, selección múltiple y «Descargar ZIP». Se mockean los hooks (no la
 * red) y la descarga.
 */

const {
  listMock,
  usageMock,
  signedUrlsMock,
  downloadZipMock,
  fetchNextPageMock,
  toastSuccess,
  toastError,
} = vi.hoisted(() => ({
  listMock: vi.fn(),
  usageMock: vi.fn(),
  signedUrlsMock: vi.fn(),
  downloadZipMock: vi.fn(),
  fetchNextPageMock: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}))

vi.mock('sonner', () => ({
  toast: { success: toastSuccess, error: toastError },
}))

vi.mock('@/features/employees/employeeLeaveStatus', () => ({
  todayInBuenosAires: () => '2026-10-13',
}))

vi.mock('@/features/media/queries', () => ({
  useShiftMediaListQuery: (filters: ShiftMediaFilters): unknown =>
    listMock(filters),
  useStorageUsageQuery: (): unknown => usageMock(),
  useThumbUrls: () => new Map<string, string>(),
  useSetMediaKeepMutation: () => ({ mutateAsync: vi.fn(), isPending: false }),
}))

vi.mock('@/features/clients/queries', () => ({
  useClientsQuery: () => ({
    data: [{ id: 'c1', tradeName: 'Limpia Ya', legalName: 'L SRL' }],
  }),
  useClientSitesQuery: () => ({ data: [{ id: 'si1', name: 'Sede Centro' }] }),
}))

vi.mock('@/features/employees/queries', () => ({
  useEmployeesQuery: () => ({
    data: [{ profileId: 'p1', firstName: 'Ana', lastName: 'Pérez' }],
  }),
}))

vi.mock('@/api/mediaAdmin', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/api/mediaAdmin')>()),
  createEvidenceSignedUrls: signedUrlsMock,
}))

vi.mock('@/lib/media/download', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/media/download')>()),
  downloadZip: downloadZipMock,
}))

// Los selectores reales son popovers de Radix: acá alcanzan `<select>` nativos.
vi.mock('@/components/ui/select', async () => {
  const React = await import('react')
  const Trigger = () => null
  const Content = () => null
  return {
    Select: ({
      value,
      onValueChange,
      disabled,
      children,
    }: {
      value: string
      onValueChange: (value: string) => void
      disabled?: boolean
      children: React.ReactNode
    }) => {
      const kids = React.Children.toArray(children) as React.ReactElement<{
        'aria-label'?: string
        children?: React.ReactNode
      }>[]
      const trigger = kids.find((kid) => kid.type === Trigger)
      const content = kids.find((kid) => kid.type === Content)
      return (
        <select
          aria-label={trigger?.props['aria-label']}
          value={value}
          disabled={disabled}
          onChange={(event) => onValueChange(event.target.value)}
        >
          {content?.props.children}
        </select>
      )
    },
    SelectTrigger: Trigger,
    SelectContent: Content,
    SelectValue: () => null,
    SelectItem: ({
      value,
      children,
    }: {
      value: string
      children: React.ReactNode
    }) => <option value={value}>{children}</option>,
  }
})

const { MediaScreen } = await import('./MediaScreen')

const USAGE: StorageUsage = {
  totalBytes: 100 * 1024 * 1024,
  limitBytes: 1073741824,
  percent: 9.8,
  level: 'ok',
  buckets: [{ bucket: 'evidence', bytes: 100 * 1024 * 1024, objects: 500 }],
}

function listResult(rows: ReturnType<typeof mediaRow>[], hasNext = false) {
  return {
    data: { pages: [{ rows, page: 0, hasMore: hasNext }] },
    isLoading: false,
    isError: false,
    error: null,
    dataUpdatedAt: Date.now(),
    hasNextPage: hasNext,
    isFetchingNextPage: false,
    fetchNextPage: fetchNextPageMock,
  }
}

function renderScreen() {
  return render(
    <MemoryRouter>
      <MediaScreen />
    </MemoryRouter>,
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  usageMock.mockReturnValue({ data: USAGE, isLoading: false })
  listMock.mockReturnValue(
    listResult([
      mediaRow({ id: 'a' }),
      mediaRow({ id: 'b', kind: 'video', durationSeconds: 20 }),
      mediaRow({
        id: 'c',
        shiftId: 'sh2',
        shiftDate: '2026-10-12',
        clientName: 'Otra SA',
        siteName: 'Sede Norte',
      }),
    ]),
  )
})

describe('ADM-32: medidor y filtros', () => {
  it('muestra el medidor arriba y pide por defecto los últimos 30 días', () => {
    renderScreen()
    expect(
      screen.getByRole('progressbar', { name: 'Espacio usado' }),
    ).toBeInTheDocument()
    const filters = listMock.mock.calls[0]?.[0] as ShiftMediaFilters
    expect(filters.dateFrom).toBe('2026-09-13')
    expect(filters.dateTo).toBe('2026-10-13')
    expect(filters.keepOnly).toBeUndefined()
  })

  it('ofrece todos los filtros de H-09', () => {
    renderScreen()
    for (const name of [
      'Desde',
      'Hasta',
      'Filtrar por cliente',
      'Filtrar por sede',
      'Filtrar por persona',
      'Filtrar por tipo',
      'Filtrar por conservación',
    ]) {
      expect(screen.getByLabelText(name)).toBeInTheDocument()
    }
  })

  it('la sede queda deshabilitada hasta elegir un cliente', () => {
    renderScreen()
    expect(screen.getByLabelText('Filtrar por sede')).toBeDisabled()
  })

  it('«Conservadas» pide keepOnly y vacía el rango por defecto', () => {
    renderScreen()
    fireEvent.change(screen.getByLabelText('Filtrar por conservación'), {
      target: { value: 'keep' },
    })
    const last = listMock.mock.calls.at(-1)?.[0] as ShiftMediaFilters
    expect(last.keepOnly).toBe(true)
    expect(last.dateFrom).toBeUndefined()
  })

  it('«Por vencer en 7 días» pide hasta hoy + 7', () => {
    renderScreen()
    fireEvent.change(screen.getByLabelText('Filtrar por conservación'), {
      target: { value: 'expiring' },
    })
    const last = listMock.mock.calls.at(-1)?.[0] as ShiftMediaFilters
    expect(last.expiresBy).toBe('2026-10-20')
  })
})

describe('ADM-32: grilla', () => {
  it('agrupa por turno con «fecha · cliente · sede» y enlace al detalle del turno', () => {
    renderScreen()
    const link = screen.getByRole('link', {
      name: 'mar 13 oct · Limpia Ya · Sede Centro',
    })
    expect(link).toHaveAttribute('href', '/admin/turnos/sh1')
    expect(
      screen.getByRole('link', { name: 'lun 12 oct · Otra SA · Sede Norte' }),
    ).toHaveAttribute('href', '/admin/turnos/sh2')
    expect(screen.getByText('1 foto · 1 video')).toBeInTheDocument()
  })

  it('lo vencido es una constancia gris que no se puede seleccionar', () => {
    listMock.mockReturnValue(
      listResult([mediaRow({ id: 'a', hasFile: false })]),
    )
    renderScreen()
    expect(screen.getByText('Vencida')).toBeInTheDocument()
    expect(
      screen.queryByRole('checkbox', { name: /Seleccionar/ }),
    ).not.toBeInTheDocument()
  })

  it('sin resultados muestra el estado vacío', () => {
    listMock.mockReturnValue(listResult([]))
    renderScreen()
    expect(
      screen.getByText('No hay fotos ni videos con estos filtros'),
    ).toBeInTheDocument()
  })

  it('carga por partes: «Ver más» pide la página siguiente', () => {
    listMock.mockReturnValue(listResult([mediaRow()], true))
    renderScreen()
    fireEvent.click(screen.getByRole('button', { name: 'Ver más' }))
    expect(fetchNextPageMock).toHaveBeenCalledTimes(1)
  })

  it('no ofrece «Ver más» en la última página', () => {
    renderScreen()
    expect(screen.queryByRole('button', { name: 'Ver más' })).toBeNull()
  })
})

describe('ADM-32: selección y ZIP', () => {
  it('sin selección no hay barra de acciones', () => {
    renderScreen()
    expect(screen.queryByRole('region', { name: 'Selección' })).toBeNull()
  })

  it('seleccionar muestra la cuenta, y «Seleccionar todo» marca todo un turno', () => {
    renderScreen()
    fireEvent.click(
      screen.getAllByRole('button', {
        name: 'Seleccionar todo',
      })[0] as HTMLElement,
    )
    const bar = screen.getByRole('region', { name: 'Selección' })
    expect(within(bar).getByText('2 seleccionados')).toBeInTheDocument()
    expect(
      within(bar).getByRole('button', { name: 'Descargar ZIP' }),
    ).toBeEnabled()
  })

  it('«Descargar ZIP» firma los originales y arma el ZIP con nombres legibles', async () => {
    signedUrlsMock.mockResolvedValue(new Map([['sh1/m1.jpg', 'https://s/1']]))
    downloadZipMock.mockImplementation(
      (
        _items: unknown,
        options: { onProgress?: (d: number, t: number) => void },
      ) => {
        options.onProgress?.(1, 1)
        return Promise.resolve(new Blob())
      },
    )
    renderScreen()
    fireEvent.click(
      screen.getAllByRole('checkbox', {
        name: /Seleccionar Foto de Ana/,
      })[0] as HTMLElement,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Descargar ZIP' }))

    await waitFor(() => expect(downloadZipMock).toHaveBeenCalledTimes(1))
    expect(signedUrlsMock).toHaveBeenCalledWith(
      ['sh1/m1.jpg'],
      expect.any(Number),
    )
    const [items, options] = downloadZipMock.mock.calls[0] as [
      Array<Record<string, string>>,
      { zipName: string },
    ]
    expect(items[0]).toMatchObject({
      url: 'https://s/1',
      date: '2026-10-13',
      client: 'Limpia Ya',
      site: 'Sede Centro',
      person: 'Ana Pérez',
      extension: 'jpg',
    })
    expect(options.zipName).toBe('fotos-y-videos-2026-10-13')
    await waitFor(() =>
      expect(toastSuccess).toHaveBeenCalledWith('Listo: se bajó el ZIP.'),
    )
  })

  it('si falla la descarga muestra el error en español', async () => {
    signedUrlsMock.mockResolvedValue(new Map([['sh1/m1.jpg', 'https://s/1']]))
    downloadZipMock.mockRejectedValue(new MediaError('download_failed'))
    renderScreen()
    fireEvent.click(
      screen.getAllByRole('checkbox', {
        name: /Seleccionar Foto de Ana/,
      })[0] as HTMLElement,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Descargar ZIP' }))
    await waitFor(() =>
      expect(toastError).toHaveBeenCalledWith(
        'No pudimos descargar el archivo. Probá de nuevo.',
      ),
    )
  })

  it('pone un tope de 50 archivos por ZIP', () => {
    listMock.mockReturnValue(
      listResult(
        Array.from({ length: 51 }, (_, i) =>
          mediaRow({
            id: `m${i}`,
            storagePath: `sh1/m${i}.jpg`,
            thumbPath: `sh1/m${i}_thumb.jpg`,
          }),
        ),
      ),
    )
    renderScreen()
    fireEvent.click(screen.getByRole('button', { name: 'Seleccionar todo' }))
    expect(screen.getByRole('button', { name: 'Descargar ZIP' })).toBeDisabled()
    expect(screen.getByText(/hasta 50 archivos/)).toBeInTheDocument()
  })
})
