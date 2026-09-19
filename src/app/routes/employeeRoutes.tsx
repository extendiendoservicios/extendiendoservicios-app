import type { RouteObject } from 'react-router'
import { placeholderRoute } from './placeholder'

/**
 * Rutas de `/app` (DS-015), `05_Pantallas_y_Navegacion.md` sección 5.
 *
 * EMP-05 ("Registrar inicio") no tiene ruta propia: comparte `/app/fichar`
 * con EMP-14 (el mapa de navegación de `05` sección 6 los muestra como un
 * único nodo, "EMP-14 Fichar (tab) → EMP-05 | EMP-07" — la pantalla real
 * decide ahí mismo si registra el inicio o redirige a "en curso").
 */
export const employeeRoutes: RouteObject[] = [
  placeholderRoute({
    index: true,
    screenId: 'EMP-03',
    title: 'Hoy',
    subtitle: 'Ver la jornada de hoy y los próximos días',
  }),
  placeholderRoute({
    path: 'servicio/:assignmentId',
    screenId: 'EMP-04',
    title: 'Detalle del servicio',
    subtitle: 'Saber dónde, cuándo y qué hacer',
  }),
  placeholderRoute({
    path: 'fichar',
    screenId: 'EMP-14',
    title: 'Fichar',
    subtitle: 'Registrar inicio (EMP-05) o ir al servicio en curso (EMP-07)',
  }),
  placeholderRoute({
    path: 'fichar/consentimiento',
    screenId: 'EMP-06',
    title: 'Consentimiento de ubicación',
    subtitle: 'Explicar y pedir permiso',
  }),
  placeholderRoute({
    path: 'en-curso/:assignmentId',
    screenId: 'EMP-07',
    title: 'Servicio en curso',
    subtitle: 'Seguir el servicio activo',
  }),
  placeholderRoute({
    path: 'en-curso/:assignmentId/tareas',
    screenId: 'EMP-08',
    title: 'Tareas',
    subtitle: 'Marcar el estado de cada tarea',
  }),
  placeholderRoute({
    path: 'en-curso/:assignmentId/observaciones',
    screenId: 'EMP-09',
    title: 'Observaciones',
    subtitle: 'Cargar la observación del servicio',
  }),
  placeholderRoute({
    path: 'en-curso/:assignmentId/finalizar',
    screenId: 'EMP-10',
    title: 'Finalizar servicio',
    subtitle: 'Fichar el fin',
  }),
  placeholderRoute({
    path: 'resumen/:assignmentId',
    screenId: 'EMP-11',
    title: 'Resumen del servicio',
    subtitle: 'Comprobante del turno',
  }),
  placeholderRoute({
    path: 'avisar',
    screenId: 'EMP-12',
    title: 'Avisar demora o ausencia',
    subtitle: 'Avisar antes del turno',
  }),
  placeholderRoute({
    path: 'mas',
    screenId: 'EMP-13',
    title: 'Más',
    subtitle: 'Acceso a perfil y opciones',
  }),
]
