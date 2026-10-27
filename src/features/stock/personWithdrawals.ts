import type { MovementGroup } from './movements'

/**
 * Total a venta de los retiros de una persona en el período (pestaña
 * «Retiros» de la ficha, IS-18). Los retiros anulados no suman: la cantidad
 * volvió al stock.
 */
export function withdrawalsSaleTotal(
  withdrawals: readonly Pick<MovementGroup, 'totalSale' | 'voidedAt'>[],
): number {
  const cents = withdrawals.reduce(
    (sum, movement) =>
      movement.voidedAt ? sum : sum + Math.round(-movement.totalSale * 100),
    0,
  )
  return cents / 100
}
