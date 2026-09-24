import type { RouteObject } from 'react-router'
import ClientDetailPage from '@/pages/admin/ClientDetailPage'
import ClientFormPage from '@/pages/admin/ClientFormPage'
import ClientsPage from '@/pages/admin/ClientsPage'
import CompanySettingsPage from '@/pages/admin/CompanySettingsPage'
import EmployeeDetailPage from '@/pages/admin/EmployeeDetailPage'
import EmployeeFormPage from '@/pages/admin/EmployeeFormPage'
import EmployeesPage from '@/pages/admin/EmployeesPage'
import HolidaysPage from '@/pages/admin/HolidaysPage'
import RatingCriteriaPage from '@/pages/admin/RatingCriteriaPage'
import SecurityEventsPage from '@/pages/admin/SecurityEventsPage'
import SiteDetailPage from '@/pages/admin/SiteDetailPage'
import SiteFormPage from '@/pages/admin/SiteFormPage'
import UsersPage from '@/pages/admin/UsersPage'
import { placeholderRoute } from './placeholder'

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
  placeholderRoute({
    index: true,
    screenId: 'ADM-02',
    title: 'Resumen',
    subtitle: 'Ver el estado de la operación de hoy',
  }),
  placeholderRoute({
    path: 'planificacion',
    screenId: 'ADM-03',
    title: 'Planificación',
    subtitle: 'Ver y navegar el cronograma',
  }),
  placeholderRoute({
    path: 'turnos/nuevo',
    screenId: 'ADM-07',
    title: 'Nuevo turno',
    subtitle: 'Crear un turno puntual',
  }),
  placeholderRoute({
    path: 'turnos/generar',
    screenId: 'ADM-09',
    title: 'Generar turnos del mes',
    subtitle: 'Ejecutar la generación mensual',
  }),
  placeholderRoute({
    path: 'turnos/:id',
    screenId: 'ADM-06',
    title: 'Detalle del turno',
    subtitle: 'Ver y operar sobre un turno',
  }),
  placeholderRoute({
    path: 'turnos/:id/editar',
    screenId: 'ADM-07',
    title: 'Editar turno',
    subtitle: 'Editar franja y dotación',
  }),
  placeholderRoute({
    path: 'asistencia',
    screenId: 'ADM-10',
    title: 'Asistencia de hoy',
    subtitle: 'Seguir en vivo quién está, quién avisó y quién no registró',
  }),
  placeholderRoute({
    path: 'supervisiones',
    screenId: 'ADM-13',
    title: 'Supervisiones',
    subtitle: 'Consultar supervisiones y calificaciones',
  }),
  placeholderRoute({
    path: 'supervisiones/nueva',
    screenId: 'ADM-14',
    title: 'Asignar supervisión',
    subtitle: 'Elegir turno y supervisor',
  }),
  placeholderRoute({
    path: 'supervisiones/:id',
    screenId: 'ADM-15',
    title: 'Detalle de la supervisión',
    subtitle: 'Ver y editar una supervisión',
  }),
  {
    path: 'empleados',
    element: <EmployeesPage />,
    handle: {
      screenId: 'ADM-16',
      title: 'Empleados',
      subtitle: 'Ver la dotación',
    },
  },
  {
    path: 'empleados/nuevo',
    element: <EmployeeFormPage />,
    handle: {
      screenId: 'ADM-18',
      title: 'Nuevo empleado',
      subtitle: 'Alta de empleado o supervisor',
    },
  },
  {
    path: 'empleados/:id',
    element: <EmployeeDetailPage />,
    handle: {
      screenId: 'ADM-17',
      title: 'Ficha del empleado',
      subtitle: 'Ver todo lo de una persona',
    },
  },
  {
    path: 'empleados/:id/editar',
    element: <EmployeeFormPage />,
    handle: {
      screenId: 'ADM-18',
      title: 'Editar empleado',
      subtitle: 'Editar datos laborales y personales',
    },
  },
  {
    path: 'clientes',
    element: <ClientsPage />,
    handle: {
      screenId: 'ADM-19',
      title: 'Clientes',
      subtitle: 'Ver clientes y sus sedes',
    },
  },
  {
    path: 'clientes/nuevo',
    element: <ClientFormPage />,
    handle: {
      screenId: 'ADM-20',
      title: 'Nuevo cliente',
      subtitle: 'Alta de cliente',
    },
  },
  {
    path: 'clientes/:id',
    element: <ClientDetailPage />,
    handle: {
      screenId: 'ADM-21',
      title: 'Detalle del cliente',
      subtitle: 'Ver sedes, contactos, servicios y plantilla',
    },
  },
  {
    path: 'clientes/:id/editar',
    element: <ClientFormPage />,
    handle: {
      screenId: 'ADM-20',
      title: 'Editar cliente',
      subtitle: 'Editar datos del cliente',
    },
  },
  {
    path: 'sedes/:id',
    element: <SiteDetailPage />,
    handle: {
      screenId: 'ADM-22',
      title: 'Detalle de la sede',
      subtitle: 'Ver la sede',
    },
  },
  {
    path: 'sedes/nueva',
    element: <SiteFormPage />,
    handle: {
      screenId: 'ADM-23',
      title: 'Nueva sede',
      subtitle: 'Alta de sede',
    },
  },
  {
    path: 'sedes/:id/editar',
    element: <SiteFormPage />,
    handle: {
      screenId: 'ADM-23',
      title: 'Editar sede',
      subtitle: 'Editar datos de la sede',
    },
  },
  placeholderRoute({
    path: 'servicios/nuevo',
    screenId: 'ADM-25',
    title: 'Nuevo servicio',
    subtitle: 'Crear un servicio recurrente',
  }),
  placeholderRoute({
    path: 'servicios/:id/editar',
    screenId: 'ADM-25',
    title: 'Editar servicio',
    subtitle: 'Editar un servicio recurrente',
  }),
  placeholderRoute({
    path: 'tareas',
    screenId: 'ADM-26',
    title: 'Plantillas de tareas',
    subtitle: 'Definir checklists por cliente y por sede',
  }),
  {
    path: 'configuracion/usuarios',
    element: <UsersPage />,
    handle: {
      screenId: 'ADM-27',
      title: 'Usuarios y roles',
      subtitle: 'Gestionar accesos',
    },
  },
  {
    path: 'configuracion/empresa',
    element: <CompanySettingsPage />,
    handle: {
      screenId: 'ADM-28',
      title: 'Empresa',
      subtitle: 'Datos de la empresa',
    },
  },
  {
    path: 'configuracion/feriados',
    element: <HolidaysPage />,
    handle: {
      screenId: 'ADM-29',
      title: 'Feriados',
      subtitle: 'Mantener el calendario',
    },
  },
  {
    path: 'configuracion/criterios',
    element: <RatingCriteriaPage />,
    handle: {
      screenId: 'ADM-30',
      title: 'Criterios de calificación',
      subtitle: 'Mantener la guía de texto',
    },
  },
  {
    path: 'configuracion/seguridad',
    element: <SecurityEventsPage />,
    handle: {
      screenId: 'ADM-31',
      title: 'Eventos de seguridad',
      subtitle: 'Consultar inicios de sesión y cambios de acceso',
    },
  },
]
