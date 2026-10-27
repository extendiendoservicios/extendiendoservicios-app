import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { StockItem } from '@/api/stock'
import { testItem } from '@/features/stock/testSupport'
import { SupplyFormScreen } from './SupplyFormScreen'

type SaveArg = {
  input: Record<string, unknown>
  image: { action: string; blob?: Blob; currentPath: string | null }
}

const { authState, itemState, saveMock, toastMock, compressMock } = vi.hoisted(
  () => ({
    authState: { roles: ['owner'] as string[], capabilities: [] as string[] },
    itemState: { data: undefined as StockItem | undefined },
    saveMock: vi.fn<(arg: SaveArg) => unknown>(),
    toastMock: { success: vi.fn(), error: vi.fn() },
    compressMock: vi.fn(),
  }),
)

vi.mock('sonner', () => ({ toast: toastMock }))
vi.mock('@/features/auth/AuthProvider', () => ({ useAuth: () => authState }))
vi.mock('@/features/stock/image', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/features/stock/image')>()),
  compressSupplyImage: compressMock,
}))
vi.mock('@/features/stock/queries', () => ({
  useStockItemQuery: () => ({ data: itemState.data, isLoading: false }),
  useSupplyCategoriesQuery: () => ({
    data: [
      { id: 'c1', name: 'Químicos', sortOrder: 0, active: true },
      { id: 'c2', name: 'Descartables', sortOrder: 1, active: true },
      { id: 'c9', name: 'Vieja', sortOrder: 2, active: false },
    ],
    isLoading: false,
  }),
  useSupplyImageUrls: () => new Map<string, string>(),
  useSaveSupplyMutation: () => ({ mutateAsync: saveMock, isPending: false }),
}))

function renderForm(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/admin/insumos/nuevo" element={<SupplyFormScreen />} />
        <Route
          path="/admin/insumos/:id/editar"
          element={<SupplyFormScreen />}
        />
        <Route path="/admin/insumos/:id" element={<p>Ficha abierta</p>} />
      </Routes>
    </MemoryRouter>,
  )
}

function fill(label: string | RegExp, value: string) {
  fireEvent.change(screen.getByLabelText(label), { target: { value } })
}

function chooseCategory(name: string) {
  fireEvent.click(screen.getByRole('combobox', { name: 'Categoría' }))
  fireEvent.click(screen.getByRole('option', { name }))
}

beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn()
  authState.roles = ['owner']
  authState.capabilities = []
  itemState.data = undefined
  saveMock.mockReset()
  saveMock.mockResolvedValue({ id: 'abc', code: 'QUI-001', imagePath: null })
  toastMock.success.mockReset()
  toastMock.error.mockReset()
  compressMock.mockReset()
})

