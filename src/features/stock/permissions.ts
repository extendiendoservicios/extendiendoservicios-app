import type { AdminCapability, Role } from '@/api/users'

/**
 * Permisos de Insumos en administración (IS-19, IS-21). El servidor vuelve a
 * verificar (`app.require_capability('manage_stock')` en cada RPC de
 * escritura): acá solo se decide qué botones se muestran.
 *
 * Sin la capacidad, un administrador **ve** toda la sección (stock, precios,
 * movimientos) pero no ve los botones que mueven stock ni los que editan el
 * catálogo.
 */
export interface StockActor {
  roles: Role[]
  capabilities: AdminCapability[]
}

/**
 * Catálogo, categorías, precios, ingresos y devoluciones, ajustes (y, en
 * P25.3, anulaciones, retiros en nombre de otro y «Cargar control»): el dueño
 * siempre (capacidad implícita), el administrador con `manage_stock`.
 */
export function canManageStock(actor: StockActor): boolean {
  return (
    actor.roles.includes('owner') ||
    (actor.roles.includes('admin') &&
      actor.capabilities.includes('manage_stock'))
  )
}

/**
 * Pestaña «Retiros» de la ficha del empleado y del coordinador (IS-18): solo
 * dueño y administradores, sin pedir `manage_stock` (es una consulta, IS-21).
 * Empleados y coordinadores nunca ven precios ni retiros ajenos (IS-20).
 */
export function canViewPersonWithdrawals(actor: StockActor): boolean {
  return actor.roles.includes('owner') || actor.roles.includes('admin')
}
