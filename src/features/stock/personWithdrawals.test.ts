import { describe, expect, it } from 'vitest'
import { withdrawalsSaleTotal } from './personWithdrawals'
import { canManageStock, canViewPersonWithdrawals } from './permissions'

describe('withdrawalsSaleTotal: total a venta de los retiros (IS-18)', () => {
  it('suma lo vendido en valor positivo, aunque el retiro reste stock', () => {
    expect(
      withdrawalsSaleTotal([
        { totalSale: -300, voidedAt: null },
        { totalSale: -150.25, voidedAt: null },
      ]),
    ).toBe(450.25)
  })

  it('los retiros anulados no suman: la cantidad volvió al stock', () => {
    expect(
      withdrawalsSaleTotal([
        { totalSale: -300, voidedAt: null },
        { totalSale: -500, voidedAt: '2026-10-23T10:00:00Z' },
      ]),
    ).toBe(300)
  })

  it('sin retiros es cero', () => {
    expect(withdrawalsSaleTotal([])).toBe(0)
  })

  it('no arrastra decimales binarios', () => {
    expect(
      withdrawalsSaleTotal([
        { totalSale: -0.1, voidedAt: null },
        { totalSale: -0.2, voidedAt: null },
      ]),
    ).toBe(0.3)
  })
})

describe('permisos de la pestaña «Retiros» (IS-18, IS-20, IS-21)', () => {
  it('la ven el dueño y los administradores, tengan o no «Gestionar stock»', () => {
    expect(
      canViewPersonWithdrawals({ roles: ['owner'], capabilities: [] }),
    ).toBe(true)
    expect(
      canViewPersonWithdrawals({ roles: ['admin'], capabilities: [] }),
    ).toBe(true)
    expect(canManageStock({ roles: ['admin'], capabilities: [] })).toBe(false)
  })

  it('no la ven empleados ni coordinadores', () => {
    expect(
      canViewPersonWithdrawals({ roles: ['employee'], capabilities: [] }),
    ).toBe(false)
    expect(
      canViewPersonWithdrawals({ roles: ['supervisor'], capabilities: [] }),
    ).toBe(false)
    expect(
      canViewPersonWithdrawals({
        roles: ['employee', 'supervisor'],
        capabilities: ['manage_stock'],
      }),
    ).toBe(false)
  })
})
