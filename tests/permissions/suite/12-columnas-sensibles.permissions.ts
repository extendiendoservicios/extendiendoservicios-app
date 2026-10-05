// tests/permissions/suite/12-columnas-sensibles.permissions.ts — TEST-019 (P18.3)
//
// Qué COLUMNAS de las filas que un rol sí puede leer están de más. La RLS decide filas, no
// columnas: el plan acota las columnas por rol y esta prueba verifica que el servidor lo cumpla
// (la interfaz ya oculta lo que no corresponde; lo que importa es la API directa).
//
//   - Empleado: de sus compañeros de turno ve "solo nombre y foto" (P-103, 04 §7.2); del cliente
//     de sus turnos, "solo nombre" (04 §7.2); la observación de otro empleado la ven
//     "administración y el supervisor del turno" (P-062).
//   - Supervisor: de los empleados de sus turnos, "nombre, foto, asistencia del turno"
//     (03 §6); DNI, CUIL y domicilio son "solo dueño y administrador" (03 §15).
//
// Cada caso carga un dato sensible en la fila ajena (con la clave de servicio), lo lee con el rol
// y espera que NO llegue. Desde P18.6 (migración 0030) lo ajeno se lee por vistas recortadas
// (`v_people_basic`, `v_clients_basic`, `v_shift_peers`) y las tablas base no dan esas filas;
// los casos de contraprueba verifican que las vistas sí entregan nombre y foto.

import { afterAll, beforeAll, describe, expect } from 'vitest'
import { clienteDe, contexto, servicio } from './contexto.ts'
import { caso, claveCaso } from './defectos.ts'
import { describir, filas, tabla, type Resultado } from './ayudas.ts'
import { PREFIJO } from './escenario.ts'

/** El valor llegó: hay una fila y la columna trae algo distinto de null. */
function llego(res: Resultado, columna: string): boolean {
  const fila = filas(res)[0]
  return !!fila && fila[columna] !== null && fila[columna] !== undefined
}

const SENSIBLE = `${PREFIJO}privado`

