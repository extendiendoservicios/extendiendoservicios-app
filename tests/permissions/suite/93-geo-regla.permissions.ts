// tests/permissions/suite/93-geo-regla.permissions.ts — P22.5 (módulo B1)
//
// Casos borde de la regla de validación por ubicación contra las RPC REALES de `App_dev` (B-06,
// B-08, B-23, B-36, B-37): el borde exacto `d = r + a`, la precisión 150 contra 151, el radio
// mínimo y máximo, la sede sin coordenadas, el radio propio contra el general, y que el resultado
// guardado quede congelado cuando después cambian el radio o las coordenadas de la sede.
//
// El esperado sale del PLAN (`modulos/B_asistencia_avanzada.md`), con un oráculo propio escrito acá
// (haversine con radio de 6 371 000 m y las reglas de B-06 y B-23), no de lo que hace la base: si
// la base y el plan se apartan, falla esta suite. La tabla de 12 casos es la que documentó P22.1.
//
// Los datos son propios (`e2e-perm-regla-…`) y se borran al final. Cada fichaje es de una
// asignación propia en un turno de HOY (ventanas de 30 min que no se superponen).

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { isTooCloseToMidnight, todayAR } from '../../fixtures/dates.ts'
import { deleteClientDeep } from '../../fixtures/scenario.ts'
import { clienteDe, contexto, servicio } from './contexto.ts'
import { PREFIJO } from './escenario.ts'

const SEDE = { lat: -34.6037, lng: -58.3816 }
const R_TIERRA = 6_371_000
const M_POR_GRADO = (Math.PI / 180) * R_TIERRA
const CERCA_DE_MEDIANOCHE = isTooCloseToMidnight()

interface Punto {
  lat: number
  lng: number
}

const norte = (base: Punto, metros: number): Punto => ({
  lat: base.lat + metros / M_POR_GRADO,
  lng: base.lng,
})

/** Haversine del plan (B-36): R = 6 371 000 m, sin redondear. */
function haversine(a: Punto, b: Punto): number {
  const rad = (g: number) => (g * Math.PI) / 180
  const h =
    Math.sin(rad(b.lat - a.lat) / 2) ** 2 +
    Math.cos(rad(a.lat)) *
      Math.cos(rad(b.lat)) *
      Math.sin(rad(b.lng - a.lng) / 2) ** 2
  return 2 * R_TIERRA * Math.asin(Math.min(1, Math.sqrt(h)))
}

interface Resultado {
  estado: 'valid' | 'outside' | 'unvalidated'
  motivo: 'no_location' | 'site_without_coords' | 'low_accuracy' | null
  distancia: number | null
}

/** Oráculo de B-06 y B-23: `d` sin redondear; solo se redondea lo que se devuelve. */
function oraculo(
  pos: Punto | null,
  precision: number | null,
  sede: Punto | null,
  radio: number,
  tope = 150,
): Resultado {
  if (!pos || precision === null) {
    return { estado: 'unvalidated', motivo: 'no_location', distancia: null }
  }
  if (!sede) {
    return {
      estado: 'unvalidated',
      motivo: 'site_without_coords',
      distancia: null,
    }
  }
  const d = haversine(pos, sede)
  const distancia = Math.floor(d + 0.5)
  if (d > radio + precision)
    return { estado: 'outside', motivo: null, distancia }
  if (precision <= tope) return { estado: 'valid', motivo: null, distancia }
  return { estado: 'unvalidated', motivo: 'low_accuracy', distancia }
}

type GeoFila = {
  status: string
  reason: string | null
  distance_m: number | null
}

/** Llama a `geo_evaluate` (pura) como el dueño y devuelve la fila. */
async function evaluarEnBase(
  pos: Punto | null,
  precision: number | null,
  sede: Punto | null,
  radio: number,
  tope = 150,
): Promise<Resultado> {
  const { data, error } = await clienteDe('owner').rpc('geo_evaluate', {
    p_lat: (pos?.lat ?? null) as number,
    p_lng: (pos?.lng ?? null) as number,
    p_accuracy: precision as number,
    p_site_lat: (sede?.lat ?? null) as number,
    p_site_lng: (sede?.lng ?? null) as number,
    p_radius: radio,
    p_max_accuracy: tope,
  })
  if (error) throw new Error(`geo_evaluate: ${error.message}`)
  const fila = (data as unknown as GeoFila[])[0]
  return {
    estado: fila.status as Resultado['estado'],
    motivo: fila.reason as Resultado['motivo'],
    distancia: fila.distance_m,
  }
}

