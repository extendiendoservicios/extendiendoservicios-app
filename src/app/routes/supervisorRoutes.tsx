import type { RouteObject } from 'react-router'
import SupervisorTodayPage from '@/pages/sup/TodayPage'
import SupervisionsPage from '@/pages/sup/SupervisionsPage'
import SupervisionDetailPage from '@/pages/sup/SupervisionDetailPage'
import SupervisionAttendancePage from '@/pages/sup/SupervisionAttendancePage'
import RateEmployeePage from '@/pages/sup/RateEmployeePage'
import CloseSupervisionPage from '@/pages/sup/CloseSupervisionPage'
import HistoryPage from '@/pages/sup/HistoryPage'
import SupervisorMorePage from '@/pages/sup/MorePage'

/**
 * Rutas de `/sup` (DS-015), `05_Pantallas_y_Navegacion.md` sección 5.
 *
 * SUP-02, SUP-03, SUP-04, SUP-07 y SUP-09 son de P15.4 (MOB-SUP-002 a
 * MOB-SUP-005 y MOB-SUP-009). SUP-05, SUP-06 y SUP-08 son de este paquete
 * (P15.5, MOB-SUP-006/007/008).
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
  {
    path: 'supervisiones/:id/registro',
    element: <SupervisionAttendancePage />,
    handle: {
      screenId: 'SUP-04',
      title: 'Inicio y fin de supervisión',
      subtitle: 'Registrá la jornada en la sede',
    },
  },
  {
    path: 'supervisiones/:id/calificar/:assignmentId',
    element: <RateEmployeePage />,
    handle: {
      screenId: 'SUP-05',
      title: 'Calificar empleado',
      subtitle: 'Puntuar y comentar a un empleado del turno',
    },
  },
  {
    path: 'supervisiones/:id/cerrar',
    element: <CloseSupervisionPage />,
    handle: {
      screenId: 'SUP-06',
      title: 'Cerrar supervisión',
      subtitle: 'Completar o marcar no realizada',
    },
  },
  {
    path: 'historial',
    element: <HistoryPage />,
    handle: {
      screenId: 'SUP-08',
      title: 'Historial',
      subtitle: 'Consultar las supervisiones que ya cargó',
    },
  },
  {
    path: 'mas',
    element: <SupervisorMorePage />,
    handle: {
      screenId: 'SUP-09',
      title: 'Más',
      subtitle: 'Perfil y opciones',
    },
  },
]
