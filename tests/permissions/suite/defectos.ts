// tests/permissions/suite/defectos.ts — TEST-019 (P18.3)
//
// Casos de la matriz que hoy FALLAN por un defecto de la app (no de la prueba). Regla del
// encargo: no se ajusta la prueba al defecto. El caso se marca con `it.fails` (Vitest lo da por
// bueno mientras siga fallando y AVISA cuando el defecto se corrija: ahí hay que sacarlo de esta
// lista) y lleva el identificador del defecto en el título. El detalle, con pasos, cita del
// plan, severidad y agente dueño, está en el reporte del paquete P18.3 y en
// `docs/security-review.md`.
//
// La clave es `claveCaso(...)`: `<área> · <objeto> · <operación> · <perfil>`.

import { it } from 'vitest'

export interface Defecto {
  id: string
  resumen: string
}

export function claveCaso(...partes: string[]): string {
  return partes.join(' · ')
}

const D: Record<string, Defecto> = {
  'DEF-P01': {
    id: 'DEF-P01',
    resumen:
      'El administrador (con o sin capacidades) puede cambiar el teléfono de soporte y el texto de consentimiento de la empresa por API directa: 03 §6 reserva la configuración al dueño y deja al administrador solo el logo.',
  },
  'DEF-P02': {
    id: 'DEF-P02',
    resumen:
      'Un select sin filtro sobre shift_tasks por un empleado o un supervisor tarda más de 6 segundos (con el doble rol supera el límite de la consulta y se cancela): la RLS evalúa app.shares_shift / app.supervises_shift fila por fila sobre 6.655 filas y crece con los datos.',
  },
  'DEF-P03': {
    id: 'DEF-P03',
    resumen:
      'Empleado y supervisor leen el teléfono y el email de contacto de las personas de su turno desde profiles: P-103 y 04 §7.2 limitan a un compañero a "nombre y foto". La RLS filtra filas, no columnas.',
  },
  'DEF-P04': {
    id: 'DEF-P04',
    resumen:
      'El supervisor lee DNI, CUIL, domicilio y contacto de emergencia de los empleados de sus turnos (employees y v_employees): 03 §15 dice "solo dueño y administrador" y 03 §6 le da "nombre, foto, asistencia".',
  },
  'DEF-P05': {
    id: 'DEF-P05',
    resumen:
      'El empleado lee CUIT, domicilio administrativo y notas internas del cliente de sus turnos: 04 §7.2 dice "clientes de sus turnos (solo nombre)".',
  },
  'DEF-P06': {
    id: 'DEF-P06',
    resumen:
      'El empleado lee la observación (assignments.notes) de sus compañeros de turno: P-062 dice que la ven "administración y el supervisor del turno" y P-103 que de los compañeros solo ve nombre y foto.',
  },
  'DEF-P07': {
    id: 'DEF-P07',
    resumen:
      'La política avatars_select_public deja listar el bucket avatars a cualquiera (incluido anon): entrega el id de cada persona con foto y su archivo; 04 §7.3 apoya la lectura pública en que la URL sea "no adivinable".',
  },
  'DEF-P08': {
    id: 'DEF-P08',
    resumen:
      'La acción sign_out_user de admin-users no verifica que la persona exista: responde 200 y registra un evento sessions_revoked (que además cuenta para el límite de 10 por minuto). Las demás acciones devuelven PROFILE_NOT_FOUND.',
  },
  'DEF-P09': {
    id: 'DEF-P09',
    resumen:
      'Una cuenta desactivada con el token todavía vigente sigue leyendo holidays y company_settings (las políticas "todos autenticados" no consultan que el perfil siga activo).',
  },
  'DEF-P10': {
    id: 'DEF-P10',
    resumen:
      'Una cuenta desactivada con el token todavía vigente sube archivos a su carpeta de avatars: la política de Storage usa auth.uid() y no app.current_profile_active().',
  },
  'DEF-P11': {
    id: 'DEF-P11',
    resumen:
      'La función de plataforma public.rls_auto_enable() (security definer, no sale de las migraciones) tiene execute para anon y authenticated y queda expuesta como RPC; hoy falla al devolver su resultado, pero no debería ser llamable.',
  },
  'DEF-P13': {
    id: 'DEF-P13',
    resumen:
      'Un administrador, incluso SIN capacidades, puede desactivar a cualquier persona con un update directo de profiles.is_active (también a otro administrador y, por la misma política, al dueño): la política profiles_update_admin solo pide app.is_admin(). 03 §6 y P-017 reservan al dueño desactivar administradores y exigen manage_users para desactivar empleados. Con is_active = false la persona pierde todo acceso (0020 y 0022) y el dueño no podría reactivarse solo.',
  },
  'DEF-P12': {
    id: 'DEF-P12',
    resumen:
      'mark_changes_seen sigue funcionando para una cuenta desactivada con el token vigente (escribe last_seen_changes_at de su perfil): no verifica que el perfil siga activo.',
  },
}

