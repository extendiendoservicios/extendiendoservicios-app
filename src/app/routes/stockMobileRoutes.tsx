import type { RouteObject } from 'react-router'
import { lazyPage } from './lazyPage'

/**
 * Rutas de Insumos del celular (P25.4, módulo E, IS-33): las mismas pantallas
 * para el empleado (`/app/insumos`) y el coordinador (`/sup/insumos`). Cada
 * archivo de rutas de la vía las suma con una sola línea
 * (`...stockMobileRoutes`), así no se pisan con otros cambios.
 */
export const stockMobileRoutes: RouteObject[] = [
  {
    path: 'insumos',
    ...lazyPage(() => import('@/features/myStock/pages/SuppliesPage')),
    handle: {
      screenId: 'INS-01',
      title: 'Insumos',
      subtitle: 'Catálogo, retiros y avisos de faltante',
    },
  },
  {
    path: 'insumos/retirar',
    ...lazyPage(() => import('@/features/myStock/pages/WithdrawPage')),
    handle: {
      screenId: 'INS-02',
      title: 'Retirar insumos',
      subtitle: 'Elegí el turno y los artículos',
    },
  },
  {
    path: 'insumos/faltante',
    ...lazyPage(() => import('@/features/myStock/pages/ShortagePage')),
    handle: {
      screenId: 'INS-03',
      title: 'Avisar faltante',
      subtitle: 'Contanos qué insumo falta',
    },
  },
]
