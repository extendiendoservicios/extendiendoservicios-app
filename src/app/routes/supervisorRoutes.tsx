import type { RouteObject } from 'react-router'
import { placeholderRoute } from './placeholder'

/** Rutas de `/sup` (DS-015), `05_Pantallas_y_Navegacion.md` sección 5. */
export const supervisorRoutes: RouteObject[] = [
  placeholderRoute({
    index: true,
    screenId: 'SUP-02',
    title: 'Hoy',
    subtitle: 'Ver las supervisiones del día',
  }),
  placeholderRoute({
    path: 'supervisiones',
    screenId: 'SUP-07',
    title: 'Supervisiones',
    subtitle: 'Todas las asignadas pendientes',
  }),
  placeholderRoute({
    path: 'supervisiones/:id',
    screenId: 'SUP-03',
    title: 'Detalle de la supervisión',
    subtitle: 'Ver servicio, sede y personal a supervisar',
  }),
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
