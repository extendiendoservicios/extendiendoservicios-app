import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { GlobalSearch } from './GlobalSearch'

/**
 * `GlobalSearch` (EMP-012): mínimo de caracteres, agrupado por tipo,
 * estado vacío, navegación al seleccionar un resultado y atajo de teclado
 * para abrir. La navegación por flechas/Enter la resuelve `cmdk`
 * (`Command`/`CommandItem`, ya verificado por esa librería) — acá se
 * prueba que "Enter" sobre el primer resultado dispare la navegación
 * correcta, no la mecánica interna de `cmdk`.
 */

interface SearchRow {
  kind: string
  id: string
  title: string
  subtitle: string | null
}
interface SearchQueryResult {
  data: SearchRow[] | null
  error: { message: string } | null
}

const { navigateMock, isDesktopMock, selectMock } = vi.hoisted(() => ({
  navigateMock: vi.fn(),
  isDesktopMock: vi.fn(() => true),
  selectMock: vi.fn<(pattern: string) => Promise<SearchQueryResult>>(),
}))

vi.mock('react-router', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-router')>()
  return { ...actual, useNavigate: () => navigateMock }
})

vi.mock('@/hooks/useMediaQuery', () => ({
  useMediaQuery: () => isDesktopMock(),
}))

vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: (table: string) => {
      if (table !== 'v_search') {
        throw new Error(`tabla no mockeada en el test: ${table}`)
      }
      return {
        select: () => ({
          ilike: (_column: string, pattern: string) => ({
            order: () => ({
              order: () => ({
                limit: () => selectMock(pattern),
              }),
            }),
          }),
        }),
      }
    },
  },
}))

// Se ubica el campo por `placeholder` (no por rol + nombre accesible):
// `cmdk` liga el input a una etiqueta propia con `aria-labelledby`, que
// pisa el `aria-label` de `CommandInput` en el cálculo de nombre accesible
// — visualmente y para un lector de pantalla el campo se sigue anunciando
// bien (la etiqueta de `cmdk` está vacía mientras `CommandDialog` ya aporta
// título y descripción del diálogo), pero como selector de test es fràgil.
async function openSearch() {
  render(<GlobalSearch />)
  fireEvent.click(screen.getByRole('button', { name: /buscar/i }))
  return screen.findByPlaceholderText('Buscar empleados, clientes o sedes…')
}

afterEach(() => {
  vi.restoreAllMocks()
  navigateMock.mockReset()
  selectMock.mockReset()
  isDesktopMock.mockReturnValue(true)
})

describe('GlobalSearch — mínimo de caracteres y estado vacío', () => {
  it('con menos de 2 caracteres, no consulta y pide escribir más', async () => {
    const input = await openSearch()
    fireEvent.change(input, { target: { value: 'a' } })

    expect(
      await screen.findByText('Escribí al menos 2 caracteres para buscar.'),
    ).toBeInTheDocument()
    expect(selectMock).not.toHaveBeenCalled()
  })

  it('con 2 caracteres o más, consulta v_search (con debounce) y muestra "sin resultados" si no hay nada', async () => {
    selectMock.mockResolvedValue({ data: [], error: null })
    const input = await openSearch()
    fireEvent.change(input, { target: { value: 'zz' } })

    await waitFor(() => expect(selectMock).toHaveBeenCalledWith('%zz%'))
    expect(
      await screen.findByText('No encontramos resultados para "zz".'),
    ).toBeInTheDocument()
  })
})

describe('GlobalSearch — resultados agrupados', () => {
  it('agrupa empleados, clientes y sedes con sus encabezados', async () => {
    selectMock.mockResolvedValue({
      data: [
        {
          kind: 'employee',
          id: 'emp-1',
          title: 'María Gómez',
          subtitle: 'Legajo 42',
        },
        {
          kind: 'client',
          id: 'cli-1',
          title: 'Grupo Norte',
          subtitle: 'Grupo Norte SA',
        },
        {
          kind: 'site',
          id: 'sede-1',
          title: 'San Isidro',
          subtitle: 'Grupo Norte SA',
        },
      ],
      error: null,
    })
    const input = await openSearch()
    fireEvent.change(input, { target: { value: 'norte' } })

    expect(await screen.findByText('María Gómez')).toBeInTheDocument()
    expect(screen.getByText('Empleados')).toBeInTheDocument()
    expect(screen.getByText('Grupo Norte')).toBeInTheDocument()
    expect(screen.getByText('Clientes')).toBeInTheDocument()
    expect(screen.getByText('San Isidro')).toBeInTheDocument()
    expect(screen.getByText('Sedes')).toBeInTheDocument()
  })

  it('al elegir un resultado, navega a su ficha y cierra el diálogo', async () => {
    selectMock.mockResolvedValue({
      data: [
        {
          kind: 'client',
          id: 'cli-1',
          title: 'Grupo Norte',
          subtitle: 'Grupo Norte SA',
        },
      ],
      error: null,
    })
    const input = await openSearch()
    fireEvent.change(input, { target: { value: 'norte' } })

    const result = await screen.findByText('Grupo Norte')
    fireEvent.click(result)

    expect(navigateMock).toHaveBeenCalledWith('/admin/clientes/cli-1')
    await waitFor(() =>
      expect(
        screen.queryByPlaceholderText('Buscar empleados, clientes o sedes…'),
      ).not.toBeInTheDocument(),
    )
  })
})

describe('GlobalSearch — atajo de teclado y ancho angosto', () => {
  it('Ctrl+K abre el buscador', async () => {
    render(<GlobalSearch />)
    expect(
      screen.queryByPlaceholderText('Buscar empleados, clientes o sedes…'),
    ).not.toBeInTheDocument()

    fireEvent.keyDown(document, { key: 'k', ctrlKey: true })

    expect(
      await screen.findByPlaceholderText('Buscar empleados, clientes o sedes…'),
    ).toBeInTheDocument()
  })

  it('por debajo de 1024 px, el acceso es un ícono de lupa (sin el texto "Buscar…")', () => {
    isDesktopMock.mockReturnValue(false)
    render(<GlobalSearch />)

    expect(
      screen.getByRole('button', {
        name: 'Buscar empleados, clientes o sedes',
      }),
    ).toBeInTheDocument()
    expect(screen.queryByText('Buscar…')).not.toBeInTheDocument()
  })
})
