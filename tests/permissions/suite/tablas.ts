// tests/permissions/suite/tablas.ts — TEST-019 (P18.3)
//
// La matriz de las 25 tablas de `public`: qué ve cada perfil (lectura) y qué puede insertar,
// actualizar y borrar. Es el esperado del PLAN (`04_Modelo_de_Datos.md` sección 7.2 y
// `03_Plan_Maestro_Tecnico.md` sección 6), no lo que el código hace hoy; donde la implementación
// se aparta, el test correspondiente queda marcado como defecto en `defectos.ts`.
//
// Vocabulario de la lectura (`ve`):
//   'todo'      ve todas las filas plantadas de la tabla.
//   'nada'      la tabla entera vuelve vacía (se pide sin filtro: cero filas).
//   'denegado'  error de permisos (los grants de `anon` están revocados).
//   [claves]    ve exactamente esas filas plantadas y ninguna otra de las plantadas.

import { randomUUID } from 'node:crypto'
import type { Contexto } from './contexto.ts'
import { cuitUnico, nombreUnico, PREFIJO } from './escenario.ts'
import { FIXED_ACCOUNTS } from '../../fixtures/accounts.ts'
import { daysFromToday } from '../../fixtures/dates.ts'
import type { Perfil } from './perfiles.ts'
import { ES_ADMIN } from './perfiles.ts'

export type Ve = 'todo' | 'nada' | 'denegado' | string[]
export type Fila = Record<string, unknown>

/** Condición de igualdad por columna que identifica una fila (la clave primaria). */
export type Pk = Record<string, string>

export interface VarianteUpdate {
  nombre: string
  permitido: readonly Perfil[]
  /** Fila objetivo (de las plantadas, o la víctima si la tabla tiene fábrica). */
  objetivo?: (c: Contexto, quien: Perfil) => Pk
  /** La fila objetivo es la PROPIA: se iguala esta columna al id del perfil que actúa. */
  propio?: string
  parche: Fila
}

export interface TablaSpec {
  tabla: string
  /** Columnas de la clave primaria (para borrar lo que un insert indebido haya creado). */
  pk: readonly string[]
  /** Columna por la que se identifica cada fila plantada, y las filas plantadas por clave. */
  clave: string
  filas: (c: Contexto) => Record<string, string>
  ve: Record<Perfil, Ve>
  /**
   * La tabla es tan grande que un `select` sin filtro con RLS por fila supera el tiempo máximo
   * de la consulta (defecto de rendimiento DEF-P02): para el esperado "nada" se pide filtrando
   * por las filas plantadas.
   */
  pesada?: boolean
  insert: {
    permitido: readonly Perfil[]
    /** Fila a insertar; `quien` permite apuntar a cosas distintas según el perfil. */
    fila: (c: Contexto, quien: Perfil) => Fila
  }
  /** Fábrica de una fila descartable (servicio): hace falta si la tabla se puede borrar o editar. */
  victima?: (c: Contexto) => Fila
  update: VarianteUpdate[]
  delete?: { permitido: readonly Perfil[] }
  /** Objetivo por defecto para los intentos de update y delete denegados (fila plantada). */
  objetivo: (c: Contexto) => Pk
}

const TODOS_ADMIN = ES_ADMIN

/** Todo `nada` salvo lo que se indique. */
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

function ids(c: Contexto) {
  return c.ids
}

/** Id de la persona detrás de cada perfil (el visitante `anon` no tiene: uno inexistente). */
export function idPerfil(c: Contexto, perfil: Perfil): string {
  switch (perfil) {
    case 'empleado':
      return c.ids.empleado1
    case 'supervisor':
      return c.ids.supervisor1
    case 'dual':
      return c.ids.dual
    case 'adminSin':
      return c.ids.adminSin
    case 'admin':
      return c.ids.admin
    case 'owner':
      return c.ids.owner
    case 'anon':
      return randomUUID()
  }
}