describe('columnas de filas ajenas que un rol no debería leer', () => {
  beforeAll(async () => {
    const c = contexto()
    const db = servicio()
    // Valores sensibles en las filas de otras personas (se reponen al final).
    await tabla(db, 'profiles')
      .update({
        phone: '1155550000',
        contact_email: 'e2e-perm-privado@example.com',
      })
      .eq('id', c.ids.empleado2)
    await tabla(db, 'profiles')
      .update({
        phone: '1155550001',
        contact_email: 'e2e-perm-privado1@example.com',
      })
      .eq('id', c.ids.empleado1)
    await tabla(db, 'employees')
      .update({
        address: SENSIBLE,
        cuil: '20999999991',
        emergency_contact_phone: '1155550002',
      })
      .eq('profile_id', c.ids.empleado1)
    await tabla(db, 'clients')
      .update({ notes: SENSIBLE, admin_address: SENSIBLE })
      .eq('id', c.e.clienteA)
    await tabla(db, 'assignments')
      .update({ notes: SENSIBLE })
      .eq('id', c.e.asigE2)
  })

  afterAll(async () => {
    const c = contexto()
    const db = servicio()
    await tabla(db, 'profiles')
      .update({ phone: null, contact_email: null })
      .in('id', [c.ids.empleado1, c.ids.empleado2])
    await tabla(db, 'employees')
      .update({ address: null, cuil: null, emergency_contact_phone: null })
      .eq('profile_id', c.ids.empleado1)
    await tabla(db, 'assignments').update({ notes: null }).eq('id', c.e.asigE2)
  })

  // ---- Contraprueba: lo que sí corresponde leer sigue funcionando ----------------------------
  caso(
    claveCaso('columnas', 'control', 'empleado lee nombre del compañero'),
    '[empleado] v_people_basic del compañero: el nombre y la foto SÍ se ven (P-103)',
    async () => {
      const res = await tabla(clienteDe('empleado'), 'v_people_basic')
        .select('first_name,last_name,avatar_path')
        .eq('profile_id', contexto().ids.empleado2)
      expect(res.error, describir(res)).toBeNull()
      expect(filas(res)).toHaveLength(1)
    },
  )

  caso(
    claveCaso('columnas', 'control', 'supervisor lee nombre del empleado'),
    '[supervisor] v_people_basic del empleado de su turno: el nombre y la foto SÍ se ven (03 §6)',
    async () => {
      const res = await tabla(clienteDe('supervisor'), 'v_people_basic')
        .select('first_name,last_name,avatar_path')
        .eq('profile_id', contexto().ids.empleado2)
      expect(res.error, describir(res)).toBeNull()
      expect(filas(res)).toHaveLength(1)
    },
  )

  caso(
    claveCaso('columnas', 'control', 'empleado lee el nombre del cliente'),
    '[empleado] v_clients_basic del cliente de su turno: el nombre SÍ se ve (04 §7.2)',
    async () => {
      const res = await tabla(clienteDe('empleado'), 'v_clients_basic')
        .select('legal_name,trade_name')
        .eq('id', contexto().e.clienteA)
      expect(res.error, describir(res)).toBeNull()
      expect(filas(res)).toHaveLength(1)
    },
  )

  caso(
    claveCaso('columnas', 'control', 'empleado lee a los compañeros del turno'),
    '[empleado] v_shift_peers del turno: ve a sus compañeros con nombre y foto, sin observación (P-103, P-062)',
    async () => {
      const res = await tabla(clienteDe('empleado'), 'v_shift_peers')
        .select('profile_id,first_name,last_name,avatar_path')
        .eq('shift_id', contexto().e.turnoA)
      expect(res.error, describir(res)).toBeNull()
      expect(
        filas(res)
          .map((f) => String(f.profile_id))
          .sort(),
      ).toEqual([contexto().ids.empleado1, contexto().ids.empleado2].sort())
    },
  )

  caso(
    claveCaso('columnas', 'control', 'empleado lee su propio teléfono'),
    '[empleado] profiles propio: el teléfono SÍ se ve (RB-E01)',
    async () => {
      const res = await tabla(clienteDe('empleado'), 'profiles')
        .select('phone')
        .eq('id', contexto().ids.empleado1)
      expect(llego(res, 'phone')).toBe(true)
    },
  )

  caso(
    claveCaso('columnas', 'control', 'supervisor lee la observación del turno'),
    '[supervisor] assignments del turno supervisado: la observación SÍ se ve (P-062)',
    async () => {
      const res = await tabla(clienteDe('supervisor'), 'assignments')
        .select('notes')
        .eq('id', contexto().e.asigE2)
      expect(llego(res, 'notes')).toBe(true)
    },
  )

  // ---- Datos de compañeros de turno ----------------------------------------------------------
  for (const columna of ['phone', 'contact_email']) {
    caso(
      claveCaso('columnas', 'profiles', columna, 'empleado'),
      `[empleado] profiles del compañero: ${columna} NO tiene que llegar (P-103, 04 §7.2, CB-15)`,
      async () => {
        const res = await tabla(clienteDe('empleado'), 'profiles')
          .select(columna)
          .eq('id', contexto().ids.empleado2)
        expect(
          llego(res, columna),
          `llegó ${columna} de un compañero: ${describir(res)}`,
        ).toBe(false)
      },
    )
    caso(
      claveCaso('columnas', 'profiles', columna, 'supervisor'),
      `[supervisor] profiles del empleado de su turno: ${columna} NO tiene que llegar (03 §6)`,
      async () => {
        const res = await tabla(clienteDe('supervisor'), 'profiles')
          .select(columna)
          .eq('id', contexto().ids.empleado2)
        expect(llego(res, columna), `llegó ${columna}: ${describir(res)}`).toBe(
          false,
        )
      },
    )
  }

  caso(
    claveCaso('columnas', 'assignments', 'notes', 'empleado'),
    '[empleado] assignments del compañero: la observación NO tiene que llegar (P-062, P-103)',
    async () => {
      const res = await tabla(clienteDe('empleado'), 'assignments')
        .select('notes')
        .eq('id', contexto().e.asigE2)
      expect(
        llego(res, 'notes'),
        `llegó la observación del compañero: ${describir(res)}`,
      ).toBe(false)
    },
  )

  // ---- Datos personales del empleado ante el supervisor --------------------------------------
  for (const columna of ['dni', 'cuil', 'address', 'emergency_contact_phone']) {
    caso(
      claveCaso('columnas', 'employees', columna, 'supervisor'),
      `[supervisor] employees del empleado de su turno: ${columna} NO tiene que llegar (03 §15: solo dueño y administrador)`,
      async () => {
        const res = await tabla(clienteDe('supervisor'), 'employees')
          .select(columna)
          .eq('profile_id', contexto().ids.empleado1)
        expect(llego(res, columna), `llegó ${columna}: ${describir(res)}`).toBe(
          false,
        )
      },
    )
    caso(
      claveCaso('columnas', 'v_employees', columna, 'supervisor'),
      `[supervisor] v_employees del empleado de su turno: ${columna} NO tiene que llegar (03 §15)`,
      async () => {
        const res = await tabla(clienteDe('supervisor'), 'v_employees')
          .select(columna)
          .eq('profile_id', contexto().ids.empleado1)
        expect(llego(res, columna), `llegó ${columna}: ${describir(res)}`).toBe(
          false,
        )
      },
    )
  }

  // ---- Datos del cliente ante el empleado ----------------------------------------------------
  for (const columna of ['cuit', 'admin_address', 'notes']) {
    caso(
      claveCaso('columnas', 'clients', columna, 'empleado'),
      `[empleado] clients de su turno: ${columna} NO tiene que llegar (04 §7.2: solo el nombre)`,
      async () => {
        const res = await tabla(clienteDe('empleado'), 'clients')
          .select(columna)
          .eq('id', contexto().e.clienteA)
        expect(llego(res, columna), `llegó ${columna}: ${describir(res)}`).toBe(
          false,
        )
      },
    )
  }
})