// ---------------------------------------------------------------------------------------------
// 1. geo_evaluate: la tabla de P22.1 y una grilla contra el oráculo
// ---------------------------------------------------------------------------------------------

describe('geo_evaluate contra el plan: la tabla de casos y una grilla de bordes (B-06, B-23, B-36)', () => {
  const TABLA: Array<{
    titulo: string
    pos: Punto
    precision: number
    radio: number
    estado: Resultado['estado']
    motivo?: Resultado['motivo']
    distancia: number
  }> = [
    {
      titulo: 'en la sede, precisión 10',
      pos: SEDE,
      precision: 10,
      radio: 150,
      estado: 'valid',
      distancia: 0,
    },
    {
      titulo: 'borde: 111 m, radio 100 y precisión 11,2',
      pos: { lat: -34.6027, lng: -58.3816 },
      precision: 11.2,
      radio: 100,
      estado: 'valid',
      distancia: 111,
    },
    {
      titulo: 'borde: 111 m, radio 100 y precisión 11,1',
      pos: { lat: -34.6027, lng: -58.3816 },
      precision: 11.1,
      radio: 100,
      estado: 'outside',
      distancia: 111,
    },
    {
      titulo: 'tope: precisión 150 con los círculos tocándose',
      pos: SEDE,
      precision: 150,
      radio: 150,
      estado: 'valid',
      distancia: 0,
    },
    {
      titulo: 'tope: precisión 151 con los círculos tocándose',
      pos: SEDE,
      precision: 151,
      radio: 150,
      estado: 'unvalidated',
      motivo: 'low_accuracy',
      distancia: 0,
    },
    {
      titulo: 'precisión 151 lejos de la sede',
      pos: { lat: -34.5937, lng: -58.3816 },
      precision: 151,
      radio: 150,
      estado: 'outside',
      distancia: 1112,
    },
    {
      titulo: 'precisión 150 lejos de la sede',
      pos: { lat: -34.5937, lng: -58.3816 },
      precision: 150,
      radio: 150,
      estado: 'outside',
      distancia: 1112,
    },
    {
      titulo: 'radio 100, a 222 m, precisión 150',
      pos: { lat: -34.6017, lng: -58.3816 },
      precision: 150,
      radio: 100,
      estado: 'valid',
      distancia: 222,
    },
    {
      titulo: 'radio 100, a 222 m, precisión 151',
      pos: { lat: -34.6017, lng: -58.3816 },
      precision: 151,
      radio: 100,
      estado: 'unvalidated',
      motivo: 'low_accuracy',
      distancia: 222,
    },
    {
      titulo: 'radio mínimo (50), a 92 m, precisión 5',
      pos: { lat: -34.6037, lng: -58.3806 },
      precision: 5,
      radio: 50,
      estado: 'outside',
      distancia: 92,
    },
    {
      titulo: 'radio mínimo (50), a 92 m, precisión 45',
      pos: { lat: -34.6037, lng: -58.3806 },
      precision: 45,
      radio: 50,
      estado: 'valid',
      distancia: 92,
    },
    {
      titulo: 'radio máximo (1000), a 901 m, precisión 20',
      pos: { lat: -34.5956, lng: -58.3816 },
      precision: 20,
      radio: 1000,
      estado: 'valid',
      distancia: 901,
    },
  ]

  for (const c of TABLA) {
    it(`${c.titulo} -> ${c.estado}${c.motivo ? ` (${c.motivo})` : ''}, ${c.distancia} m (B-06, B-23)`, async () => {
      const r = await evaluarEnBase(c.pos, c.precision, SEDE, c.radio)
      expect(r).toEqual({
        estado: c.estado,
        motivo: c.motivo ?? null,
        distancia: c.distancia,
      })
      // El oráculo del plan coincide con la tabla (así se detecta una tabla mal copiada).
      expect(oraculo(c.pos, c.precision, SEDE, c.radio)).toEqual(r)
    })
  }

  it('sin posición, sin precisión o con la sede sin coordenadas: «Sin validar» con su motivo; gana «sin ubicación» (B-03)', async () => {
    expect(await evaluarEnBase(null, null, SEDE, 100)).toEqual({
      estado: 'unvalidated',
      motivo: 'no_location',
      distancia: null,
    })
    expect(await evaluarEnBase(SEDE, null, SEDE, 100)).toEqual({
      estado: 'unvalidated',
      motivo: 'no_location',
      distancia: null,
    })
    expect(await evaluarEnBase(SEDE, 10, null, 100)).toEqual({
      estado: 'unvalidated',
      motivo: 'site_without_coords',
      distancia: null,
    })
    expect(await evaluarEnBase(null, null, null, 100)).toEqual({
      estado: 'unvalidated',
      motivo: 'no_location',
      distancia: null,
    })
  })

  it('el borde exacto: con una precisión a ±0,002 m de «d - r», decide la regla y no el redondeo (B-06)', async () => {
    for (const [metros, radio] of [
      [150, 100],
      [80, 50],
      [199.5, 100],
      [250, 150],
      [1000, 1000],
    ] as const) {
      const pos = norte(SEDE, metros)
      const critica = haversine(pos, SEDE) - radio
      for (const delta of [-0.002, 0.002]) {
        const precision = Math.round((critica + delta) * 1000) / 1000
        if (precision < 0) continue
        const r = await evaluarEnBase(pos, precision, SEDE, radio)
        expect(
          r.estado,
          `d=${(critica + radio).toFixed(4)} r=${radio} a=${precision}`,
        ).toBe(delta > 0 ? 'valid' : 'outside')
        expect(r.estado).toBe(oraculo(pos, precision, SEDE, radio).estado)
      }
    }
  })

  it('el tope de precisión es un parámetro: con 100 de tope, la precisión 100 valida y la 100,5 queda sin validar (B-23)', async () => {
    expect((await evaluarEnBase(SEDE, 100, SEDE, 150, 100)).estado).toBe(
      'valid',
    )
    expect(await evaluarEnBase(SEDE, 100.5, SEDE, 150, 100)).toMatchObject({
      estado: 'unvalidated',
      motivo: 'low_accuracy',
    })
  })

  it('una grilla de distancia x precisión x radio da lo mismo que el oráculo del plan (B-37)', async () => {
    const distancias = [
      0, 10, 49, 50, 51, 99, 100, 101, 149, 150, 151, 199, 200, 250, 299, 300,
      301, 499, 500, 1000, 2500,
    ]
    const precisiones = [0, 5, 20, 50, 100, 149.9, 150, 150.1, 151, 300]
    const radios = [50, 100, 150, 1000]
    const casos = distancias.flatMap((m) =>
      precisiones.flatMap((a) => radios.map((r) => ({ m, a, r }))),
    )
    const distintos: string[] = []
    for (let i = 0; i < casos.length; i += 12) {
      const lote = casos.slice(i, i + 12)
      const respuestas = await Promise.all(
        lote.map((c) => evaluarEnBase(norte(SEDE, c.m), c.a, SEDE, c.r)),
      )
      lote.forEach((c, k) => {
        const esperado = oraculo(norte(SEDE, c.m), c.a, SEDE, c.r)
        if (JSON.stringify(esperado) !== JSON.stringify(respuestas[k])) {
          distintos.push(
            `d=${c.m} a=${c.a} r=${c.r}: base ${JSON.stringify(respuestas[k])} contra plan ${JSON.stringify(esperado)}`,
          )
        }
      })
    }
    expect(distintos, `${casos.length} casos`).toEqual([])
  }, 120_000)

  it('geo_distance_m: distancia de 1000 m, cero entre el mismo punto y nula si falta un dato (B-36)', async () => {
    const db = clienteDe('owner')
    const mil = norte(SEDE, 1000)
    const a = await db.rpc('geo_distance_m', {
      p_lat1: SEDE.lat,
      p_lng1: SEDE.lng,
      p_lat2: mil.lat,
      p_lng2: mil.lng,
    })
    expect(a.error, a.error?.message).toBeNull()
    expect(Math.abs((a.data as number) - 1000)).toBeLessThan(0.01)
    const cero = await db.rpc('geo_distance_m', {
      p_lat1: SEDE.lat,
      p_lng1: SEDE.lng,
      p_lat2: SEDE.lat,
      p_lng2: SEDE.lng,
    })
    expect(cero.data).toBe(0)
    const nula = await db.rpc('geo_distance_m', {
      p_lat1: SEDE.lat,
      p_lng1: SEDE.lng,
      p_lat2: null as unknown as number,
      p_lng2: SEDE.lng,
    })
    expect(nula.error, nula.error?.message).toBeNull()
    expect(
      nula.data,
      'con un dato nulo la distancia es nula, no la mitad del planeta',
    ).toBeNull()
  })
})