describe('SupplyFormScreen: nuevo artículo', () => {
  it('pide código, nombre, categoría y los dos precios', async () => {
    renderForm('/admin/insumos/nuevo')
    fireEvent.click(screen.getByRole('button', { name: 'Cargar artículo' }))
    expect(
      await screen.findByText('Indicá el código interno.'),
    ).toBeInTheDocument()
    expect(
      screen.getByText('Indicá el nombre del artículo.'),
    ).toBeInTheDocument()
    expect(screen.getByText('Elegí una categoría.')).toBeInTheDocument()
    expect(screen.getByText('Indicá el precio de costo.')).toBeInTheDocument()
    expect(screen.getByText('Indicá el precio de venta.')).toBeInTheDocument()
    expect(saveMock).not.toHaveBeenCalled()
  })

  it('solo ofrece categorías activas', () => {
    renderForm('/admin/insumos/nuevo')
    fireEvent.click(screen.getByRole('combobox', { name: 'Categoría' }))
    expect(screen.getByRole('option', { name: 'Químicos' })).toBeInTheDocument()
    expect(screen.queryByRole('option', { name: /Vieja/ })).toBeNull()
  })

  it('guarda con precios numéricos, mínimo opcional vacío y sin imagen, y abre la ficha', async () => {
    renderForm('/admin/insumos/nuevo')
    fill('Código interno', ' QUI-001 ')
    fill('Artículo', 'Lavandina')
    fill(/Presentación/, '1 L')
    chooseCategory('Químicos')
    fill('Precio de costo ($)', '1.250,50')
    fill('Precio de venta ($)', '1800')
    fireEvent.click(screen.getByRole('button', { name: 'Cargar artículo' }))

    await waitFor(() => expect(saveMock).toHaveBeenCalledTimes(1))
    expect(saveMock).toHaveBeenCalledWith({
      input: {
        id: undefined,
        code: 'QUI-001',
        name: 'Lavandina',
        presentation: '1 L',
        categoryId: 'c1',
        minQty: null,
        costPrice: 1250.5,
        salePrice: 1800,
        notes: null,
      },
      image: { action: 'keep', blob: undefined, currentPath: null },
    })
    expect(await screen.findByText('Ficha abierta')).toBeInTheDocument()
  })

  it('el mínimo se manda como número cuando se carga', async () => {
    renderForm('/admin/insumos/nuevo')
    fill('Código interno', 'A-1')
    fill('Artículo', 'Algo')
    chooseCategory('Químicos')
    fill(/Stock mínimo/, '5')
    fill('Precio de costo ($)', '0')
    fill('Precio de venta ($)', '0')
    fireEvent.click(screen.getByRole('button', { name: 'Cargar artículo' }))
    await waitFor(() => expect(saveMock).toHaveBeenCalledTimes(1))
    expect(saveMock.mock.calls[0]?.[0].input.minQty).toBe(5)
  })

  it('rechaza un mínimo negativo o con decimales y un precio con tres decimales', async () => {
    renderForm('/admin/insumos/nuevo')
    fill('Código interno', 'A-1')
    fill('Artículo', 'Algo')
    chooseCategory('Químicos')
    fill(/Stock mínimo/, '-2')
    fill('Precio de costo ($)', '1,999')
    fill('Precio de venta ($)', '10')
    fireEvent.click(screen.getByRole('button', { name: 'Cargar artículo' }))
    expect(
      await screen.findByText(
        'El mínimo tiene que ser un número entero, cero o mayor.',
      ),
    ).toBeInTheDocument()
    expect(
      screen.getByText(
        'Escribí un monto válido, con hasta dos decimales (por ejemplo 1.250,50).',
      ),
    ).toBeInTheDocument()
    expect(saveMock).not.toHaveBeenCalled()
  })

  it('un código repetido se marca en el campo con el mensaje del servidor', async () => {
    const { ApiError } = await import('@/api/errors')
    saveMock.mockRejectedValue(
      new ApiError(
        'Ya existe un artículo con ese código.',
        'CODE_ALREADY_EXISTS',
      ),
    )
    renderForm('/admin/insumos/nuevo')
    fill('Código interno', 'qui-001')
    fill('Artículo', 'Lavandina')
    chooseCategory('Químicos')
    fill('Precio de costo ($)', '1')
    fill('Precio de venta ($)', '1')
    fireEvent.click(screen.getByRole('button', { name: 'Cargar artículo' }))
    expect(
      await screen.findByText('Ya existe un artículo con ese código.', {
        selector: '[data-slot="field-error"], p, div, span',
      }),
    ).toBeInTheDocument()
    expect(toastMock.error).toHaveBeenCalledWith(
      'Ya existe un artículo con ese código.',
    )
  })

  it('con una imagen elegida, la comprime y la manda para subir al guardar', async () => {
    const compressed = new Blob(['webp'], { type: 'image/webp' })
    compressMock.mockResolvedValue(compressed)
    vi.stubGlobal('URL', {
      ...URL,
      createObjectURL: vi.fn(() => 'blob:preview'),
      revokeObjectURL: vi.fn(),
    })
    renderForm('/admin/insumos/nuevo')
    const file = new File(['x'], 'foto.png', { type: 'image/png' })
    fireEvent.change(
      screen.getByLabelText('Elegir archivo de imagen del artículo'),
      { target: { files: [file] } },
    )
    await screen.findByRole('button', { name: 'Cambiar imagen' })
    expect(compressMock).toHaveBeenCalledWith(file)

    fill('Código interno', 'A-1')
    fill('Artículo', 'Algo')
    chooseCategory('Químicos')
    fill('Precio de costo ($)', '1')
    fill('Precio de venta ($)', '1')
    fireEvent.click(screen.getByRole('button', { name: 'Cargar artículo' }))
    await waitFor(() => expect(saveMock).toHaveBeenCalledTimes(1))
    expect(saveMock.mock.calls[0]?.[0].image).toEqual({
      action: 'replace',
      blob: compressed,
      currentPath: null,
    })
    vi.unstubAllGlobals()
  })

  it('un archivo que no es imagen se rechaza en español, sin comprimir', async () => {
    renderForm('/admin/insumos/nuevo')
    fireEvent.change(
      screen.getByLabelText('Elegir archivo de imagen del artículo'),
      {
        target: {
          files: [new File(['x'], 'a.pdf', { type: 'application/pdf' })],
        },
      },
    )
    await waitFor(() =>
      expect(toastMock.error).toHaveBeenCalledWith(
        'La imagen tiene que ser un archivo JPG, PNG o WEBP.',
      ),
    )
    expect(compressMock).not.toHaveBeenCalled()
  })
})