export const TABLAS: TablaSpec[] = [
  {
    tabla: 'profiles',
    pk: ['id'],
    clave: 'id',
    filas: (c) => ({ ...ids(c) }),
    objetivo: (c) => ({ id: c.ids.empleado3 }),
    insert: {
      permitido: [],
      fila: () => ({ id: randomUUID(), first_name: 'e2e', last_name: 'perm' }),
    },
    ve: ven({
      empleado: ['empleado1', 'empleado2'],
      supervisor: ['supervisor1', 'empleado1', 'empleado2'],
      dual: ['dual', 'empleado4'],
      ...admins,
    }),
    // Insert: nunca (solo el trigger `app.handle_new_user`). Delete: nunca.
    update: [
      {
        nombre: 'perfil ajeno (teléfono)',
        permitido: TODOS_ADMIN,
        objetivo: (c) => ({ id: c.ids.empleado2 }),
        parche: { phone: '1100000000' },
      },
      {
        nombre: 'perfil propio (teléfono)',
        permitido: [
          'empleado',
          'supervisor',
          'dual',
          'adminSin',
          'admin',
          'owner',
        ],
        propio: 'id',
        parche: { phone: '1100000001' },
      },
      {
        // 03 §6: editar los datos de empleados y supervisores es del administrador.
        nombre: 'perfil ajeno (nombre)',
        permitido: TODOS_ADMIN,
        objetivo: (c) => ({ id: c.ids.empleado2 }),
        // El mismo nombre que ya tiene la cuenta del conjunto (no cambia nada visible para otras suites).
        parche: { first_name: FIXED_ACCOUNTS.empleado2.firstName },
      },
      {
        // 03 §6: "desactivarlos" (empleados y supervisores) exige `manage_users`. Un
        // `is_active = false` apaga TODO el acceso de la persona: la RLS y las RPC consultan
        // el perfil en vivo (0020 y 0022).
        nombre: 'desactivar a un empleado (is_active)',
        permitido: ['admin', 'owner'],
        objetivo: (c) => ({ id: c.ids.empleado2 }),
        parche: { is_active: false },
      },
      {
        // 03 §6 y P-017: desactivar administradores es solo del dueño.
        nombre: 'desactivar a un administrador (is_active)',
        permitido: ['owner'],
        objetivo: (c) => ({ id: c.ids.adminCapacidades }),
        parche: { is_active: false },
      },
    ],
  },
  {
    tabla: 'user_roles',
    pk: ['profile_id', 'role'],
    clave: 'profile_id',
    filas: (c) => ({ ...ids(c) }),
    objetivo: (c) => ({ profile_id: c.ids.empleado2, role: 'employee' }),
    // Autoescalada: darse a sí mismo el rol de dueño.
    insert: {
      permitido: [],
      fila: (c, quien) => ({ profile_id: idPerfil(c, quien), role: 'owner' }),
    },
    ve: ven({
      empleado: ['empleado1'],
      supervisor: ['supervisor1'],
      dual: ['dual'],
      ...admins,
    }),
    update: [
      {
        nombre: 'rol ajeno',
        permitido: [],
        parche: { granted_by: null },
      },
    ],
  },
  {
    tabla: 'admin_capabilities',
    pk: ['profile_id', 'capability'],
    clave: 'profile_id',
    filas: (c) => ({
      admin: c.ids.admin,
      adminSin: c.ids.adminSin,
      adminCapacidades: c.ids.adminCapacidades,
    }),
    objetivo: (c) => ({
      profile_id: c.ids.adminSin,
      capability: 'manage_users',
    }),
    // Autoasignarse una capacidad.
    insert: {
      permitido: [],
      fila: (c, quien) => ({
        profile_id: idPerfil(c, quien),
        capability: 'manage_users',
        enabled: true,
      }),
    },
    ve: ven({
      adminSin: ['adminSin'],
      admin: ['admin'],
      owner: 'todo',
    }),
    update: [
      { nombre: 'capacidad ajena', permitido: [], parche: { enabled: true } },
    ],
  },
  {
    tabla: 'company_settings',
    pk: ['id'],
    clave: 'id',
    filas: () => ({ empresa: '1' }),
    objetivo: () => ({ id: '1' }),
    insert: {
      permitido: [],
      fila: () => ({ id: 2, name: `${PREFIJO}empresa` }),
    },
    // `anon` solo llega por la vista `v_public_branding` (el grant de columnas se prueba aparte).
    ve: ven({
      empleado: 'todo',
      supervisor: 'todo',
      dual: 'todo',
      ...admins,
    }),
    update: [
      {
        // 03 §6: "Subir logo" es del dueño y del administrador.
        nombre: 'logo (logo_path)',
        permitido: TODOS_ADMIN,
        parche: { logo_path: `${PREFIJO}logo.png` },
      },
      {
        // 03 §6: "Configuración de la empresa: nombre, teléfono, consentimiento" es solo del
        // dueño.
        nombre: 'datos de la empresa (support_phone)',
        permitido: ['owner'],
        parche: { support_phone: '+54 11 0000-0000' },
      },
      {
        nombre: 'texto de consentimiento (location_consent_text)',
        permitido: ['owner'],
        parche: { location_consent_text: `${PREFIJO}consentimiento` },
      },
    ],
  },
  {
    tabla: 'holidays',
    pk: ['id'],
    clave: 'id',
    filas: (c) => ({ feriado: c.e.feriado }),
    objetivo: (c) => ({ id: c.e.feriado }),
    ve: ven({ empleado: 'todo', supervisor: 'todo', dual: 'todo', ...admins }),
    victima: () => ({
      holiday_date: fechaLejana(),
      name: `${PREFIJO}feriado-victima`,
    }),
    insert: {
      permitido: ['owner'],
      fila: () => ({
        holiday_date: fechaLejana(),
        name: `${PREFIJO}feriado-nuevo`,
      }),
    },
    update: [
      {
        nombre: 'feriado',
        permitido: ['owner'],
        parche: { name: `${PREFIJO}feriado-editado` },
      },
    ],
    delete: { permitido: ['owner'] },
  },
  {
    tabla: 'security_events',
    pk: ['id'],
    clave: 'id',
    filas: (c) => ({ evento: c.e.evento }),
    objetivo: (c) => ({ id: c.e.evento }),
    insert: {
      permitido: [],
      fila: (c, quien) => ({
        event_type: 'sign_in',
        actor_id: idPerfil(c, quien),
        details: { e2e: 'perm' },
      }),
    },
    ve: ven({ owner: 'todo' }),
    update: [
      {
        nombre: 'evento',
        permitido: [],
        parche: { details: { e2e: 'perm', editado: true } },
      },
    ],
  },
  {
    tabla: 'clients',
    pk: ['id'],
    clave: 'id',
    filas: (c) => ({ clienteA: c.e.clienteA, clienteB: c.e.clienteB }),
    objetivo: (c) => ({ id: c.e.clienteB }),
    ve: ven({
      empleado: ['clienteA'],
      supervisor: ['clienteA'],
      dual: ['clienteB'],
      ...admins,
    }),
    victima: () => ({
      legal_name: nombreUnico('cliente-victima'),
      cuit: cuitUnico(),
    }),
    insert: {
      permitido: TODOS_ADMIN,
      fila: () => ({
        legal_name: nombreUnico('cliente-nuevo'),
        cuit: cuitUnico(),
      }),
    },
    update: [
      {
        nombre: 'cliente',
        permitido: TODOS_ADMIN,
        parche: { notes: `${PREFIJO}editado` },
      },
    ],
    delete: { permitido: TODOS_ADMIN },
  },
  {
    tabla: 'client_contacts',
    pk: ['id'],
    clave: 'id',
    filas: (c) => ({ contactoA: c.e.contactoA, contactoB: c.e.contactoB }),
    objetivo: (c) => ({ id: c.e.contactoB }),
    ve: ven({
      supervisor: ['contactoA'],
      dual: ['contactoB'],
      ...admins,
    }),
    victima: (c) => ({
      client_id: c.e.clienteA,
      name: `${PREFIJO}contacto-victima`,
    }),
    insert: {
      permitido: TODOS_ADMIN,
      fila: (c) => ({
        client_id: c.e.clienteA,
        name: `${PREFIJO}contacto-nuevo`,
      }),
    },
    update: [
      {
        nombre: 'contacto',
        permitido: TODOS_ADMIN,
        parche: { role_title: 'e2e' },
      },
    ],
    delete: { permitido: TODOS_ADMIN },
  },
  {
    tabla: 'sites',
    pk: ['id'],
    clave: 'id',
    filas: (c) => ({ sedeA: c.e.sedeA, sedeB: c.e.sedeB }),
    objetivo: (c) => ({ id: c.e.sedeB }),
    ve: ven({
      empleado: ['sedeA'],
      supervisor: ['sedeA'],
      dual: ['sedeB'],
      ...admins,
    }),
    victima: (c) => ({
      client_id: c.e.clienteA,
      name: nombreUnico('sede-victima'),
      address: 'Calle de prueba 1',
    }),
    insert: {
      permitido: TODOS_ADMIN,
      fila: (c) => ({
        client_id: c.e.clienteA,
        name: nombreUnico('sede-nueva'),
        address: 'Calle de prueba 2',
      }),
    },
    update: [
      { nombre: 'sede', permitido: TODOS_ADMIN, parche: { city: 'e2e' } },
    ],
    delete: { permitido: TODOS_ADMIN },
  },
  {
    tabla: 'services',
    pk: ['id'],
    clave: 'id',
    filas: (c) => ({ servicioA: c.e.servicioA }),
    objetivo: (c) => ({ id: c.e.servicioA }),
    ve: ven({ ...admins }),
    victima: (c) => filaServicio(c, 'servicio-victima'),
    insert: {
      permitido: TODOS_ADMIN,
      fila: (c) => filaServicio(c, 'servicio-nuevo'),
    },
    update: [
      {
        nombre: 'servicio',
        permitido: TODOS_ADMIN,
        parche: { notes: `${PREFIJO}editado` },
      },
    ],
    delete: { permitido: TODOS_ADMIN },
  },
  {
    tabla: 'employees',
    pk: ['profile_id'],
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
    objetivo: (c) => ({ profile_id: c.ids.empleado3 }),
    ve: ven({
      empleado: ['empleado1'],
      supervisor: ['supervisor1', 'empleado1', 'empleado2'],
      dual: ['dual', 'empleado4'],
      ...admins,
    }),
    insert: {
      // 04 §7.2: "A con manage_users para crear": el admin sin capacidades no puede.
      permitido: ['admin', 'owner'],
      // Una persona sin ficha de `employees` (la cuenta del admin sin capacidades).
      fila: (c) => ({
        profile_id: c.ids.adminSin,
        dni: `98${Date.now().toString().slice(-6)}`,
      }),
    },
    update: [
      {
        nombre: 'ficha ajena (notas)',
        permitido: TODOS_ADMIN,
        parche: { notes: `${PREFIJO}editado` },
      },
      {
        nombre: 'ficha propia (notas)',
        permitido: [],
        propio: 'profile_id',
        parche: { notes: `${PREFIJO}autoeditado` },
      },
    ],
  },
  {
    tabla: 'employee_client_permissions',
    pk: ['employee_id', 'client_id'],
    clave: 'employee_id',
    filas: (c) => ({ empleado1: c.ids.empleado1, empleado3: c.ids.empleado3 }),
    objetivo: (c) => ({
      employee_id: c.ids.empleado3,
      client_id: c.e.clienteB,
    }),
    ve: ven({ empleado: ['empleado1'], ...admins }),
    victima: (c) => ({ employee_id: c.ids.empleado2, client_id: c.e.clienteA }),
    insert: {
      permitido: TODOS_ADMIN,
      fila: (c) => ({ employee_id: c.ids.empleado2, client_id: c.e.clienteA }),
    },
    update: [
      {
        nombre: 'habilitación',
        permitido: TODOS_ADMIN,
        parche: { created_by: null },
      },
    ],
    delete: { permitido: TODOS_ADMIN },
  },
  {
    tabla: 'employee_availability',
    pk: ['id'],
    clave: 'employee_id',
    filas: (c) => ({ empleado1: c.ids.empleado1, empleado3: c.ids.empleado3 }),
    objetivo: (c) => ({ id: c.e.disponibilidadE3 }),
    ve: ven({ empleado: ['empleado1'], ...admins }),
    victima: (c) => ({
      employee_id: c.ids.empleado2,
      weekday: 2,
      start_time: '09:00',
      end_time: '10:00',
    }),
    insert: {
      permitido: TODOS_ADMIN,
      fila: (c) => ({
        employee_id: c.ids.empleado2,
        weekday: 3,
        start_time: '09:00',
        end_time: '10:00',
      }),
    },
    update: [
      {
        nombre: 'disponibilidad',
        permitido: TODOS_ADMIN,
        parche: { end_time: '13:00' },
      },
    ],
    delete: { permitido: TODOS_ADMIN },
  },
  {
    tabla: 'employee_leaves',
    pk: ['id'],
    clave: 'employee_id',
    filas: (c) => ({ empleado1: c.ids.empleado1, empleado3: c.ids.empleado3 }),
    objetivo: (c) => ({ id: c.e.licenciaE3 }),
    ve: ven({ empleado: ['empleado1'], ...admins }),
    victima: (c) => filaLicencia(c, 'victima'),
    insert: { permitido: TODOS_ADMIN, fila: (c) => filaLicencia(c, 'nueva') },
    update: [
      {
        nombre: 'licencia',
        permitido: TODOS_ADMIN,
        parche: { reason: `${PREFIJO}editada` },
      },
    ],
    delete: { permitido: TODOS_ADMIN },
  },
  {
    tabla: 'shifts',
    pk: ['id'],
    clave: 'id',
    filas: (c) => ({
      turnoA: c.e.turnoA,
      turnoB: c.e.turnoB,
      turnoD: c.e.turnoD,
    }),
    objetivo: (c) => ({ id: c.e.turnoB }),
    // Solo por RPC: ni el dueño escribe directo.
    insert: {
      permitido: [],
      fila: (c) => ({
        client_id: c.e.clienteA,
        site_id: c.e.sedeA,
        shift_date: c.fechaTurno,
        start_time: '14:00',
        end_time: '15:00',
        required_staff: 1,
      }),
    },
    ve: ven({
      empleado: ['turnoA'],
      supervisor: ['turnoA'],
      dual: ['turnoD'],
      ...admins,
    }),
    // Solo por RPC: ni el dueño escribe directo.
    update: [
      {
        nombre: 'turno',
        permitido: [],
        parche: { notes: `${PREFIJO}editado` },
      },
    ],
  },
  {
    tabla: 'assignments',
    pk: ['id'],
    clave: 'id',
    filas: (c) => ({
      asigE1: c.e.asigE1,
      asigE2: c.e.asigE2,
      asigE3: c.e.asigE3,
      asigE4: c.e.asigE4,
      asigDual: c.e.asigDual,
    }),
    objetivo: (c) => ({ id: c.e.asigE3 }),
    insert: {
      permitido: [],
      fila: (c, quien) => ({
        employee_id: idPerfil(c, quien),
        shift_id: c.e.turnoA,
        shift_date: c.fechaTurno,
        window: `[${c.fechaTurno}T20:00:00Z,${c.fechaTurno}T21:00:00Z)`,
      }),
    },
    ve: ven({
      empleado: ['asigE1', 'asigE2'],
      supervisor: ['asigE1', 'asigE2'],
      dual: ['asigE4', 'asigDual'],
      ...admins,
    }),
    update: [
      {
        // 0026 retiró la escritura directa de `notes` (política y grant de columna): la única
        // vía es la RPC `set_assignment_notes` (06 §8, 04 §9). 04 §7.2 todavía menciona el
        // update directo del empleado: queda como pregunta en el reporte; lo vigente es seguro.
        nombre: 'observación propia (notes)',
        permitido: [],
        objetivo: (c) => ({ id: c.e.asigE1 }),
        parche: { notes: `${PREFIJO}observacion` },
      },
      {
        nombre: 'observación del compañero (notes)',
        permitido: [],
        objetivo: (c) => ({ id: c.e.asigE2 }),
        parche: { notes: `${PREFIJO}ajena` },
      },
      {
        // Solo `notes` tiene grant de update: cualquier otra columna da "permission denied".
        nombre: 'estado propio (status): columna sin grant',
        permitido: [],
        objetivo: (c) => ({ id: c.e.asigE1 }),
        parche: { status: 'finished' },
      },
    ],
  },
  {
    tabla: 'attendance_records',
    pk: ['id'],
    clave: 'id',
    filas: (c) => ({
      asistenciaE1: c.e.asistenciaE1,
      asistenciaE2: c.e.asistenciaE2,
      asistenciaE3: c.e.asistenciaE3,
    }),
    objetivo: (c) => ({ id: c.e.asistenciaE1 }),
    insert: {
      permitido: [],
      fila: (c) => ({
        assignment_id: c.e.asigE1,
        kind: 'check_out',
        recorded_at: new Date().toISOString(),
        source: 'employee_app',
      }),
    },
    ve: ven({
      empleado: ['asistenciaE1'],
      supervisor: ['asistenciaE1', 'asistenciaE2'],
      ...admins,
    }),
    update: [
      {
        nombre: 'registro de asistencia',
        permitido: [],
        parche: { reason: `${PREFIJO}editado` },
      },
    ],
  },
  {
    tabla: 'attendance_notices',
    pk: ['id'],
    clave: 'id',
    filas: (c) => ({
      avisoE1: c.e.avisoE1,
      avisoE2: c.e.avisoE2,
      avisoE3: c.e.avisoE3,
    }),
    objetivo: (c) => ({ id: c.e.avisoE1 }),
    insert: {
      permitido: [],
      fila: (c) => ({
        assignment_id: c.e.asigE1,
        kind: 'delay',
        minutes_late: 5,
        source: 'employee_app',
      }),
    },
    ve: ven({
      empleado: ['avisoE1'],
      supervisor: ['avisoE1', 'avisoE2'],
      ...admins,
    }),
    update: [
      {
        nombre: 'aviso',
        permitido: [],
        parche: { reason_text: `${PREFIJO}editado` },
      },
    ],
  },
  {
    tabla: 'checklist_templates',
    pk: ['id'],
    clave: 'id',
    filas: (c) => ({ plantillaA: c.e.plantillaA, plantillaB: c.e.plantillaB }),
    objetivo: (c) => ({ id: c.e.plantillaB }),
    ve: ven({ ...admins }),
    victima: (c) => filaPlantilla(c, 'victima'),
    insert: {
      // 04 §7.2: "O, A con edit_checklists".
      permitido: ['admin', 'owner'],
      fila: (c) => filaPlantilla(c, 'nueva'),
    },
    update: [
      {
        nombre: 'plantilla',
        permitido: ['admin', 'owner'],
        parche: { name: `${PREFIJO}editada` },
      },
    ],
    delete: { permitido: ['admin', 'owner'] },
  },
  {
    tabla: 'checklist_template_items',
    pk: ['id'],
    clave: 'id',
    filas: (c) => ({ itemA: c.e.itemA, itemB: c.e.itemB }),
    objetivo: (c) => ({ id: c.e.itemB }),
    ve: ven({ ...admins }),
    victima: (c) => ({
      template_id: c.e.plantillaA,
      position: 50,
      title: `${PREFIJO}item-victima`,
    }),
    insert: {
      permitido: ['admin', 'owner'],
      fila: (c) => ({
        template_id: c.e.plantillaA,
        position: 51,
        title: `${PREFIJO}item-nuevo`,
      }),
    },
    update: [
      {
        nombre: 'ítem de plantilla',
        permitido: ['admin', 'owner'],
        parche: { title: `${PREFIJO}item-editado` },
      },
    ],
    delete: { permitido: ['admin', 'owner'] },
  },
  {
    tabla: 'shift_tasks',
    pesada: true,
    pk: ['id'],
    clave: 'id',
    filas: (c) => ({ tareaA: c.e.tareaA, tareaB: c.e.tareaB }),
    objetivo: (c) => ({ id: c.e.tareaB }),
    insert: {
      permitido: [],
      fila: (c) => ({
        shift_id: c.e.turnoA,
        position: 9,
        title: `${PREFIJO}tarea-nueva`,
        is_required: false,
      }),
    },
    ve: ven({
      empleado: ['tareaA'],
      supervisor: ['tareaA'],
      ...admins,
    }),
    update: [
      {
        nombre: 'tarea del turno',
        permitido: [],
        parche: { title: `${PREFIJO}editada` },
      },
    ],
  },
  {
    tabla: 'supervisions',
    pk: ['id'],
    clave: 'id',
    filas: (c) => ({ supA: c.e.supA, supB: c.e.supB, supD: c.e.supD }),
    objetivo: (c) => ({ id: c.e.supB }),
    // Autoasignarse una supervisión.
    insert: {
      permitido: [],
      fila: (c, quien) => ({
        shift_id: c.e.turnoA,
        supervisor_id: idPerfil(c, quien),
      }),
    },
    ve: ven({
      supervisor: ['supA'],
      dual: ['supD'],
      ...admins,
    }),
    update: [
      {
        nombre: 'supervisión',
        permitido: [],
        parche: { general_notes: `${PREFIJO}editada` },
      },
    ],
  },
  {
    tabla: 'supervision_attendance',
    pk: ['id'],
    clave: 'id',
    filas: (c) => ({ asistSupA: c.e.asistSupA, asistSupB: c.e.asistSupB }),
    objetivo: (c) => ({ id: c.e.asistSupB }),
    insert: {
      permitido: [],
      fila: (c) => ({
        supervision_id: c.e.supA,
        kind: 'check_out',
        recorded_at: new Date().toISOString(),
      }),
    },
    ve: ven({
      supervisor: ['asistSupA'],
      ...admins,
    }),
    update: [
      {
        nombre: 'asistencia de supervisión',
        permitido: [],
        parche: { accuracy_m: 1 },
      },
    ],
  },
  {
    tabla: 'ratings',
    pk: ['id'],
    clave: 'id',
    filas: (c) => ({
      calificacionA: c.e.calificacionA,
      calificacionB: c.e.calificacionB,
    }),
    objetivo: (c) => ({ id: c.e.calificacionB }),
    insert: {
      permitido: [],
      fila: (c) => ({
        supervision_id: c.e.supA,
        assignment_id: c.e.asigE2,
        score: 5,
      }),
    },
    // CB-15: el empleado lee `ratings` y obtiene cero filas (P-084).
    ve: ven({
      supervisor: ['calificacionA'],
      ...admins,
    }),
    update: [
      {
        nombre: 'calificación',
        permitido: [],
        parche: { comment: `${PREFIJO}editada` },
      },
    ],
  },
  {
    tabla: 'rating_criteria',
    pk: ['id'],
    clave: 'id',
    filas: (c) => ({ criterio: c.e.criterio }),
    objetivo: (c) => ({ id: c.e.criterio }),
    ve: ven({ supervisor: 'todo', dual: 'todo', ...admins }),
    victima: () => ({ position: 97, title: `${PREFIJO}criterio-victima` }),
    insert: {
      permitido: ['owner'],
      fila: () => ({ position: 96, title: `${PREFIJO}criterio-nuevo` }),
    },
    update: [
      {
        nombre: 'criterio',
        permitido: ['owner'],
        parche: { title: `${PREFIJO}criterio-editado` },
      },
    ],
    delete: { permitido: ['owner'] },
  },
]

