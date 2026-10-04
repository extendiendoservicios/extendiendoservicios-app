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
   * Vista de "lo mío" (filtra por `auth.uid()`): con la clave de servicio no hay `auth.uid()` y
   * da cero filas, así que no sirve para comprobar que la vista tiene datos; lo prueba la fila
   * que sí ve su dueño en la propia matriz.
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
    ve: ven({
      empleado: ['empleado1'],
      supervisor: ['supervisor1', 'empleado1', 'empleado2'],
      dual: ['dual', 'empleado4'],
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
    ve: ven({
      empleado: ['turnoA'],
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
    ve: ven({
      empleado: ['asigE1', 'asigE2'],
      supervisor: ['asigE1', 'asigE2'],
      dual: ['asigE4', 'asigDual'],
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
    ve: ven({
      empleado: ['clienteA'],
      supervisor: ['clienteA'],
      dual: ['clienteB'],
      ...admins,
    }),
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
    ve: ven({
      empleado: ['empleado1', 'clienteA', 'sedeA'],
      supervisor: [
        'supervisor1',
        'empleado1',
        'empleado2',
        'clienteA',
        'sedeA',
      ],
      dual: ['dual', 'empleado4', 'clienteB', 'sedeB'],
      ...admins,
    }),
  },
]