describe('SupplyFormScreen: editar artículo', () => {
  beforeEach(() => {
    itemState.data = testItem({
      id: 's1',
      code: 'QUI-001',
      name: 'Lavandina',
      presentation: '1 L',
      minQty: 5,
      imagePath: 's1/a.webp',
      notes: 'Con tapa',
    })
  })

  it('precarga los datos y no muestra los precios (se cambian desde la ficha)', () => {
    renderForm('/admin/insumos/s1/editar')
    expect(screen.getByLabelText('Código interno')).toHaveValue('QUI-001')
    expect(screen.getByLabelText('Artículo')).toHaveValue('Lavandina')
    expect(screen.getByLabelText(/Stock mínimo/)).toHaveValue('5')
    expect(screen.queryByLabelText('Precio de costo ($)')).toBeNull()
    expect(screen.queryByLabelText('Precio de venta ($)')).toBeNull()
    expect(screen.getByText(/«Cambiar precios»/)).toBeInTheDocument()
  })

  it('guarda con el id y la ruta de la imagen vigente', async () => {
    renderForm('/admin/insumos/s1/editar')
    fill('Artículo', 'Lavandina concentrada')
    fireEvent.click(screen.getByRole('button', { name: 'Guardar cambios' }))
    await waitFor(() => expect(saveMock).toHaveBeenCalledTimes(1))
    const call = saveMock.mock.calls[0]?.[0] as SaveArg
    expect(call.input).toMatchObject({
      id: 's1',
      name: 'Lavandina concentrada',
      minQty: 5,
      notes: 'Con tapa',
    })
    expect(call.input.costPrice).toBeUndefined()
    expect(call.image).toEqual({
      action: 'keep',
      blob: undefined,
      currentPath: 's1/a.webp',
    })
  })

  it('«Quitar imagen» manda la acción remove', async () => {
    renderForm('/admin/insumos/s1/editar')
    fireEvent.click(screen.getByRole('button', { name: 'Quitar imagen' }))
    fireEvent.click(screen.getByRole('button', { name: 'Guardar cambios' }))
    await waitFor(() => expect(saveMock).toHaveBeenCalledTimes(1))
    expect(saveMock.mock.calls[0]?.[0].image).toMatchObject({
      action: 'remove',
      currentPath: 's1/a.webp',
    })
  })

  it('artículo inexistente: mensaje en español', () => {
    itemState.data = undefined
    renderForm('/admin/insumos/zz/editar')
    expect(screen.getByText('No encontramos este artículo')).toBeInTheDocument()
  })
})

describe('SupplyFormScreen: permisos (IS-21)', () => {
  it('un administrador sin «Gestionar stock» no puede cargar ni editar', () => {
    authState.roles = ['admin']
    renderForm('/admin/insumos/nuevo')
    expect(
      screen.getByText('No tenés permiso para cargar ni editar artículos'),
    ).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Cargar artículo' })).toBeNull()
  })

  it('un administrador con «Gestionar stock» sí', () => {
    authState.roles = ['admin']
    authState.capabilities = ['manage_stock']
    renderForm('/admin/insumos/nuevo')
    expect(
      screen.getByRole('button', { name: 'Cargar artículo' }),
    ).toBeInTheDocument()
  })
})
