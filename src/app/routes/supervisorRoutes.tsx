import type { RouteObject } from 'react-router'
import { placeholderRoute } from './placeholder'
import SupervisorTodayPage from '@/pages/sup/TodayPage'
import SupervisionsPage from '@/pages/sup/SupervisionsPage'
import SupervisionDetailPage from '@/pages/sup/SupervisionDetailPage'

/**
 * Rutas de `/sup` (DS-015), `05_Pantallas_y_Navegacion.md` sección 5.
 *
 * SUP-02, SUP-03 y SUP-07 son de este paquete (P15.4, MOB-SUP-002 a
 * MOB-SUP-004): el resto sigue como placeholder hasta que se construya cada
 * pantalla (SUP-04/09 más adelante en este mismo paquete; SUP-05/06/08 en
 * P15.5).
 */
export const supervisorRoutes: RouteObject[] = [
  {
    index: true,
    element: <SupervisorTodayPage />,
    handle: {
      screenId: 'SUP-02',
      title: 'Hoy',
      subtitle: 'Tus supervisiones del día',
    },
  },
  {
    path: 'supervisiones',
    element: <SupervisionsPage />,
    handle: {
      screenId: 'SUP-07',
      title: 'Supervisiones',
      subtitle: 'Todas las asignadas pendientes',
    },
  },
  {
    path: 'supervisiones/:id',
    element: <SupervisionDetailPage />,
    handle: {
      screenId: 'SUP-03',
      title: 'Detalle de la supervisión',
      subtitle: 'Servicio, sede y personal a supervisar',
    },
  },
  placeholderRoute({
    path: 'supervisiones/:id/registro',
    screenId: 'SUP-04',
    title: 'Inicio y fin de supervisión',
    subtitle: 'Registrar la jornada en la sede',
  }),
  placeholderRoute({
    path: 'supervisiones/:id/calificar/:assignmentId',
    screenId: 'SUP-05',
    title: 'Calificar empleado',
    subtitle: 'Puntuar y comentar a un empleado del turno',
  }),
  placeholderRoute({
    path: 'supervisiones/:id/cerrar',
    screenId: 'SUP-06',
    title: 'Cerrar supervisión',
    subtitle: 'Completar o marcar no realizada',
  }),
  placeholderRoute({
    path: 'historial',
    screenId: 'SUP-08',
    title: 'Historial',
    subtitle: 'Consultar las supervisiones que ya cargó',
  }),
  placeholderRoute({
    path: 'mas',
    screenId: 'SUP-09',
    title: 'Más',
    subtitle: 'Perfil y opciones',
  }),
]
