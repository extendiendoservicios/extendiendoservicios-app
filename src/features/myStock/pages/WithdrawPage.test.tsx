import { act, fireEvent, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import WithdrawPage from './WithdrawPage'
import { ApiError } from '@/api/errors'
import {
  makeShiftOption,
  makeSiteOption,
  makeSupply,
  mockStockQueries,
  renderStockRoute,
} from '../testUtils'

/**
 * Retirar insumos (P25.4, IS-12, IS-28): turno o sede con observación,
 * artículos y cantidades enteras, «Sin stock» no elegible, confirmación con la
 * hora del servidor y, sin conexión, no se registra.
 */
const CATALOG = [
  makeSupply({
    id: 's1',
    code: 'QUI-001',
    name: 'Lavandina',
    presentation: '1 L',
  }),
  makeSupply({
    id: 's2',
    code: 'DES-001',
    name: 'Bolsas de residuos',
    presentation: null,
    categoryId: 'c2',
    categoryName: 'Descartables',
    categorySortOrder: 2,
    outOfStock: true,
  }),
  makeSupply({
    id: 's3',
    code: 'QUI-002',
    name: 'Lavandina',
    presentation: '5 L',
  }),
]

const RESULT = {
  movementId: 'm9',
  recordedAt: '2026-10-26T15:07:00Z',
  shiftId: 'sh1',
  siteId: 'si1',
  note: null,
  lines: [
    {
      supplyId: 's1',
      code: 'QUI-001',
      name: 'Lavandina',
      presentation: '1 L',
      qty: 2,
    },
  ],
}

function setup({
  entry = '/app/insumos/retirar',
  online = true,
  register = vi.fn().mockResolvedValue(RESULT),
  shiftOptions = [makeShiftOption()],
  siteOptions = [makeSiteOption()],
}: {
  entry?: string
  online?: boolean
  register?: ReturnType<typeof vi.fn>
  shiftOptions?: ReturnType<typeof makeShiftOption>[]
  siteOptions?: ReturnType<typeof makeSiteOption>[]
} = {}) {
  mockStockQueries({
    catalog: CATALOG,
    shiftOptions,
    siteOptions,
    online,
    register,
  })
  renderStockRoute(<WithdrawPage />, {
    path: entry.split('?')[0] ?? entry,
    entry,
  })
  return register
}

/** Entra al paso de artículos eligiendo el turno del ejemplo. */
function goToArticles() {
  fireEvent.click(
    screen.getByRole('radio', { name: /Limpiadora SRL · Sede Centro/ }),
  )
  fireEvent.click(screen.getByRole('button', { name: 'Continuar' }))
}

afterEach(() => vi.restoreAllMocks())

describe('WithdrawPage', () => {
  it('los controles por artículo distinguen la presentación en su nombre accesible', () => {
    setup()
    goToArticles()
    expect(
      screen.getByRole('button', { name: 'Agregar Lavandina · 1 L' }),
    ).toBeInTheDocument()
    fireEvent.click(
      screen.getByRole('button', { name: 'Agregar Lavandina · 5 L' }),
    )
    expect(
      screen.getByRole('button', {
        name: 'Restar una unidad de Lavandina · 5 L',
      }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('button', {
        name: 'Sumar una unidad de Lavandina · 5 L',
      }),
    ).toBeInTheDocument()
    expect(
      screen.queryByRole('button', {
        name: /Restar una unidad de Lavandina · 1 L/,
      }),
    ).not.toBeInTheDocument()
  })

  it('con turno: lo elige, agrega artículos, revisa y confirma; muestra la hora del servidor', async () => {
    const register = setup()

    // Sin turno elegido no se puede continuar.
    expect(screen.getByRole('button', { name: 'Continuar' })).toBeDisabled()
    goToArticles()

    // Sin artículos no se puede revisar.
    expect(
      screen.getByRole('button', { name: 'Elegí al menos un artículo' }),
    ).toBeDisabled()

    fireEvent.click(
      screen.getByRole('button', { name: 'Agregar Lavandina · 1 L' }),
    )
    fireEvent.click(
      screen.getByRole('button', {
        name: 'Sumar una unidad de Lavandina · 1 L',
      }),
    )
    fireEvent.click(
      screen.getByRole('button', { name: 'Revisar retiro (2 u.)' }),
    )

    // Paso de revisión: observación opcional para un turno.
    expect(screen.getByText('Lavandina · 1 L')).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Observación del retiro'), {
      target: { value: 'Para el piso 2' },
    })
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Confirmar retiro' }))
      await Promise.resolve()
    })

    expect(register).toHaveBeenCalledWith({
      lines: [{ supplyId: 's1', qty: 2 }],
      shiftId: 'sh1',
      siteId: null,
      note: 'Para el piso 2',
    })
    // Hora del servidor (15:07 UTC = 12:07 en Buenos Aires), no la del dispositivo.
    expect(
      await screen.findByText(/Retiro registrado el .*12:07/),
    ).toBeInTheDocument()
    expect(screen.getByText(/Lavandina · 1 L/)).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Volver a Insumos' }),
    ).toBeInTheDocument()
  })

  it('un artículo «Sin stock» se ve con su etiqueta y no se puede elegir', () => {
    setup()
    goToArticles()

    const agotado = screen.getByText('Bolsas de residuos').closest('li')
    expect(
      within(agotado as HTMLElement).getByText('Sin stock'),
    ).toBeInTheDocument()
    expect(
      within(agotado as HTMLElement).queryByRole('button'),
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'Agregar Bolsas de residuos' }),
    ).not.toBeInTheDocument()
  })

  it('no muestra cantidades ni precios del catálogo', () => {
    setup()
    goToArticles()
    expect(screen.queryByText(/\$/)).not.toBeInTheDocument()
    expect(screen.queryByText(/stock:/i)).not.toBeInTheDocument()
  })

  it('con sede, la observación es obligatoria', async () => {
    const register = setup()

    fireEvent.click(screen.getByRole('radio', { name: 'Una sede' }))
    fireEvent.click(screen.getByRole('radio', { name: /Sede Centro/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Continuar' }))

    // Sin observación se queda en el primer paso, con el error a la vista.
    expect(
      screen.getByText('Contanos para qué es: la observación es obligatoria.'),
    ).toBeInTheDocument()
    expect(screen.queryByText('Revisar retiro')).not.toBeInTheDocument()

    fireEvent.change(screen.getByLabelText('Observación del retiro'), {
      target: { value: 'Reposición de la semana' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Continuar' }))
    fireEvent.click(
      screen.getByRole('button', { name: 'Agregar Lavandina · 1 L' }),
    )
    fireEvent.click(
      screen.getByRole('button', { name: 'Revisar retiro (1 u.)' }),
    )
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Confirmar retiro' }))
      await Promise.resolve()
    })

    expect(register).toHaveBeenCalledWith({
      lines: [{ supplyId: 's1', qty: 1 }],
      shiftId: null,
      siteId: 'si1',
      note: 'Reposición de la semana',
    })
  })

  it('con ?turno= entra con el turno ya elegido, directo a los artículos', () => {
    setup({ entry: '/app/insumos/retirar?turno=sh1' })

    expect(screen.getAllByText('Lavandina').length).toBeGreaterThan(0)
    expect(
      screen.getByText(/Turno: Limpiadora SRL · Sede Centro/),
    ).toBeInTheDocument()
    expect(
      screen.queryByRole('radio', { name: /Limpiadora SRL · Sede Centro/ }),
    ).not.toBeInTheDocument()
  })

  it('si el turno de ?turno= no está entre las opciones, se queda en el primer paso', () => {
    setup({ entry: '/app/insumos/retirar?turno=otro' })

    expect(
      screen.getByRole('radio', { name: /Limpiadora SRL · Sede Centro/ }),
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Continuar' })).toBeDisabled()
  })

  it('el coordinador ve «Mis sedes» antes que «Otras sedes»', () => {
    setup({
      entry: '/sup/insumos/retirar',
      shiftOptions: [
        makeShiftOption({
          shiftId: 'a',
          clientName: 'Banco Sur',
          siteName: 'Casa Central',
        }),
        makeShiftOption({
          shiftId: 'b',
          clientName: 'Limpiadora SRL',
          siteName: 'Sede Centro',
          isPriority: true,
        }),
      ],
    })

    const mine = screen.getByText('Mis sedes')
    const others = screen.getByText('Otras sedes')
    expect(
      mine.compareDocumentPosition(others) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy()
  })

  it('el empleado, que no tiene sedes propias marcadas, ve una lista simple', () => {
    setup()
    expect(screen.queryByText('Mis sedes')).not.toBeInTheDocument()
    expect(screen.queryByText('Otras sedes')).not.toBeInTheDocument()
  })

  it('en la revisión, la cantidad se ajusta y un artículo se puede quitar', () => {
    setup({ entry: '/app/insumos/retirar?turno=sh1' })

    fireEvent.click(
      screen.getByRole('button', { name: 'Agregar Lavandina · 1 L' }),
    )
    fireEvent.click(
      screen.getByRole('button', { name: 'Revisar retiro (1 u.)' }),
    )
    fireEvent.click(
      screen.getByRole('button', { name: 'Quitar Lavandina · 1 L' }),
    )

    expect(
      screen.getByRole('button', { name: 'Confirmar retiro' }),
    ).toBeDisabled()
  })

  it('sin conexión avisa y no deja confirmar', () => {
    setup({ entry: '/app/insumos/retirar?turno=sh1', online: false })

    expect(
      screen.getByText(/Estás sin conexión: no podés registrar el retiro/),
    ).toBeInTheDocument()
    fireEvent.click(
      screen.getByRole('button', { name: 'Agregar Lavandina · 1 L' }),
    )
    fireEvent.click(
      screen.getByRole('button', { name: 'Revisar retiro (1 u.)' }),
    )
    expect(
      screen.getByRole('button', { name: 'Confirmar retiro' }),
    ).toBeDisabled()
  })

  it('muestra el mensaje del servidor cuando no alcanza el stock', async () => {
    const register = vi
      .fn()
      .mockRejectedValue(
        new ApiError(
          'No alcanza el stock de Lavandina. Consultá en la oficina.',
          'INSUFFICIENT_STOCK',
        ),
      )
    setup({ entry: '/app/insumos/retirar?turno=sh1', register })

    fireEvent.click(
      screen.getByRole('button', { name: 'Agregar Lavandina · 1 L' }),
    )
    fireEvent.click(
      screen.getByRole('button', { name: 'Revisar retiro (1 u.)' }),
    )
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Confirmar retiro' }))
      await Promise.resolve()
    })

    expect(
      await screen.findByText(
        'No alcanza el stock de Lavandina. Consultá en la oficina.',
      ),
    ).toBeInTheDocument()
    // Sigue en la revisión: se puede corregir y reintentar.
    expect(
      screen.getByRole('button', { name: 'Confirmar retiro' }),
    ).toBeEnabled()
  })
})
