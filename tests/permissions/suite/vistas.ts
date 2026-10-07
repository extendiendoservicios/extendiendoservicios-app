// tests/permissions/suite/vistas.ts — TEST-019 (P18.3)
//
// La matriz de las vistas `v_*` (`04_Modelo_de_Datos.md` sección 4: todas `security_invoker`, es
// decir, ven lo que ven las políticas RLS de las tablas base) y el esperado por perfil.
// Mismo vocabulario que `tablas.ts`. `anon` solo lee `v_public_branding`.

import type { Contexto } from './contexto.ts'
import type { Perfil } from './perfiles.ts'
import type { Ve } from './tablas.ts'

export interface VistaSpec {
  vista: string
  clave: string
  /** Filas plantadas por nombre → valor de la columna clave. Vacío en `v_public_branding`. */
  filas: (c: Contexto) => Record<string, string>
  ve: Record<Perfil, Ve>
  /**
   * Vista que depende de la sesión (de "lo mío", que filtra por `auth.uid()`, o de
   * `app.is_admin()`): con la clave de servicio no hay `auth.uid()` y da cero filas (o un 403,
   * como en `v_employee_ratings`), así que no sirve para comprobar que la vista tiene datos; lo
   * prueba la fila que sí ve quien corresponde en la propia matriz.
   */
  propia?: boolean
}

function ven(
  base: Partial<Record<Perfil, Ve>>,
  porDefecto: Ve = 'nada',
): Record<Perfil, Ve> {
  return {
    anon: 'denegado',
    empleado: porDefecto,
    supervisor: porDefecto,
    dual: porDefecto,
    adminSin: porDefecto,
    admin: porDefecto,
    owner: porDefecto,
    ...base,
  }
}

const admins: Record<'adminSin' | 'admin' | 'owner', Ve> = {
  adminSin: 'todo',
  admin: 'todo',
  owner: 'todo',
}

