import type { RouteObject } from 'react-router'
import { lazyPage } from './lazyPage'

/**
 * Rutas de `/app` (DS-015), `05_Pantallas_y_Navegacion.md` sección 5.
 *
 * EMP-05 ("Registrar inicio") no tiene ruta propia: comparte `/app/fichar`
 * con EMP-14 (el mapa de navegación de `05` sección 6 los muestra como un
 * único nodo, "EMP-14 Fichar (tab) → EMP-05 | EMP-07" — la pantalla real
 * decide ahí mismo si registra el inicio o redirige a "en curso").
 * `ClockTabPage` resuelve esa decisión completa, botón real de "Registrar
 * inicio" incluido (`record_check_in`, MOB-EMP-007): ver el comentario
 * grande de ese archivo.
 */
export const employeeRoutes: RouteObject[] = [
  {
    index: true,
    ...lazyPage(() => import('@/pages/app/TodayPage')),
    handle: {
      screenId: 'EMP-03',
      title: 'Hoy',
      subtitle: 'Tu jornada de hoy y los próximos días',
    },
  },
  {
    path: 'servicio/:assignmentId',
    ...lazyPage(() => import('@/pages/app/ServiceDetailPage')),
    handle: {
      screenId: 'EMP-04',
      title: 'Detalle del servicio',
      subtitle: 'Dónde, cuándo y qué hacer',
    },
  },
  {
    path: 'fichar',
    ...lazyPage(() => import('@/pages/app/ClockTabPage')),
    handle: {
      screenId: 'EMP-14',
      title: 'Fichar',
      subtitle: 'Registrá el inicio o seguí tu servicio en curso',
    },
  },
  {
    path: 'fichar/consentimiento',
    ...lazyPage(() => import('@/pages/app/LocationConsentPage')),
    handle: {
      screenId: 'EMP-06',
      title: 'Consentimiento de ubicación',
      subtitle: 'Tu ubicación al registrar',
    },
  },
  {
    path: 'en-curso/:assignmentId',
    ...lazyPage(() => import('@/pages/app/InProgressPage')),
    handle: {
      screenId: 'EMP-07',
      title: 'Servicio en curso',
      subtitle: 'Tu servicio activo',
    },
  },
  {
    path: 'en-curso/:assignmentId/tareas',
    ...lazyPage(() => import('@/pages/app/TasksPage')),
    handle: {
      screenId: 'EMP-08',
      title: 'Tareas',
      subtitle: 'Marcá cada tarea',
    },
  },
  {
    path: 'en-curso/:assignmentId/observaciones',
    ...lazyPage(() => import('@/pages/app/NotesPage')),
    handle: {
      screenId: 'EMP-09',
      title: 'Observaciones',
      subtitle: 'Contá cómo fue el servicio',
    },
  },
  {
    path: 'en-curso/:assignmentId/finalizar',
    ...lazyPage(() => import('@/pages/app/FinishPage')),
    handle: {
      screenId: 'EMP-10',
      title: 'Finalizar servicio',
      subtitle: 'Registrá el fin',
    },
  },
  {
    path: 'resumen/:assignmentId',
    ...lazyPage(() => import('@/pages/app/SummaryPage')),
    handle: {
      screenId: 'EMP-11',
      title: 'Resumen del servicio',
      subtitle: 'Comprobante del servicio',
    },
  },
  {
    path: 'avisar',
    ...lazyPage(() => import('@/pages/app/NotifyPage')),
    handle: {
      screenId: 'EMP-12',
      title: 'Avisar demora o ausencia',
      subtitle: 'Avisá antes del servicio',
    },
  },
  {
    path: 'anuncios',
    ...lazyPage(() => import('@/pages/app/AnnouncementsPage')),
    handle: {
      screenId: 'EMP-ANU',
      title: 'Anuncios',
      subtitle: 'Lo que publica administración',
    },
  },
  {
    path: 'mas',
    ...lazyPage(() => import('@/pages/app/MorePage')),
    handle: {
      screenId: 'EMP-13',
      title: 'Más',
      subtitle: 'Tu perfil y opciones',
    },
  },
]