// ---------------------------------------------------------------------------------------------
// 2. Fichajes reales: record_check_in, record_check_out y las de supervisión
// ---------------------------------------------------------------------------------------------

interface Fichaje {
  estado: string
  motivo: string | null
  distancia: number | null
  radio: number | null
  motivoEmpleado: string | null
  precision: number | null
  lat: number | null
}

let clienteId = ''
let sedeConCoords = ''
let sedeSinCoords = ''
let sedeRadioGeneral = ''
let radioGeneral = 0
let dia = ''
const ranuras = { empleado: 0, dual: 0 }

async function aceptar<T>(
  que: string,
  p: PromiseLike<{ data: T; error: { message: string } | null }>,
): Promise<NonNullable<T>> {
  const { data, error } = await p
  if (error || data === null || data === undefined) {
    throw new Error(`93-geo-regla (${que}): ${error?.message ?? 'sin datos'}`)
  }
  return data
}

/** Turno de hoy de 30 min (ranura propia, sin superposición) con la asignación de `quien`. */
async function nuevaAsignacion(
  quien: 'empleado' | 'dual',
  sedeId: string,
): Promise<string> {
  const c = contexto()
  const hora = ranuras[quien]++
  if (hora > 23)
    throw new Error('Se acabaron las ranuras del día para este empleado.')
  const hh = String(hora).padStart(2, '0')
  const turno = await aceptar(
    'turno',
    servicio()
      .from('shifts')
      .insert({
        client_id: clienteId,
        site_id: sedeId,
        shift_date: dia,
        start_time: `${hh}:00`,
        end_time: `${hh}:30`,
        required_staff: 1,
      })
      .select('id')
      .single(),
  )
  const { data, error } = await clienteDe('owner').rpc('assign_employee', {
    p_shift_id: turno.id,
    p_employee_id: quien === 'empleado' ? c.ids.empleado1 : c.ids.dual,
  })
  if (error) throw new Error(`assign_employee: ${error.message}`)
  return (data as unknown as { assignment: { id: string } }).assignment.id
}