export const VISTAS: VistaSpec[] = [
  {
    vista: 'v_public_branding',
    clave: 'name',
    filas: () => ({}),
    // Se prueba aparte: una sola fila con tres columnas, para todos, `anon` incluido.
    ve: {
      anon: 'todo',
      empleado: 'todo',
      supervisor: 'todo',
      dual: 'todo',
      adminSin: 'todo',
      admin: 'todo',
      owner: 'todo',
    },
  },
  {
    vista: 'v_employees',
    clave: 'profile_id',
    filas: (c) => ({
      empleado1: c.ids.empleado1,
      empleado2: c.ids.empleado2,
      empleado3: c.ids.empleado3,
      empleado4: c.ids.empleado4,
      supervisor1: c.ids.supervisor1,
      supervisor2: c.ids.supervisor2,
      dual: c.ids.dual,
    }),
    // Desde P18.6 (0030, DEF-P04) el supervisor no lee la ficha de los empleados de su turno.
    ve: ven({
      empleado: ['empleado1'],
      supervisor: ['supervisor1'],
      dual: ['dual'],
      ...admins,
    }),
  },
  {
    vista: 'v_shifts_board',
    clave: 'id',
    filas: (c) => ({
      turnoA: c.e.turnoA,
      turnoB: c.e.turnoB,
      turnoD: c.e.turnoD,
    }),
    // Desde P18.6 (0030, DEF-P05) el empleado no lee `clients` y la vista los une por cliente:
    // no la ve. Para el empleado, Hoy es `v_my_day`.
    ve: ven({
      supervisor: ['turnoA'],
      dual: ['turnoD'],
      ...admins,
    }),
  },
  {
    vista: 'v_assignments_board',
    clave: 'id',
    filas: (c) => ({
      asigE1: c.e.asigE1,
      asigE2: c.e.asigE2,
      asigE3: c.e.asigE3,
      asigE4: c.e.asigE4,
      asigDual: c.e.asigDual,
    }),
    // Desde P18.6 (0030) la vista une `clients` y `profiles` de cada persona asignada: el empleado
    // y el supervisor ya no ven filas ajenas (el tablero es de administración; ellos usan
    // `v_my_day`, `v_my_supervisions` y `v_shift_peers`). El doble rol solo ve la propia.
    ve: ven({
      dual: ['asigDual'],
      ...admins,
    }),
  },
  {
    // "Mi" día: solo las asignaciones propias (hoy y los próximos 7 días).
    vista: 'v_my_day',
    propia: true,
    clave: 'assignment_id',
    filas: (c) => ({
      asigE1: c.e.asigE1,
      asigE2: c.e.asigE2,
      asigE3: c.e.asigE3,
      asigE4: c.e.asigE4,
      asigDual: c.e.asigDual,
    }),
    ve: ven({ empleado: ['asigE1'], dual: ['asigDual'] }),
  },
  {
    vista: 'v_supervisions_admin',
    clave: 'id',
    filas: (c) => ({ supA: c.e.supA, supB: c.e.supB, supD: c.e.supD }),
    ve: ven({ supervisor: ['supA'], dual: ['supD'], ...admins }),
  },
  {
    // "Mis" supervisiones: solo las propias, también para el administrador.
    vista: 'v_my_supervisions',
    propia: true,
    clave: 'id',
    filas: (c) => ({ supA: c.e.supA, supB: c.e.supB, supD: c.e.supD }),
    ve: ven({ supervisor: ['supA'], dual: ['supD'] }),
  },
  {
    vista: 'v_people_basic',
    clave: 'profile_id',
    filas: (c) => ({ ...c.ids }),
    ve: ven({
      empleado: ['empleado1', 'empleado2'],
      supervisor: ['supervisor1', 'empleado1', 'empleado2'],
      dual: ['dual', 'empleado4'],
      ...admins,
    }),
  },
  {
    vista: 'v_clients',
    clave: 'id',
    filas: (c) => ({ clienteA: c.e.clienteA, clienteB: c.e.clienteB }),
    // Desde P18.6 (0030, DEF-P05) el empleado no lee `clients` (CUIT, domicilio, notas).
    ve: ven({
      supervisor: ['clienteA'],
      dual: ['clienteB'],
      ...admins,
    }),
  },
  {
    // Nueva en 0030 (DEF-P05): el nombre del cliente de sus turnos, sin CUIT ni notas.
    vista: 'v_clients_basic',
    clave: 'id',
    filas: (c) => ({ clienteA: c.e.clienteA, clienteB: c.e.clienteB }),
    ve: ven({
      empleado: ['clienteA'],
      supervisor: ['clienteA'],
      dual: ['clienteB'],
      ...admins,
    }),
  },
  {
    // Nueva en 0030 (DEF-P06): quiénes están en los turnos que comparto o superviso, con nombre y
    // foto. Administración no la usa (tiene `v_assignments_board`): la ve vacía.
    vista: 'v_shift_peers',
    propia: true,
    clave: 'profile_id',
    filas: (c) => ({ ...c.ids }),
    ve: ven({
      empleado: ['empleado1', 'empleado2'],
      supervisor: ['empleado1', 'empleado2'],
      dual: ['dual', 'empleado4'],
    }),
  },
  {
    // Nueva en 0033 (P19.5a): cantidad y promedio de calificaciones por empleado. Solo dueño y
    // administradores (como las calificaciones, P-084); el supervisor y el empleado no ven filas.
    vista: 'v_employee_ratings',
    propia: true,
    clave: 'employee_id',
    filas: (c) => ({
      empleado1: c.ids.empleado1,
      empleado2: c.ids.empleado2,
      empleado3: c.ids.empleado3,
      empleado4: c.ids.empleado4,
      supervisor1: c.ids.supervisor1,
      supervisor2: c.ids.supervisor2,
      dual: c.ids.dual,
    }),
    ve: ven({ ...admins }),
  },
  {
    vista: 'v_search',
    clave: 'id',
    filas: (c) => ({
      empleado1: c.ids.empleado1,
      empleado2: c.ids.empleado2,
      empleado3: c.ids.empleado3,
      empleado4: c.ids.empleado4,
      supervisor1: c.ids.supervisor1,
      dual: c.ids.dual,
      clienteA: c.e.clienteA,
      clienteB: c.e.clienteB,
      sedeA: c.e.sedeA,
      sedeB: c.e.sedeB,
    }),
    // Desde P18.6 (0030): el buscador es de administración. El empleado solo se encuentra a sí
    // mismo (la sede se une por cliente y no lo ve); el supervisor, a sí mismo y a sus clientes.
    ve: ven({
      empleado: ['empleado1'],
      supervisor: ['supervisor1', 'clienteA', 'sedeA'],
      dual: ['dual', 'clienteB', 'sedeB'],
      ...admins,
    }),
  },
]