const SESION_CHICA = ['empleado', 'supervisor', 'admin']
const TODOS = [
  'anon',
  'empleado',
  'supervisor',
  'dual',
  'adminSin',
  'admin',
  'owner',
]

function marcar(id: string, ...claves: string[][]): Array<[string, Defecto]> {
  const defecto = D[id]
  if (!defecto) throw new Error(`Defecto desconocido: ${id}`)
  return claves.map((c) => [claveCaso(...c), defecto])
}

export const DEFECTOS: Record<string, Defecto> = Object.fromEntries([
  ...['adminSin', 'admin'].flatMap((perfil) =>
    marcar(
      'DEF-P01',
      [
        'tabla',
        'company_settings',
        'update datos de la empresa (support_phone)',
        perfil,
      ],
      [
        'tabla',
        'company_settings',
        'update texto de consentimiento (location_consent_text)',
        perfil,
      ],
    ),
  ),
  ...['empleado', 'supervisor'].flatMap((perfil) =>
    marcar('DEF-P02', ['rendimiento', 'shift_tasks', perfil]),
  ),
  ...['empleado', 'supervisor'].flatMap((perfil) =>
    ['phone', 'contact_email'].flatMap((col) =>
      marcar('DEF-P03', ['columnas', 'profiles', col, perfil]),
    ),
  ),
  ...['dni', 'cuil', 'address', 'emergency_contact_phone'].flatMap((col) =>
    marcar(
      'DEF-P04',
      ['columnas', 'employees', col, 'supervisor'],
      ['columnas', 'v_employees', col, 'supervisor'],
    ),
  ),
  ...['cuit', 'admin_address', 'notes'].flatMap((col) =>
    marcar('DEF-P05', ['columnas', 'clients', col, 'empleado']),
  ),
  ...marcar('DEF-P06', ['columnas', 'assignments', 'notes', 'empleado']),
  ...['anon', 'empleado', 'supervisor', 'dual'].flatMap((perfil) =>
    marcar('DEF-P07', ['storage', 'avatars', 'listar', perfil]),
  ),
  ...['admin', 'owner'].flatMap((perfil) =>
    marcar('DEF-P08', ['edge', 'sign_out_user', perfil]),
  ),
  ...SESION_CHICA.flatMap((perfil) =>
    marcar(
      'DEF-P09',
      ['desactivado', 'company_settings', 'select', perfil],
      ['desactivado', 'holidays', 'select', perfil],
    ),
  ),
  ...SESION_CHICA.flatMap((perfil) =>
    marcar('DEF-P10', ['desactivado', 'storage', 'avatars', perfil]),
  ),
  ...TODOS.flatMap((perfil) =>
    marcar('DEF-P11', ['rpc', 'rls_auto_enable', perfil]),
  ),
  ...marcar(
    'DEF-P13',
    [
      'tabla',
      'profiles',
      'update desactivar a un empleado (is_active)',
      'adminSin',
    ],
    [
      'tabla',
      'profiles',
      'update desactivar a un administrador (is_active)',
      'adminSin',
    ],
    [
      'tabla',
      'profiles',
      'update desactivar a un administrador (is_active)',
      'admin',
    ],
  ),
  ...SESION_CHICA.flatMap((perfil) =>
    marcar('DEF-P12', ['desactivado', 'rpc', 'mark_changes_seen', perfil]),
  ),
])

export function defectoDe(clave: string): Defecto | undefined {
  return DEFECTOS[clave]
}

/** Lista de los defectos conocidos (para el resumen del final de la corrida). */
export function listaDeDefectos(): Defecto[] {
  return Object.values(D)
}

/** Registra un caso: `it.fails` si hay un defecto conocido para su clave, `it` si no. */
export function caso(
  clave: string,
  base: string,
  fn: () => Promise<void>,
): void {
  const d = DEFECTOS[clave]
  if (d) it.fails(`[${d.id}] ${base}`, fn)
  else it(base, fn)
}