async function leerFichaje(
  asignacionId: string,
  kind: 'check_in' | 'check_out',
): Promise<Fichaje> {
  const f = await aceptar(
    'fichaje',
    servicio()
      .from('attendance_records')
      .select(
        'geo_status, geo_unvalidated_reason, site_distance_m, geofence_radius_m, outside_reason, accuracy_m, latitude',
      )
      .eq('assignment_id', asignacionId)
      .eq('kind', kind)
      .single(),
  )
  return {
    estado: f.geo_status,
    motivo: f.geo_unvalidated_reason,
    distancia: f.site_distance_m,
    radio: f.geofence_radius_m,
    motivoEmpleado: f.outside_reason,
    precision: f.accuracy_m === null ? null : Number(f.accuracy_m),
    lat: f.latitude === null ? null : Number(f.latitude),
  }
}

async function ficharInicio(
  quien: 'empleado' | 'dual',
  asignacionId: string,
  pos: Punto | null,
  precision: number | null,
  motivo?: string,
) {
  return clienteDe(quien).rpc('record_check_in', {
    p_assignment_id: asignacionId,
    ...(pos ? { p_lat: pos.lat, p_lng: pos.lng } : {}),
    ...(precision !== null ? { p_accuracy: precision } : {}),
    ...(motivo !== undefined ? { p_outside_reason: motivo } : {}),
  })
}

beforeAll(async () => {
  if (CERCA_DE_MEDIANOCHE) return
  dia = todayAR()
  const db = servicio()
  const nombre = `${PREFIJO}regla-${Date.now().toString(36)}`
  const cliente = await aceptar(
    'cliente',
    db
      .from('clients')
      .insert({
        legal_name: nombre,
        trade_name: nombre,
        cuit: `20${`${Date.now()}`.slice(-8)}${Math.floor(Math.random() * 10)}`,
        status: 'active',
      })
      .select('id')
      .single(),
  )
  clienteId = cliente.id
  const sede = async (
    slug: string,
    coords: Punto | null,
    radio: number | null,
  ) =>
    (
      await aceptar(
        slug,
        db
          .from('sites')
          .insert({
            client_id: clienteId,
            name: `${nombre}-${slug}`,
            address: 'Dirección de prueba 123',
            status: 'active',
            latitude: coords?.lat ?? null,
            longitude: coords?.lng ?? null,
            geofence_radius_m: radio,
          })
          .select('id')
          .single(),
      )
    ).id
  sedeConCoords = await sede('con-coords', SEDE, 100)
  sedeSinCoords = await sede('sin-coords', null, null)
  sedeRadioGeneral = await sede('radio-general', SEDE, null)
  const empresa = await aceptar(
    'company_settings',
    db
      .from('company_settings')
      .select('geofence_radius_m')
      .eq('id', 1)
      .single(),
  )
  radioGeneral = empresa.geofence_radius_m
}, 120_000)

