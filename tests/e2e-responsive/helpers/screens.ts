// tests/e2e-responsive/helpers/screens.ts — RESP-003 (P17.2)
//
// Pantallas de administración que recorre la suite, con su ruta (`05_Pantallas_y_Navegacion.md`
// sección 5) y qué se espera de cada una en móvil. ADM-08 (asignar empleado) y ADM-11 (registrar
// en nombre de) no tienen ruta: son paneles que se abren desde ADM-06 y ADM-10 (los cubre
// `drawers.spec.ts`). ADM-12 y ADM-24 son pestañas de ADM-17 y ADM-19.

import type { ResponsiveData } from './fixtures.ts'

export const BASE_WIDTHS = [390, 768, 1024] as const
export const MAIN_WIDTHS = [390, 768, 1024, 1366, 1440] as const

export interface AdminScreen {
  /** Identificador del plan (ADM-xx) más el detalle cuando hay variantes. */
  id: string
  /** Ruta con consulta, ya resuelta con los datos del escenario. */
  path: (data: ResponsiveData) => string
  /** Una de las 20 pantallas principales: se recorre también a 1366 y 1440 px. */
  main: boolean
  /** Es un listado: en móvil tiene que mostrar tarjetas (RESP-005). */
  list?: boolean
}

export const OPERATION_SCREENS: AdminScreen[] = [
  { id: 'ADM-02', path: () => '/admin', main: true, list: true },
  {
    id: 'ADM-03-mes',
    path: () => '/admin/planificacion',
    main: true,
  },
  {
    id: 'ADM-04-semana',
    path: () => '/admin/planificacion?vista=semana',
    main: true,
  },
  {
    id: 'ADM-05-dia',
    path: () => '/admin/planificacion?vista=dia',
    main: true,
    list: true,
  },
  { id: 'ADM-06', path: (d) => `/admin/turnos/${d.shiftId}`, main: true },
  { id: 'ADM-07-nuevo', path: () => '/admin/turnos/nuevo', main: true },
  {
    id: 'ADM-07-editar',
    path: (d) => `/admin/turnos/${d.uncoveredShiftId}/editar`,
    main: false,
  },
  { id: 'ADM-09', path: () => '/admin/turnos/generar', main: false },
  { id: 'ADM-10', path: () => '/admin/asistencia', main: true, list: true },
  { id: 'ADM-13', path: () => '/admin/supervisiones', main: true, list: true },
  {
    id: 'ADM-13-calificaciones',
    path: () => '/admin/supervisiones?pestana=calificaciones',
    main: false,
  },
  { id: 'ADM-14', path: () => '/admin/supervisiones/nueva', main: false },
  {
    id: 'ADM-15',
    path: (d) => `/admin/supervisiones/${d.supervisionId}`,
    main: true,
  },
]