// ---------------------------------------------------------------------------------------------
// Filas de apoyo
// ---------------------------------------------------------------------------------------------

let contadorFechas = 0
function fechaLejana(): string {
  // Una fecha distinta por llamada, lejana y válida (la tabla es única por fecha).
  contadorFechas += 1
  const dia = String(1 + (contadorFechas % 27)).padStart(2, '0')
  const mes = String(1 + (Math.floor(contadorFechas / 27) % 12)).padStart(
    2,
    '0',
  )
  return `219${2 + (Math.floor(contadorFechas / 324) % 7)}-${mes}-${dia}`
}

function filaServicio(c: Contexto, slug: string): Fila {
  return {
    client_id: c.e.clienteA,
    site_id: c.e.sedeA,
    name: nombreUnico(slug),
    weekdays: [2],
    start_time: '08:00',
    end_time: '12:00',
    valid_from: c.fechaTurno,
    status: 'paused',
  }
}

let contadorLicencias = 0
function filaLicencia(c: Contexto, slug: string): Fila {
  contadorLicencias += 1
  const desde = daysFromToday(200 + contadorLicencias * 3)
  return {
    employee_id: c.ids.empleado2,
    starts_on: desde,
    ends_on: desde,
    reason: `${PREFIJO}licencia-${slug}`,
  }
}

function filaPlantilla(c: Contexto, slug: string): Fila {
  // Plantilla de nivel cliente (sin sede) de un cliente nuevo no hace falta: el cliente B no
  // tiene plantilla propia a nivel cliente, solo la de su sede.
  return { client_id: c.e.clienteB, name: `${PREFIJO}plantilla-${slug}` }
}