afterAll(async () => {
  if (!clienteId) return
  const notas = await deleteClientDeep(servicio(), clienteId)
  if (notas.length > 0)
    console.warn(`[93-geo-regla] limpieza con notas: ${notas.join(' | ')}`)
}, 120_000)

describe.skipIf(CERCA_DE_MEDIANOCHE)(
  'record_check_in contra el oráculo del plan: bordes, tope de precisión y radio mínimo y máximo (B-06, B-23, B-37)',
  () => {
    const CASOS: Array<{
      titulo: string
      metros: number
      precision: number
      quien: 'empleado' | 'dual'
    }> = [
      {
        titulo: 'a 149,9 m con precisión 50 (radio 100): adentro por 0,1 m',
        metros: 149.9,
        precision: 50,
        quien: 'empleado',
      },
      {
        titulo: 'a 150,1 m con precisión 50 (radio 100): afuera por 0,1 m',
        metros: 150.1,
        precision: 50,
        quien: 'empleado',
      },
      {
        titulo: 'precisión 150 en la sede',
        metros: 0,
        precision: 150,
        quien: 'empleado',
      },
      {
        titulo: 'precisión 151 en la sede',
        metros: 0,
        precision: 151,
        quien: 'empleado',
      },
      {
        titulo: 'precisión 151 a 1112 m',
        metros: 1112,
        precision: 151,
        quien: 'empleado',
      },
      {
        titulo: 'precisión 150 a 1112 m',
        metros: 1112,
        precision: 150,
        quien: 'dual',
      },
      {
        titulo: 'precisión 0,5 a 100,4 m: adentro',
        metros: 100.4,
        precision: 0.5,
        quien: 'dual',
      },
      {
        titulo: 'precisión 0,5 a 100,6 m: afuera',
        metros: 100.6,
        precision: 0.5,
        quien: 'dual',
      },
    ]
    for (const c of CASOS) {
      it(`${c.titulo} (B-06, B-23)`, async () => {
        const asig = await nuevaAsignacion(c.quien, sedeConCoords)
        const pos = norte(SEDE, c.metros)
        const { error } = await ficharInicio(c.quien, asig, pos, c.precision)
        expect(error, error?.message).toBeNull()
        const guardado = await leerFichaje(asig, 'check_in')
        const esperado = oraculo(pos, c.precision, SEDE, 100)
        expect(guardado.estado).toBe(esperado.estado)
        expect(guardado.motivo).toBe(esperado.motivo)
        expect(guardado.distancia).toBe(esperado.distancia)
        expect(guardado.radio, 'el radio vigente de la sede').toBe(100)
        expect(guardado.precision).toBe(c.precision)
      })
    }

    it('radio propio de la sede contra radio general: sin radio propio se usa el general y queda guardado el vigente (B-02, B-08)', async () => {
      const dentro = norte(SEDE, radioGeneral - 20)
      const fuera = norte(SEDE, radioGeneral + 20)
      for (const [pos, esperado] of [
        [dentro, 'valid'],
        [fuera, 'outside'],
      ] as const) {
        const asig = await nuevaAsignacion('empleado', sedeRadioGeneral)
        const { error } = await ficharInicio('empleado', asig, pos, 5)
        expect(error, error?.message).toBeNull()
        const g = await leerFichaje(asig, 'check_in')
        expect(g.estado).toBe(esperado)
        expect(g.radio, 'queda el radio general vigente').toBe(radioGeneral)
      }
    })

    it('sin ubicación: «Sin validar / sin ubicación», sin distancia y con el radio vigente guardado (B-03, B-05)', async () => {
      const asig = await nuevaAsignacion('dual', sedeConCoords)
      const { error } = await ficharInicio('dual', asig, null, null)
      expect(error, error?.message).toBeNull()
      expect(await leerFichaje(asig, 'check_in')).toMatchObject({
        estado: 'unvalidated',
        motivo: 'no_location',
        distancia: null,
        radio: 100,
        lat: null,
      })
    })

    it('sede sin coordenadas: «Sin validar / sede sin coordenadas»; la posición del empleado se guarda igual (B-03, CB-20)', async () => {
      const asig = await nuevaAsignacion('dual', sedeSinCoords)
      const { error } = await ficharInicio('dual', asig, SEDE, 10)
      expect(error, error?.message).toBeNull()
      const g = await leerFichaje(asig, 'check_in')
      expect(g).toMatchObject({
        estado: 'unvalidated',
        motivo: 'site_without_coords',
        distancia: null,
      })
      expect(g.lat).not.toBeNull()
      expect(g.radio, 'sin radio propio, el general').toBe(radioGeneral)
    })
  },
)