export const MANAGEMENT_SCREENS: AdminScreen[] = [
  { id: 'ADM-16', path: () => '/admin/empleados', main: true, list: true },
  { id: 'ADM-18-nuevo', path: () => '/admin/empleados/nuevo', main: false },
  {
    id: 'ADM-17-datos',
    path: (d) => `/admin/empleados/${d.employee.profileId}`,
    main: true,
  },
  {
    id: 'ADM-17-habilitaciones',
    path: (d) =>
      `/admin/empleados/${d.employee.profileId}?pestana=habilitaciones`,
    main: false,
  },
  {
    id: 'ADM-17-disponibilidad',
    path: (d) =>
      `/admin/empleados/${d.employee.profileId}?pestana=disponibilidad`,
    main: false,
  },
  {
    id: 'ADM-17-licencias',
    path: (d) => `/admin/empleados/${d.employee.profileId}?pestana=licencias`,
    main: false,
  },
  {
    id: 'ADM-17-proximos-turnos',
    path: (d) =>
      `/admin/empleados/${d.employee.profileId}?pestana=proximos-turnos`,
    main: false,
  },
  {
    id: 'ADM-12-asistencia',
    path: (d) => `/admin/empleados/${d.employee.profileId}?pestana=asistencia`,
    main: false,
  },
  {
    id: 'ADM-17-calificaciones',
    path: (d) =>
      `/admin/empleados/${d.employee.profileId}?pestana=calificaciones`,
    main: false,
  },
  {
    id: 'ADM-18-editar',
    path: (d) => `/admin/empleados/${d.employee.profileId}/editar`,
    main: false,
  },
  { id: 'ADM-19', path: () => '/admin/clientes', main: true, list: true },
  {
    id: 'ADM-24-mapa',
    path: () => '/admin/clientes?pestana=mapa',
    main: false,
  },
  { id: 'ADM-20-nuevo', path: () => '/admin/clientes/nuevo', main: false },
  {
    id: 'ADM-20-editar',
    path: (d) => `/admin/clientes/${d.clientId}/editar`,
    main: false,
  },
  {
    id: 'ADM-21-sedes',
    path: (d) => `/admin/clientes/${d.clientId}`,
    main: true,
  },
  {
    id: 'ADM-21-contactos',
    path: (d) => `/admin/clientes/${d.clientId}?pestana=contactos`,
    main: false,
  },
  {
    id: 'ADM-21-servicios',
    path: (d) => `/admin/clientes/${d.clientId}?pestana=servicios`,
    main: false,
  },
  {
    id: 'ADM-21-tareas',
    path: (d) => `/admin/clientes/${d.clientId}?pestana=tareas`,
    main: false,
  },
  { id: 'ADM-22', path: (d) => `/admin/sedes/${d.siteId}`, main: true },
  {
    id: 'ADM-23-nueva',
    path: (d) => `/admin/sedes/nueva?cliente=${d.clientId}`,
    main: false,
  },
  {
    id: 'ADM-23-editar',
    path: (d) => `/admin/sedes/${d.siteId}/editar`,
    main: false,
  },
  {
    id: 'ADM-25-nuevo',
    path: (d) =>
      `/admin/servicios/nuevo?cliente=${d.clientId}&sede=${d.siteId}`,
    main: false,
  },
  {
    id: 'ADM-25-editar',
    path: (d) => `/admin/servicios/${d.serviceId}/editar`,
    main: false,
  },
  {
    id: 'ADM-26',
    path: (d) => `/admin/tareas?cliente=${d.clientId}&sede=${d.siteId}`,
    main: true,
  },
  {
    id: 'ADM-27',
    path: () => '/admin/configuracion/usuarios',
    main: true,
    list: true,
  },
  { id: 'ADM-28', path: () => '/admin/configuracion/empresa', main: true },
  {
    id: 'ADM-29',
    path: () => '/admin/configuracion/feriados',
    main: true,
  },
  {
    id: 'ADM-30',
    path: () => '/admin/configuracion/criterios',
    main: true,
  },
  {
    id: 'ADM-31',
    path: () => '/admin/configuracion/seguridad',
    main: true,
  },
]

export const ALL_ADMIN_SCREENS = [...OPERATION_SCREENS, ...MANAGEMENT_SCREENS]

export interface MobileScreen {
  id: string
  who: 'employee' | 'working' | 'supervisor'
  path: (data: ResponsiveData) => string
}

/** Pantallas de empleado (`/app`) y supervisor (`/sup`) para la pasada rápida a 390 px. */
export const MOBILE_SCREENS: MobileScreen[] = [
  { id: 'EMP-03-hoy', who: 'employee', path: () => '/app' },
  {
    id: 'EMP-servicio',
    who: 'employee',
    path: (d) => `/app/servicio/${d.assignmentId}`,
  },
  { id: 'EMP-fichar', who: 'employee', path: () => '/app/fichar' },
  { id: 'EMP-avisar', who: 'employee', path: () => '/app/avisar' },
  { id: 'EMP-mas', who: 'employee', path: () => '/app/mas' },
  { id: 'COM-perfil', who: 'employee', path: () => '/perfil' },
  { id: 'EMP-hoy-en-curso', who: 'working', path: () => '/app' },
  {
    id: 'EMP-en-curso',
    who: 'working',
    path: (d) => `/app/en-curso/${d.workingAssignmentId}`,
  },
  {
    id: 'EMP-tareas',
    who: 'working',
    path: (d) => `/app/en-curso/${d.workingAssignmentId}/tareas`,
  },
  {
    id: 'EMP-observaciones',
    who: 'working',
    path: (d) => `/app/en-curso/${d.workingAssignmentId}/observaciones`,
  },
  {
    id: 'EMP-finalizar',
    who: 'working',
    path: (d) => `/app/en-curso/${d.workingAssignmentId}/finalizar`,
  },
  { id: 'SUP-02-hoy', who: 'supervisor', path: () => '/sup' },
  {
    id: 'SUP-supervisiones',
    who: 'supervisor',
    path: () => '/sup/supervisiones',
  },
  {
    id: 'SUP-detalle',
    who: 'supervisor',
    path: (d) => `/sup/supervisiones/${d.supervisionId}`,
  },
  { id: 'SUP-historial', who: 'supervisor', path: () => '/sup/historial' },
  { id: 'SUP-mas', who: 'supervisor', path: () => '/sup/mas' },
]
