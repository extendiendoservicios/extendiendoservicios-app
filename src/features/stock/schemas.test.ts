import { describe, expect, it } from 'vitest'
import type { StockItem } from '@/api/stock'
import {
  buildAdjustSchema,
  adjustValuesToDelta,
  categorySchema,
  entrySchema,
  entryValuesToInput,
  findCostDifferences,
  pricesValuesToInput,
  supplyCreateSchema,
  supplyEditSchema,
  supplyPricesSchema,
  supplyValuesToInput,
} from './schemas'

function item(overrides: Partial<StockItem> = {}): StockItem {
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

const validCreate = {
  code: 'QUI-001',
  name: 'Lavandina',
  presentation: '1 L',
  categoryId: 'c1',
  minQty: '5',
  costPrice: '1.250,50',
  salePrice: '1800',
  notes: '',
}

describe('supplyCreateSchema', () => {
  it('acepta un artículo completo y lo pasa al API con precios numéricos', () => {
    const parsed = supplyCreateSchema.parse(validCreate)
    const input = supplyValuesToInput(parsed)
    expect(input).toMatchObject({
      code: 'QUI-001',
      name: 'Lavandina',
      presentation: '1 L',
      minQty: 5,
      costPrice: 1250.5,
      salePrice: 1800,
      notes: null,
    })
    expect(input.id).toBeUndefined()
  })

  it('el mínimo es opcional: vacío es «sin aviso» (null)', () => {
    const parsed = supplyCreateSchema.parse({ ...validCreate, minQty: '' })
    expect(supplyValuesToInput(parsed).minQty).toBeNull()
  })

  it('el mínimo en cero es válido y no es lo mismo que sin mínimo', () => {
    const parsed = supplyCreateSchema.parse({ ...validCreate, minQty: '0' })
    expect(supplyValuesToInput(parsed).minQty).toBe(0)
  })

  it.each([
    ['code', ''],
    ['name', '   '],
    ['categoryId', ''],
  ])('pide %s', (field, value) => {
    const result = supplyCreateSchema.safeParse({
      ...validCreate,
      [field]: value,
    })
    expect(result.success).toBe(false)
  })

  it.each(['-1', '2,5', 'abc'])('rechaza el mínimo %s', (minQty) => {
    expect(
      supplyCreateSchema.safeParse({ ...validCreate, minQty }).success,
    ).toBe(false)
  })

  it.each(['', '-5', '1,234', 'abc', '10,5,5'])(
    'rechaza el precio de costo %s',
    (costPrice) => {
      const result = supplyCreateSchema.safeParse({ ...validCreate, costPrice })
      expect(result.success).toBe(false)
    },
  )

  it('acepta precio cero (mayor o igual a cero, IS-34)', () => {
    expect(
      supplyCreateSchema.safeParse({
        ...validCreate,
        costPrice: '0',
        salePrice: '0,00',
      }).success,
    ).toBe(true)
  })

  it('la edición no lleva precios y manda el id', () => {
    const { costPrice: _c, salePrice: _s, ...rest } = validCreate
    const parsed = supplyEditSchema.parse(rest)
    const input = supplyValuesToInput(parsed, 's1')
    expect(input.id).toBe('s1')
    expect(input.costPrice).toBeUndefined()
    expect(input.salePrice).toBeUndefined()
  })
})

describe('supplyPricesSchema', () => {
  it('pasa los textos argentinos a número', () => {
    const parsed = supplyPricesSchema.parse({
      costPrice: '$ 1.234,5',
      salePrice: '2000',
    })
    expect(pricesValuesToInput(parsed)).toEqual({
      costPrice: 1234.5,
      salePrice: 2000,
    })
  })

  it('rechaza negativos y más de dos decimales', () => {
    expect(
      supplyPricesSchema.safeParse({ costPrice: '-1', salePrice: '1' }).success,
    ).toBe(false)
    expect(
      supplyPricesSchema.safeParse({ costPrice: '1', salePrice: '1,999' })
        .success,
    ).toBe(false)
  })
})

describe('buildAdjustSchema (IS-10)', () => {
  const base = {
    sign: '+' as const,
    qty: '3',
    reason: 'count' as const,
    note: '',
  }

  it('acepta + con motivo y sin nota', () => {
    const parsed = buildAdjustSchema(10).parse(base)
    expect(adjustValuesToDelta(parsed)).toBe(3)
  })

  it('el − da una cantidad negativa', () => {
    const parsed = buildAdjustSchema(10).parse({ ...base, sign: '-' })
    expect(adjustValuesToDelta(parsed)).toBe(-3)
  })

  it('el motivo es obligatorio', () => {
    const result = buildAdjustSchema(10).safeParse({ ...base, reason: '' })
    expect(result.success).toBe(false)
  })

  it('con «Otro» la nota es obligatoria', () => {
    const schema = buildAdjustSchema(10)
    const without = schema.safeParse({ ...base, reason: 'other', note: '  ' })
    expect(without.success).toBe(false)
    if (!without.success) {
      expect(without.error.issues[0]?.path).toEqual(['note'])
    }
    expect(
      schema.safeParse({ ...base, reason: 'other', note: 'Se regaló' }).success,
    ).toBe(true)
  })

  it('con otro motivo la nota es opcional', () => {
    for (const reason of ['count', 'breakage', 'expired', 'data_error']) {
      expect(buildAdjustSchema(10).safeParse({ ...base, reason }).success).toBe(
        true,
      )
    }
  })

  it('la cantidad es un entero mayor a cero', () => {
    for (const qty of ['', '0', '-2', '1,5', 'x']) {
      expect(
        buildAdjustSchema(10).safeParse({ ...base, qty }).success,
        qty,
      ).toBe(false)
    }
  })

  it('no deja restar más de lo que hay', () => {
    const schema = buildAdjustSchema(4)
    expect(schema.safeParse({ ...base, sign: '-', qty: '5' }).success).toBe(
      false,
    )
    expect(schema.safeParse({ ...base, sign: '-', qty: '4' }).success).toBe(
      true,
    )
    // Sumar no tiene tope.
    expect(schema.safeParse({ ...base, sign: '+', qty: '500' }).success).toBe(
      true,
    )
  })
})

describe('entrySchema (IS-09)', () => {
  const base = {
    kind: 'entry' as const,
    lines: [{ supplyId: 's1', qty: '10', unitCost: '' }],
    supplier: '',
    documentNumber: '',
    note: '',
  }

  it('acepta un ingreso sin proveedor, comprobante ni observación', () => {
    expect(entrySchema.safeParse(base).success).toBe(true)
  })

  it('pide al menos un artículo', () => {
    const result = entrySchema.safeParse({ ...base, lines: [] })
    expect(result.success).toBe(false)
  })

  it('la cantidad es obligatoria, entera y mayor a cero', () => {
    for (const qty of ['', '0', '-1', '2,5']) {
      expect(
        entrySchema.safeParse({
          ...base,
          lines: [{ supplyId: 's1', qty, unitCost: '' }],
        }).success,
        qty,
      ).toBe(false)
    }
  })

  it('no acepta el mismo artículo dos veces', () => {
    const result = entrySchema.safeParse({
      ...base,
      lines: [
        { supplyId: 's1', qty: '1', unitCost: '' },
        { supplyId: 's1', qty: '2', unitCost: '' },
      ],
    })
    expect(result.success).toBe(false)
  })

  it('el costo unitario, si se carga, tiene que ser un monto válido', () => {
    expect(
      entrySchema.safeParse({
        ...base,
        lines: [{ supplyId: 's1', qty: '1', unitCost: '-3' }],
      }).success,
    ).toBe(false)
  })

  it('entryValuesToInput manda update_cost solo donde se contestó «Sí»', () => {
    const parsed = entrySchema.parse({
      ...base,
      kind: 'return',
      lines: [
        { supplyId: 's1', qty: '10', unitCost: '120' },
        { supplyId: 's2', qty: '1', unitCost: '50' },
        { supplyId: 's3', qty: '4', unitCost: '' },
      ],
      supplier: ' Distribuidora ',
    })
    const input = entryValuesToInput(parsed, new Set(['s1', 's3']))
    expect(input.kind).toBe('return')
    expect(input.supplier).toBe('Distribuidora')
    expect(input.documentNumber).toBeNull()
    expect(input.lines).toEqual([
      { supplyId: 's1', qty: 10, unitCost: 120, updateCost: true },
      { supplyId: 's2', qty: 1, unitCost: 50, updateCost: false },
      // Sin costo cargado nunca se actualiza nada, aunque estuviera en el conjunto.
      { supplyId: 's3', qty: 4, unitCost: null, updateCost: false },
    ])
  })
})

describe('findCostDifferences (IS-23)', () => {
  const items = new Map([
    ['s1', item({ id: 's1', costPrice: 100 })],
    ['s2', item({ id: 's2', code: 'DES-002', name: 'Bolsa', costPrice: 25.5 })],
  ])

  it('pregunta solo por las líneas con costo distinto del vigente', () => {
    const differences = findCostDifferences(
      [
        { supplyId: 's1', qty: '1', unitCost: '120' },
        { supplyId: 's2', qty: '1', unitCost: '25,50' },
      ],
      items,
    )
    expect(differences).toHaveLength(1)
    expect(differences[0]).toMatchObject({
      supplyId: 's1',
      currentCost: 100,
      enteredCost: 120,
    })
  })

  it('sin costo cargado no pregunta nada', () => {
    expect(
      findCostDifferences([{ supplyId: 's1', qty: '1', unitCost: '' }], items),
    ).toEqual([])
  })

  it('un costo igual al vigente (con otro formato) no pregunta', () => {
    expect(
      findCostDifferences(
        [{ supplyId: 's1', qty: '1', unitCost: '100,00' }],
        items,
      ),
    ).toEqual([])
  })

  it('ignora artículos que no están en el catálogo cargado', () => {
    expect(
      findCostDifferences([{ supplyId: 'zz', qty: '1', unitCost: '5' }], items),
    ).toEqual([])
  })
})

describe('categorySchema', () => {
  it('pide un nombre', () => {
    expect(categorySchema.safeParse({ name: '  ' }).success).toBe(false)
    expect(categorySchema.safeParse({ name: 'Químicos' }).success).toBe(true)
  })
})