describe.skipIf(CERCA_DE_MEDIANOCHE)(
  'el resultado queda congelado: cambiar después el radio o las coordenadas de la sede no recalcula (B-08)',
  () => {
    it('un fichaje validado a 60 m no cambia al bajar el radio a 50 m ni al mover la sede; el fin sí se evalúa con lo nuevo', async () => {
      const asig = await nuevaAsignacion('empleado', sedeConCoords)
      const cerca = norte(SEDE, 60)
      const inicio = await ficharInicio('empleado', asig, cerca, 5)
      expect(inicio.error, inicio.error?.message).toBeNull()
      const antes = await leerFichaje(asig, 'check_in')
      expect(antes).toMatchObject({
        estado: 'valid',
        radio: 100,
        distancia: 60,
      })

      // Ahora la sede se achica (50 m) y se corre 500 m al norte: con las reglas nuevas, esos mismos
      // datos darían «Fuera de zona»; lo guardado no se toca.
      const nuevaSede = norte(SEDE, 500)
      const cambio = await servicio()
        .from('sites')
        .update({
          geofence_radius_m: 50,
          latitude: nuevaSede.lat,
          longitude: nuevaSede.lng,
        })
        .eq('id', sedeConCoords)
      expect(cambio.error, cambio.error?.message).toBeNull()
      try {
        expect(
          await leerFichaje(asig, 'check_in'),
          'el inicio quedó congelado',
        ).toEqual(antes)
        const fin = await clienteDe('empleado').rpc('record_check_out', {
          p_assignment_id: asig,
          p_lat: cerca.lat,
          p_lng: cerca.lng,
          p_accuracy: 5,
        })
        expect(fin.error, fin.error?.message).toBeNull()
        const g = await leerFichaje(asig, 'check_out')
        expect(
          g.estado,
          'el fin se evalúa con el radio y las coordenadas vigentes',
        ).toBe('outside')
        expect(g.radio).toBe(50)
        expect(g.distancia).toBe(oraculo(cerca, 5, nuevaSede, 50).distancia)
        expect(
          await leerFichaje(asig, 'check_in'),
          'el inicio sigue igual después del fin',
        ).toEqual(antes)
      } finally {
        await servicio()
          .from('sites')
          .update({
            geofence_radius_m: 100,
            latitude: SEDE.lat,
            longitude: SEDE.lng,
          })
          .eq('id', sedeConCoords)
      }
    })

    it('la corrección de la validación no pisa el resultado original (B-09)', async () => {
      const asig = await nuevaAsignacion('empleado', sedeConCoords)
      const inicio = await ficharInicio('empleado', asig, norte(SEDE, 800), 10)
      expect(inicio.error, inicio.error?.message).toBeNull()
      const original = await leerFichaje(asig, 'check_in')
      expect(original.estado).toBe('outside')
      const { data: fila } = await servicio()
        .from('attendance_records')
        .select('id')
        .eq('assignment_id', asig)
        .eq('kind', 'check_in')
        .single()
      const v = await clienteDe('admin').rpc('override_geo_validation', {
        p_record_type: 'attendance',
        p_record_id: fila!.id,
        p_reason: 'e2e-perm: regla',
      })
      expect(v.error, v.error?.message).toBeNull()
      expect(await leerFichaje(asig, 'check_in')).toEqual(original)
    })
  },
)

