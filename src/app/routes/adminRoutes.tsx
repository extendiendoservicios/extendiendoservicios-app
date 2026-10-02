import type { RouteObject } from 'react-router'
import { lazyPage } from './lazyPage'

/**
 * Rutas de `/admin` (DS-015), `05_Pantallas_y_Navegacion.md` sección 5. Los
 * parámetros de consulta que cambian de pantalla sin cambiar de ruta
 * (`?vista=`, `?pestana=`, `?fecha=`, `?cliente=`, `?sede=`) no generan una
 * ruta propia: quedan documentados acá, la lectura real de cada uno la
 * hace la pantalla cuando exista (front-admin).
 *
 * Faltan a propósito ADM-08 (drawer de ADM-06, sin URL propia), ADM-11
 * (drawer/diálogo de ADM-06/ADM-10) y ADM-24 (pestaña `?pestana=mapa` de
 * ADM-19): ninguno tiene una fila propia en la tabla de rutas de `05`
 * sección 5.
 */
export const adminRoutes: RouteObject[] = [
  {
    index: true,
    ...lazyPage(() => import('@/pages/admin/Dashboard')),
    handle: {
      screenId: 'ADM-02',
      title: 'Resumen',
      subtitle: 'Ver el estado de la operación de hoy',
    },
  },
  {
    path: 'planificacion',
    ...lazyPage(() => import('@/pages/admin/PlanningPage')),
    handle: {
      screenId: 'ADM-03',
      title: 'Planificación',
      subtitle: 'Ver y navegar el cronograma',
    },
  },
  {
    path: 'turnos/nuevo',
    ...lazyPage(() => import('@/pages/admin/ShiftFormPage')),
    handle: {
      screenId: 'ADM-07',
      title: 'Nuevo turno',
      subtitle: 'Crear un turno puntual',
    },
  },
  {
    path: 'turnos/generar',
    ...lazyPage(() => import('@/pages/admin/ShiftsGeneratePage')),
    handle: {
      screenId: 'ADM-09',
      title: 'Generar turnos del mes',
      subtitle: 'Ejecutar la generación mensual',
    },
  },
  {
    path: 'turnos/:id',
    ...lazyPage(() => import('@/pages/admin/ShiftDetailPage')),
    handle: {
      screenId: 'ADM-06',
      title: 'Detalle del turno',
      subtitle: 'Ver y operar sobre un turno',
    },
  },
  {
    path: 'turnos/:id/editar',
    ...lazyPage(() => import('@/pages/admin/ShiftFormPage')),
    handle: {
      screenId: 'ADM-07',
      title: 'Editar turno',
      subtitle: 'Editar el horario del turno',
    },
  },
  {
    path: 'asistencia',
    ...lazyPage(() => import('@/pages/admin/AttendanceTodayPage')),
    handle: {
      screenId: 'ADM-10',
      title: 'Asistencia de hoy',
      subtitle: 'Seguir en vivo quién está, quién avisó y quién no registró',
    },
  },
  {
    path: 'supervisiones',
    ...lazyPage(() => import('@/pages/admin/SupervisionsPage')),
    handle: {
      screenId: 'ADM-13',
      title: 'Supervisiones',
      subtitle: 'Consultar supervisiones y calificaciones',
    },
  },
  {
    path: 'supervisiones/nueva',
    ...lazyPage(() => import('@/pages/admin/AssignSupervisionPage')),
    handle: {
      screenId: 'ADM-14',
      title: 'Asignar supervisión',
      subtitle: 'Elegir turno y supervisor',
    },
  },
  {
    path: 'supervisiones/:id',
    ...lazyPage(() => import('@/pages/admin/SupervisionDetailPage')),
    handle: {
      screenId: 'ADM-15',
      title: 'Detalle de la supervisión',
      subtitle: 'Ver y editar una supervisión',
    },
  },
  {
    path: 'empleados',
    ...lazyPage(() => import('@/pages/admin/EmployeesPage')),
    handle: {
      screenId: 'ADM-16',
      title: 'Empleados',
      subtitle: 'Ver la dotación',
    },
  },
  {
    path: 'empleados/nuevo',
    ...lazyPage(() => import('@/pages/admin/EmployeeFormPage')),
    handle: {
      screenId: 'ADM-18',
      title: 'Nuevo empleado',
      subtitle: 'Alta de empleado o supervisor',
    },
  },
  {
    path: 'empleados/:id',
    ...lazyPage(() => import('@/pages/admin/EmployeeDetailPage')),
    handle: {
      screenId: 'ADM-17',
      title: 'Ficha del empleado',
      subtitle: 'Ver todo lo de una persona',
    },
  },
  {
    path: 'empleados/:id/editar',
    ...lazyPage(() => import('@/pages/admin/EmployeeFormPage')),
    handle: {
      screenId: 'ADM-18',
      title: 'Editar empleado',
      subtitle: 'Editar datos laborales y personales',
    },
  },
  {
    path: 'clientes',
    ...lazyPage(() => import('@/pages/admin/ClientsPage')),
    handle: {
      screenId: 'ADM-19',
      title: 'Clientes',
      subtitle: 'Ver clientes y sus sedes',
    },
  },
  {
    path: 'clientes/nuevo',
    ...lazyPage(() => import('@/pages/admin/ClientFormPage')),
    handle: {
      screenId: 'ADM-20',
      title: 'Nuevo cliente',
      subtitle: 'Alta de cliente',
    },
  },
  {
    path: 'clientes/:id',
    ...lazyPage(() => import('@/pages/admin/ClientDetailPage')),
    handle: {
      screenId: 'ADM-21',
      title: 'Detalle del cliente',
      subtitle: 'Ver sedes, contactos, servicios y plantilla',
    },
  },
  {
    path: 'clientes/:id/editar',
    ...lazyPage(() => import('@/pages/admin/ClientFormPage')),
    handle: {
      screenId: 'ADM-20',
      title: 'Editar cliente',
      subtitle: 'Editar datos del cliente',
    },
  },
  {
    path: 'sedes/:id',
    ...lazyPage(() => import('@/pages/admin/SiteDetailPage')),
    handle: {
      screenId: 'ADM-22',
      title: 'Detalle de la sede',
      subtitle: 'Ver la sede',
    },
  },
  {
    path: 'sedes/nueva',
    ...lazyPage(() => import('@/pages/admin/SiteFormPage')),
    handle: {
      screenId: 'ADM-23',
      title: 'Nueva sede',
      subtitle: 'Alta de sede',
    },
  },
  {
    path: 'sedes/:id/editar',
    ...lazyPage(() => import('@/pages/admin/SiteFormPage')),
    handle: {
      screenId: 'ADM-23',
      title: 'Editar sede',
      subtitle: 'Editar datos de la sede',
    },
  },
  {
    path: 'servicios/nuevo',
    ...lazyPage(() => import('@/pages/admin/ServiceFormPage')),
    handle: {
      screenId: 'ADM-25',
      title: 'Nuevo servicio',
      subtitle: 'Crear un servicio recurrente',
    },
  },
  {
    path: 'servicios/:id/editar',
    ...lazyPage(() => import('@/pages/admin/ServiceFormPage')),
    handle: {
      screenId: 'ADM-25',
      title: 'Editar servicio',
      subtitle: 'Editar un servicio recurrente',
    },
  },
  {
    path: 'tareas',
    ...lazyPage(() => import('@/pages/admin/TaskTemplatesPage')),
    handle: {
      screenId: 'ADM-26',
      title: 'Plantillas de tareas',
      subtitle: 'Definir checklists por cliente y por sede',
    },
  },
  {
    path: 'configuracion/usuarios',
    ...lazyPage(() => import('@/pages/admin/UsersPage')),
    handle: {
      screenId: 'ADM-27',
      title: 'Usuarios y roles',
      subtitle: 'Gestionar accesos',
    },
  },
  {
    path: 'configuracion/empresa',
    ...lazyPage(() => import('@/pages/admin/CompanySettingsPage')),
    handle: {
      screenId: 'ADM-28',
      title: 'Empresa',
      subtitle: 'Datos de la empresa',
    },
  },
  {
    path: 'configuracion/feriados',
    ...lazyPage(() => import('@/pages/admin/HolidaysPage')),
    handle: {
      screenId: 'ADM-29',
      title: 'Feriados',
      subtitle: 'Mantener el calendario',
    },
  },
  {
    path: 'configuracion/criterios',
    ...lazyPage(() => import('@/pages/admin/RatingCriteriaPage')),
    handle: {
      screenId: 'ADM-30',
      title: 'Criterios de calificación',
      subtitle: 'Mantener la guía de texto',
    },
  },
  {
    path: 'configuracion/seguridad',
    ...lazyPage(() => import('@/pages/admin/SecurityEventsPage')),
    handle: {
      screenId: 'ADM-31',
      title: 'Eventos de seguridad',
      subtitle: 'Consultar inicios de sesión y cambios de acceso',
    },
  },
]
