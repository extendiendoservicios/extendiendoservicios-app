import { vi } from 'vitest'
import type { StockItem } from '@/api/stock'

/**
 * Apoyo común de los tests de Insumos: el ancho de pantalla (`DataTable`
 * decide tabla o tarjetas con `useMediaQuery`) y un artículo de prueba.
 */
export function mockViewport(isDesktop: boolean) {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: isDesktop,
    media: query,
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }))
}

export function testItem(overrides: Partial<StockItem> = {}): StockItem {
  return {
    id: 's1',
    code: 'QUI-001',
    name: 'Lavandina',
    presentation: '1 L',
    categoryId: 'c1',
    categoryName: 'Químicos',
    categorySortOrder: 0,
    imagePath: null,
    minQty: 5,
    costPrice: 100,
    salePrice: 150,
    stockQty: 10,
    stockValue: 1000,
    status: 'ok',
    active: true,
    notes: null,
    updatedAt: null,
    ...overrides,
  }
}