describe.skipIf(CERCA_DE_MEDIANOCHE)(
  'motivo de «Fuera de zona» y validación de lo que se manda (B-04)',
  () => {
    it('el motivo se recorta y se guarda solo si el resultado es «Fuera de zona»; hasta 300 caracteres', async () => {
      const afuera = norte(SEDE, 700)
      const a1 = await nuevaAsignacion('empleado', sedeConCoords)
      expect(
        (
          await ficharInicio(
            'empleado',
            a1,
            afuera,
            10,
            '   se cortó el GPS   ',
          )
        ).error,
      ).toBeNull()
      expect((await leerFichaje(a1, 'check_in')).motivoEmpleado).toBe(
        'se cortó el GPS',
      )

      const a2 = await nuevaAsignacion('empleado', sedeConCoords)
      expect(
        (await ficharInicio('empleado', a2, afuera, 10, '    ')).error,
      ).toBeNull()
      expect(
        (await leerFichaje(a2, 'check_in')).motivoEmpleado,
        'solo espacios: sin motivo',
      ).toBeNull()

      const a3 = await nuevaAsignacion('empleado', sedeConCoords)
      const justo = 'x'.repeat(300)
      expect(
        (await ficharInicio('empleado', a3, afuera, 10, justo)).error,
      ).toBeNull()
      expect((await leerFichaje(a3, 'check_in')).motivoEmpleado).toBe(justo)

      const a4 = await nuevaAsignacion('dual', sedeConCoords)
      expect(
        (await ficharInicio('dual', a4, SEDE, 10, 'no corresponde')).error,
      ).toBeNull()
      const g = await leerFichaje(a4, 'check_in')
      expect(g.estado).toBe('valid')
      expect(
        g.motivoEmpleado,
        'con resultado «Validado» el motivo se descarta',
      ).toBeNull()
    })

    it('un motivo de 301 caracteres se rechaza con OUTSIDE_REASON_TOO_LONG y no se registra nada', async () => {
      const asig = await nuevaAsignacion('empleado', sedeConCoords)
      const { error } = await ficharInicio(
        'empleado',
        asig,
        norte(SEDE, 700),
        10,
        'x'.repeat(301),
      )
      expect(error?.hint, error?.message).toBe('OUTSIDE_REASON_TOO_LONG')
      const { count } = await servicio()
        .from('attendance_records')
        .select('id', { count: 'exact', head: true })
        .eq('assignment_id', asig)
      expect(count).toBe(0)
    })

    it('ubicación incompleta o fuera de rango se rechaza y no se registra nada (COORDINATES_INCOMPLETE, COORDINATES_OUT_OF_RANGE)', async () => {
      const asig = await nuevaAsignacion('empleado', sedeConCoords)
      const llamada = (args: Record<string, unknown>) =>
        clienteDe('empleado').rpc('record_check_in', {
          p_assignment_id: asig,
          ...args,
        } as never)
      const sinLng = await llamada({ p_lat: SEDE.lat, p_accuracy: 10 })
      expect(sinLng.error?.hint).toBe('COORDINATES_INCOMPLETE')
      const sinPrecision = await llamada({ p_lat: SEDE.lat, p_lng: SEDE.lng })
      expect(sinPrecision.error?.hint).toBe('COORDINATES_INCOMPLETE')
      const lat91 = await llamada({
        p_lat: 91,
        p_lng: SEDE.lng,
        p_accuracy: 10,
      })
      expect(lat91.error?.hint).toBe('COORDINATES_OUT_OF_RANGE')
      const lng181 = await llamada({
        p_lat: SEDE.lat,
        p_lng: 181,
        p_accuracy: 10,
      })
      expect(lng181.error?.hint).toBe('COORDINATES_OUT_OF_RANGE')
      const negativa = await llamada({
        p_lat: SEDE.lat,
        p_lng: SEDE.lng,
        p_accuracy: -1,
      })
      expect(negativa.error?.hint).toBe('COORDINATES_OUT_OF_RANGE')
      const { count } = await servicio()
        .from('attendance_records')
        .select('id', { count: 'exact', head: true })
        .eq('assignment_id', asig)
      expect(count, 'ninguna llamada inválida registró el inicio').toBe(0)
    })
  },
)

