import type { RouteObject } from 'react-router'
import { lazyPage } from './lazyPage'
import { stockMobileRoutes } from './stockMobileRoutes'

/**
 * Rutas de `/sup` (DS-015), `05_Pantallas_y_Navegacion.md` sección 5.
 *
 * SUP-02, SUP-07 y SUP-09 son de P15.4 (MOB-SUP-002/003/009). SUP-05, SUP-06
 * y SUP-08 son de P15.5 (MOB-SUP-006/007/008).
 *
 * P24.2 (coordinación libre y jornada): SUP-03 pasa a ser el detalle del turno
 * (`turnos/:shiftId`, con «Supervisar»), SUP-04 es la supervisión en curso
 * (`supervisiones/:id`, con «Descartar» y «Cerrar») y desaparece la ruta
 * `/registro`: el inicio y el fin se registran al tomar y al cerrar.
 */
export const supervisorRoutes: RouteObject[] = [
  {
    index: true,
    ...lazyPage(() => import('@/pages/sup/TodayPage')),
    handle: {
      screenId: 'SUP-02',
      title: 'Hoy',
      subtitle: 'Tu jornada y los turnos del día',
    },
  },
  {
    path: 'turnos/:shiftId',
    ...lazyPage(() => import('@/pages/sup/SupervisorShiftPage')),
    handle: {
      screenId: 'SUP-03',
      title: 'Detalle del turno',
      subtitle: 'Servicio, sede y personal del turno',
    },
  },
  {
    path: 'supervisiones',
    ...lazyPage(() => import('@/pages/sup/SupervisionsPage')),
    handle: {
      screenId: 'SUP-07',
      title: 'Supervisiones',
      subtitle: 'Las que tenés abiertas',
    },
  },
  {
    path: 'supervisiones/:id',
    ...lazyPage(() => import('@/pages/sup/SupervisionDetailPage')),
    handle: {
      screenId: 'SUP-04',
      title: 'Supervisión',
      subtitle: 'Calificá al personal y cerrá la supervisión',
    },
  },
  {
    path: 'supervisiones/:id/calificar/:assignmentId',
    ...lazyPage(() => import('@/pages/sup/RateEmployeePage')),
    handle: {
      screenId: 'SUP-05',
      title: 'Calificar empleado',
      subtitle: 'Puntuar y comentar a un empleado del turno',
    },
  },
  {
    path: 'supervisiones/:id/cerrar',
    ...lazyPage(() => import('@/pages/sup/CloseSupervisionPage')),
    handle: {
      screenId: 'SUP-06',
      title: 'Cerrar supervisión',
      subtitle: 'Registrá el fin de la supervisión',
    },
  },
  {
    path: 'historial',
    ...lazyPage(() => import('@/pages/sup/HistoryPage')),
    handle: {
      screenId: 'SUP-08',
      title: 'Historial',
      subtitle: 'Tus jornadas y supervisiones',
    },
  },
  {
    path: 'anuncios',
    ...lazyPage(() => import('@/pages/sup/AnnouncementsPage')),
    handle: {
      screenId: 'SUP-ANU',
      title: 'Anuncios',
      subtitle: 'Lo que publica administración',
    },
  },
  // Insumos (P25.4, módulo E): mismas pantallas para los dos roles.
  ...stockMobileRoutes,
  {
    path: 'mas',
    ...lazyPage(() => import('@/pages/sup/MorePage')),
    handle: {
      screenId: 'SUP-09',
      title: 'Más',
      subtitle: 'Perfil y opciones',
    },
  },
]
