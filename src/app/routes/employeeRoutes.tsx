import type { RouteObject } from 'react-router'
import TodayPage from '@/pages/app/TodayPage'
import ServiceDetailPage from '@/pages/app/ServiceDetailPage'
import ClockTabPage from '@/pages/app/ClockTabPage'
import LocationConsentPage from '@/pages/app/LocationConsentPage'
import MorePage from '@/pages/app/MorePage'
import { placeholderRoute } from './placeholder'

/**
 * Rutas de `/app` (DS-015), `05_Pantallas_y_Navegacion.md` sección 5.
 *
 * EMP-05 ("Registrar inicio") no tiene ruta propia: comparte `/app/fichar`
 * con EMP-14 (el mapa de navegación de `05` sección 6 los muestra como un
 * único nodo, "EMP-14 Fichar (tab) → EMP-05 | EMP-07" — la pantalla real
 * decide ahí mismo si registra el inicio o redirige a "en curso").
 * `ClockTabPage` (P13.2) ya resuelve esa decisión completa salvo el botón
 * real de "Registrar inicio" (`record_check_in`, P13.3): ver el comentario
 * grande de ese archivo.
 */
export const employeeRoutes: RouteObject[] = [
  {
    index: true,
    element: <TodayPage />,
    handle: {
      screenId: 'EMP-03',
      title: 'Hoy',
      subtitle: 'Tu jornada de hoy y los próximos días',
    },
  },
  {
    path: 'servicio/:assignmentId',
    element: <ServiceDetailPage />,
    handle: {
      screenId: 'EMP-04',
      title: 'Detalle del servicio',
      subtitle: 'Dónde, cuándo y qué hacer',
    },
  },
  {
    path: 'fichar',
    element: <ClockTabPage />,
    handle: {
      screenId: 'EMP-14',
      title: 'Fichar',
      subtitle: 'Registrá el inicio o seguí tu servicio en curso',
    },
  },
  {
    path: 'fichar/consentimiento',
    element: <LocationConsentPage />,
    handle: {
      screenId: 'EMP-06',
      title: 'Consentimiento de ubicación',
      subtitle: 'Tu ubicación al registrar',
    },
  },
  placeholderRoute({
    path: 'en-curso/:assignmentId',
    screenId: 'EMP-07',
    title: 'Servicio en curso',
    subtitle: 'Tu servicio activo',
  }),
  placeholderRoute({
    path: 'en-curso/:assignmentId/tareas',
    screenId: 'EMP-08',
    title: 'Tareas',
    subtitle: 'Marcá cada tarea',
  }),
  placeholderRoute({
    path: 'en-curso/:assignmentId/observaciones',
    screenId: 'EMP-09',
    title: 'Observaciones',
    subtitle: 'Contá cómo fue el servicio',
  }),
  placeholderRoute({
    path: 'en-curso/:assignmentId/finalizar',
    screenId: 'EMP-10',
    title: 'Finalizar servicio',
    subtitle: 'Registrá el fin',
  }),
  placeholderRoute({
    path: 'resumen/:assignmentId',
    screenId: 'EMP-11',
    title: 'Resumen del servicio',
    subtitle: 'Comprobante del servicio',
  }),
  placeholderRoute({
    path: 'avisar',
    screenId: 'EMP-12',
    title: 'Avisar demora o ausencia',
    subtitle: 'Avisá antes del servicio',
  }),
  {
    path: 'mas',
    element: <MorePage />,
    handle: {
      screenId: 'EMP-13',
      title: 'Más',
      subtitle: 'Tu perfil y opciones',
    },
  },
]