describe.skipIf(CERCA_DE_MEDIANOCHE)(
  'quién puede fichar y contra qué sede se valida (B-07)',
  () => {
    it('cada uno ficha solo lo suyo: empleado ajeno, supervisor y administración no pueden fichar un turno ajeno', async () => {
      const asig = await nuevaAsignacion('empleado', sedeConCoords)
      const comoDual = await clienteDe('dual').rpc('record_check_in', {
        p_assignment_id: asig,
        p_lat: SEDE.lat,
        p_lng: SEDE.lng,
        p_accuracy: 5,
      })
      expect(comoDual.error?.hint).toBe('NOT_YOUR_ASSIGNMENT')
      for (const perfil of [
        'supervisor',
        'adminSin',
        'admin',
        'owner',
      ] as const) {
        const r = await clienteDe(perfil).rpc('record_check_in', {
          p_assignment_id: asig,
        })
        expect(r.error?.hint, `${perfil}: ${r.error?.message}`).toBe(
          'FORBIDDEN',
        )
      }
      const anon = await clienteDe('anon').rpc('record_check_in', {
        p_assignment_id: asig,
      })
      expect(anon.error?.code).toBe('42501')
      const { count } = await servicio()
        .from('attendance_records')
        .select('id', { count: 'exact', head: true })
        .eq('assignment_id', asig)
      expect(count).toBe(0)
    })

    it('la supervisión se valida contra la sede del turno supervisado, con la misma regla; el ajeno no puede fichar la de otro (B-07)', async () => {
      const c = contexto()
      const turno = await aceptar(
        'turno de supervisión',
        servicio()
          .from('shifts')
          .insert({
            client_id: clienteId,
            site_id: sedeConCoords,
            shift_date: dia,
            start_time: '23:00',
            end_time: '23:59',
            required_staff: 1,
          })
          .select('id')
          .single(),
      )
      const sup = await clienteDe('owner').rpc('assign_supervision', {
        p_shift_id: turno.id,
        p_supervisor_id: c.ids.supervisor1,
      })
      expect(sup.error, sup.error?.message).toBeNull()
      const supervisionId = (
        sup.data as unknown as { supervision: { id: string } }
      ).supervision.id

      // Otro supervisor (el doble rol) no puede fichar la supervisión de supervisor1.
      const ajeno = await clienteDe('dual').rpc('supervision_check_in', {
        p_supervision_id: supervisionId,
        p_lat: SEDE.lat,
        p_lng: SEDE.lng,
        p_accuracy: 5,
      })
      expect(ajeno.error?.hint).toBe('NOT_YOUR_SUPERVISION')
      // Un empleado no puede usar la RPC de supervisión.
      const empleado = await clienteDe('empleado').rpc('supervision_check_in', {
        p_supervision_id: supervisionId,
      })
      expect(empleado.error?.hint).toBe('FORBIDDEN')

      // El inicio a 120 m con precisión 30 (radio 100): 120 <= 130, adentro.
      const pos = norte(SEDE, 120)
      const ini = await clienteDe('supervisor').rpc('supervision_check_in', {
        p_supervision_id: supervisionId,
        p_lat: pos.lat,
        p_lng: pos.lng,
        p_accuracy: 30,
      })
      expect(ini.error, ini.error?.message).toBeNull()
      // El fin a 800 m con precisión 200 (> tope): se tocan? 800 > 300: afuera.
      const lejos = norte(SEDE, 800)
      const fin = await clienteDe('supervisor').rpc('supervision_check_out', {
        p_supervision_id: supervisionId,
        p_lat: lejos.lat,
        p_lng: lejos.lng,
        p_accuracy: 200,
        p_outside_reason: 'e2e-perm: supervisión',
      })
      expect(fin.error, fin.error?.message).toBeNull()
      const { data } = await servicio()
        .from('supervision_attendance')
        .select(
          'kind, geo_status, geo_unvalidated_reason, site_distance_m, geofence_radius_m, outside_reason',
        )
        .eq('supervision_id', supervisionId)
      const inicio = data!.find((f) => f.kind === 'check_in')!
      const salida = data!.find((f) => f.kind === 'check_out')!
      expect(inicio).toMatchObject({
        geo_status: 'valid',
        geofence_radius_m: 100,
        site_distance_m: oraculo(pos, 30, SEDE, 100).distancia,
      })
      expect(salida).toMatchObject({
        geo_status: 'outside',
        outside_reason: 'e2e-perm: supervisión',
      })
    })

    it('lo que registra la administración en nombre de otro queda «Sin validar / registrado por la administración», sin distancia ni radio (B-03)', async () => {
      const asig = await nuevaAsignacion('dual', sedeConCoords)
      const { error } = await clienteDe('admin').rpc(
        'admin_record_attendance',
        {
          p_assignment_id: asig,
          p_kind: 'check_in',
          p_reason: 'e2e-perm: se olvidó de fichar',
          p_at: `${dia}T00:01:00-03:00`,
        },
      )
      expect(error, error?.message).toBeNull()
      expect(await leerFichaje(asig, 'check_in')).toMatchObject({
        estado: 'unvalidated',
        motivo: 'admin_record',
        distancia: null,
        radio: null,
      })
    })
  },
)
