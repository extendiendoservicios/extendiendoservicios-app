// scripts/import-initial/validar.ts — DATA-003
//
// Valida toda la planilla leída, sin tocar la base, y arma el plan que después escribe
// `cargar.ts`. Regla de la plantilla, que también rige acá: se BLOQUEA (error) solo donde
// Postgres rechazaría la fila (un `check`, un `unique`, una clave foránea, un `not null`) o donde
// no hay forma de saber a qué se refiere el dato; se AVISA (advertencia) donde la regla es una
// ayuda nuestra (dígito verificador de CUIT/CUIL, largo del DNI, coordenadas fuera de rango).
//
// Cada incidencia lleva hoja, fila de Excel, columna y un mensaje en español para la empresa.
// Hay tres casos que no los rechaza la base pero igual son error, porque sin distinguirlos no se
// podría reintentar la carga con `--resume` (que identifica lo ya cargado por clave natural):
// dos contactos del mismo cliente con el mismo nombre, dos servicios de la misma sede con el
// mismo nombre y dos criterios con el mismo título.
//
// Funciones de validación puras: reciben la lectura y devuelven incidencias y plan. Los tests
// las ejercitan con planillas ficticias (ver `validar.test.ts`).

import { DIAS_SERVICIO, tituloColumna } from './esquema.ts'
import {
  claveNorm,
  emailValido,
  esSoloDigitos,
  parsearEntero,
  parsearFecha,
  parsearHora,
  parsearLista,
  parsearNumero,
  parsearSiNo,
  soloDigitos,
  texto,
  verificadorValido,
} from './normalizar.ts'
import type {
  EstadoCliente,
  EstadoPersona,
  EstadoSede,
  EstadoServicio,
  FilaLeida,
  Incidencia,
  LecturaPlantilla,
  NombreHoja,
  Plan,
  PlanCliente,
  PlanContacto,
  PlanCriterio,
  PlanFeriado,
  PlanHabilitacion,
  PlanPersona,
  PlanSede,
  PlanServicio,
  ResultadoValidacion,
  RolPersona,
} from './tipos.ts'

const NOMBRE_SEDE_AUTOMATICA = 'Principal'

const ETIQUETAS_CLIENTE: Record<string, EstadoCliente> = {
  activo: 'active',
  suspendido: 'suspended',
  baja: 'closed',
}
const ETIQUETAS_SEDE: Record<string, EstadoSede> = {
  activa: 'active',
  inactiva: 'inactive',
}
const ETIQUETAS_PERSONA: Record<string, EstadoPersona> = {
  activo: 'active',
  baja: 'terminated',
}
const ETIQUETAS_SERVICIO: Record<string, EstadoServicio> = {
  activo: 'active',
  pausado: 'paused',
  finalizado: 'ended',
}

// -------------------------------------------------------------------------------------------
// Contexto por hoja: arma las incidencias y lee celdas con su validación
// -------------------------------------------------------------------------------------------

class Contexto {
  readonly incidencias: Incidencia[]
  /** DNI (solo dígitos) de las personas de Baja que no se cargan, para avisar en Habilitaciones. */
  readonly dnisDeBaja = new Set<string>()

  constructor(incidencias: Incidencia[]) {
    this.incidencias = incidencias
  }

  hoja(nombre: NombreHoja): ContextoHoja {
    return new ContextoHoja(this.incidencias, nombre)
  }
}

class ContextoHoja {
  readonly nombre: NombreHoja
  private readonly incidencias: Incidencia[]

  constructor(incidencias: Incidencia[], nombre: NombreHoja) {
    this.incidencias = incidencias
    this.nombre = nombre
  }

  error(
    fila: number | null,
    campo: string | null,
    codigo: string,
    mensaje: string,
  ): void {
    this.registrar('error', fila, campo, codigo, mensaje)
  }

  aviso(
    fila: number | null,
    campo: string | null,
    codigo: string,
    mensaje: string,
  ): void {
    this.registrar('advertencia', fila, campo, codigo, mensaje)
  }

  /** Fila que no se carga a propósito (no es un error: queda en el informe como ignorada). */
  ignorada(
    fila: number | null,
    campo: string | null,
    codigo: string,
    mensaje: string,
  ): void {
    this.registrar('ignorada', fila, campo, codigo, mensaje)
  }

  private registrar(
    nivel: 'error' | 'advertencia' | 'ignorada',
    fila: number | null,
    campo: string | null,
    codigo: string,
    mensaje: string,
  ): void {
    this.incidencias.push({
      nivel,
      hoja: this.nombre,
      fila,
      columna: campo === null ? null : tituloColumna(this.nombre, campo),
      codigo,
      mensaje,
    })
  }

  titulo(campo: string): string {
    return tituloColumna(this.nombre, campo)
  }

  fila(f: FilaLeida): LectorFila {
    return new LectorFila(this, f)
  }
}

class LectorFila {
  private readonly ctx: ContextoHoja
  private readonly f: FilaLeida

  constructor(ctx: ContextoHoja, f: FilaLeida) {
    this.ctx = ctx
    this.f = f
  }

  get numero(): number {
    return this.f.fila
  }

  crudo(campo: string) {
    return this.f.celdas[campo] ?? null
  }

  private falta(campo: string): void {
    this.ctx.error(
      this.f.fila,
      campo,
      'FALTA_DATO',
      `Falta completar "${this.ctx.titulo(campo)}": es obligatorio.`,
    )
  }

  txt(campo: string, obligatorio = false): string | null {
    const v = texto(this.crudo(campo))
    if (v === null && obligatorio) this.falta(campo)
    return v
  }

  fecha(campo: string, obligatorio = false): string | null {
    const r = parsearFecha(this.crudo(campo))
    if (!r.ok) {
      this.ctx.error(
        this.f.fila,
        campo,
        'FECHA_INVALIDA',
        `"${texto(this.crudo(campo)) ?? ''}" no es una fecha válida. Escribila como DD/MM/AAAA (por ejemplo 05/03/2026).`,
      )
      return null
    }
    if (r.valor === null && obligatorio) this.falta(campo)
    return r.valor
  }

  hora(campo: string, obligatorio = false): string | null {
    const r = parsearHora(this.crudo(campo))
    if (!r.ok) {
      this.ctx.error(
        this.f.fila,
        campo,
        'HORA_INVALIDA',
        `"${texto(this.crudo(campo)) ?? ''}" no es una hora válida. Escribila como HH:MM, de 00:00 a 23:59.`,
      )
      return null
    }
    if (r.valor === null && obligatorio) this.falta(campo)
    return r.valor
  }

  siNo(campo: string, porDefecto: boolean): boolean {
    const r = parsearSiNo(this.crudo(campo))
    if (!r.ok) {
      this.ctx.error(
        this.f.fila,
        campo,
        'SI_NO_INVALIDO',
        `"${texto(this.crudo(campo)) ?? ''}" no es válido: elegí "Sí" o "No".`,
      )
      return porDefecto
    }
    return r.valor ?? porDefecto
  }

  lista<T extends string>(
    campo: string,
    etiquetas: Record<string, T>,
    porDefecto: T,
    opciones: string,
  ): T {
    const r = parsearLista(this.crudo(campo), etiquetas)
    if (!r.ok) {
      this.ctx.error(
        this.f.fila,
        campo,
        'OPCION_INVALIDA',
        `"${texto(this.crudo(campo)) ?? ''}" no es una opción válida. Elegí una de la lista: ${opciones}.`,
      )
      return porDefecto
    }
    return r.valor ?? porDefecto
  }

  entero(
    campo: string,
    minimo: number,
    maximo: number,
    obligatorio = false,
  ): number | null {
    const r = parsearEntero(this.crudo(campo))
    if (!r.ok) {
      this.ctx.error(
        this.f.fila,
        campo,
        'NUMERO_INVALIDO',
        `"${texto(this.crudo(campo)) ?? ''}" no es un número entero válido.`,
      )
      return null
    }
    if (r.valor === null) {
      if (obligatorio) this.falta(campo)
      return null
    }
    if (r.valor < minimo || r.valor > maximo) {
      this.ctx.error(
        this.f.fila,
        campo,
        'NUMERO_FUERA_DE_RANGO',
        `El valor ${r.valor} tiene que estar entre ${minimo} y ${maximo}.`,
      )
      return null
    }
    return r.valor
  }

  /** Horas mensuales: `numeric(6,2)` admite hasta 9999,99. */
  horasMensuales(campo: string): number | null {
    const r = parsearNumero(this.crudo(campo))
    if (!r.ok) {
      this.ctx.error(
        this.f.fila,
        campo,
        'NUMERO_INVALIDO',
        `"${texto(this.crudo(campo)) ?? ''}" no es un número válido.`,
      )
      return null
    }
    if (r.valor === null) return null
    if (r.valor >= 10_000) {
      this.ctx.error(
        this.f.fila,
        campo,
        'NUMERO_FUERA_DE_RANGO',
        `El valor ${r.valor} es demasiado grande (máximo 9999,99).`,
      )
      return null
    }
    if (r.valor < 0) {
      this.ctx.aviso(
        this.f.fila,
        campo,
        'NUMERO_NEGATIVO',
        `Las horas no pueden ser negativas: se carga el servicio sin este dato.`,
      )
      return null
    }
    return r.valor
  }

  /**
   * Latitud y longitud (`numeric(9,6)`: la base rechaza valores de 1000 o más). Fuera del rango
   * geográfico (±90, ±180) es una advertencia: se carga la fila sin coordenadas.
   */
  coordenadas(
    campoLat: string,
    campoLon: string,
  ): { latitud: number | null; longitud: number | null } {
    const leer = (campo: string, limite: number): number | null => {
      const r = parsearNumero(this.crudo(campo))
      if (!r.ok) {
        this.ctx.error(
          this.f.fila,
          campo,
          'NUMERO_INVALIDO',
          `"${texto(this.crudo(campo)) ?? ''}" no es un número válido (podés usar coma o punto decimal).`,
        )
        return null
      }
      if (r.valor === null) return null
      if (Math.abs(r.valor) >= 1000) {
        this.ctx.error(
          this.f.fila,
          campo,
          'NUMERO_FUERA_DE_RANGO',
          `El valor ${r.valor} es demasiado grande para una coordenada.`,
        )
        return null
      }
      if (Math.abs(r.valor) > limite) {
        this.ctx.aviso(
          this.f.fila,
          campo,
          'COORDENADA_FUERA_DE_RANGO',
          `El valor ${r.valor} no es una coordenada posible (tiene que estar entre -${limite} y ${limite}): se carga sin coordenadas.`,
        )
        return null
      }
      return r.valor
    }
    let latitud = leer(campoLat, 90)
    let longitud = leer(campoLon, 180)
    if ((latitud === null) !== (longitud === null)) {
      const hay = latitud === null ? campoLon : campoLat
      // Solo se avisa si el dato presente era válido (si no, ya hay otro aviso o error).
      if (parsearNumero(this.crudo(hay)).ok) {
        this.ctx.aviso(
          this.f.fila,
          hay,
          'COORDENADA_INCOMPLETA',
          'Hay latitud sin longitud (o al revés): se carga sin coordenadas.',
        )
      }
      latitud = null
      longitud = null
    }
    return { latitud, longitud }
  }

  /** CUIT o CUIL: opcional, 11 dígitos (la base lo exige). Devuelve el valor limpio o `null`. */
  cuitOCuil(campo: string, que: 'CUIT' | 'CUIL'): string | null {
    const crudo = texto(this.crudo(campo))
    if (crudo === null) return null
    const limpio = soloDigitos(crudo)
    if (!esSoloDigitos(limpio)) {
      this.ctx.error(
        this.f.fila,
        campo,
        `${que}_FORMATO`,
        `El ${que} "${crudo}" tiene que tener solo números (11 dígitos, sin puntos ni guiones). Si no lo tiene, dejá la celda vacía.`,
      )
      return null
    }
    if (limpio.length !== 11) {
      this.ctx.error(
        this.f.fila,
        campo,
        `${que}_LARGO`,
        `El ${que} "${crudo}" tiene ${limpio.length} dígitos y tiene que tener 11.`,
      )
      return null
    }
    if (limpio !== crudo) {
      this.ctx.aviso(
        this.f.fila,
        campo,
        `${que}_LIMPIADO`,
        `Se quitaron puntos, guiones o espacios del ${que} (se carga ${limpio}).`,
      )
    }
    if (!verificadorValido(limpio)) {
      this.ctx.aviso(
        this.f.fila,
        campo,
        `${que}_VERIFICADOR`,
        `El ${que} ${limpio} tiene el dígito verificador incorrecto: puede haber un error de tipeo. Se carga igual; revisalo.`,
      )
    }
    return limpio
  }
}

function filasTexto(filas: number[]): string {
  return filas.join(', ')
}

function agrupar<T>(
  items: T[],
  clave: (item: T) => string | null,
): Map<string, T[]> {
  const grupos = new Map<string, T[]>()
  for (const item of items) {
    const k = clave(item)
    if (k === null) continue
    const g = grupos.get(k)
    if (g) g.push(item)
    else grupos.set(k, [item])
  }
  return grupos
}

// -------------------------------------------------------------------------------------------
// Vínculo con clientes: por CUIT o, si no tiene, por razón social
// -------------------------------------------------------------------------------------------

type ResultadoCliente =
  { cliente: PlanCliente } | { error: { codigo: string; mensaje: string } }

/**
 * Cómo se escribe la referencia a un cliente en las hojas hijas (columna "Cliente (CUIT o razón social)"):
 *  - solo números (con o sin guiones o puntos) = CUIT; tiene que existir en la hoja Clientes;
 *  - cualquier otro texto = razón social exacta (sin distinguir mayúsculas ni espacios de más).
 * Si varios clientes comparten esa razón social, se elige el que no tiene CUIT (los que sí lo
 * tienen se pueden nombrar por CUIT); si aun así quedan varios, la referencia es ambigua (error).
 */
function crearResolvedorDeClientes(clientes: PlanCliente[]) {
  const porCuit = new Map<string, PlanCliente>()
  for (const c of clientes)
    if (c.cuit && !porCuit.has(c.cuit)) porCuit.set(c.cuit, c)
  const porNombre = agrupar(clientes, (c) => claveNorm(c.razonSocial))

  return (referencia: string): ResultadoCliente => {
    const limpia = soloDigitos(referencia)
    if (esSoloDigitos(limpia)) {
      const c = porCuit.get(limpia)
      if (c) return { cliente: c }
      return {
        error: {
          codigo: 'CLIENTE_NO_ENCONTRADO',
          mensaje: `No hay ningún cliente con el CUIT ${limpia} en la hoja Clientes. Revisá que esté escrito igual que allá.`,
        },
      }
    }
    const candidatos = porNombre.get(claveNorm(referencia)) ?? []
    if (candidatos.length === 0) {
      return {
        error: {
          codigo: 'CLIENTE_NO_ENCONTRADO',
          mensaje: `No hay ningún cliente con la razón social "${referencia}" en la hoja Clientes. Tiene que estar escrita igual que allá (no importan mayúsculas ni espacios de más).`,
        },
      }
    }
    if (candidatos.length === 1) return { cliente: candidatos[0] }
    const sinCuit = candidatos.filter((c) => c.cuit === null)
    if (sinCuit.length === 1) return { cliente: sinCuit[0] }
    return {
      error: {
        codigo: 'CLIENTE_AMBIGUO',
        mensaje: `La razón social "${referencia}" corresponde a más de un cliente (filas ${filasTexto(candidatos.map((c) => c.fila))} de Clientes): usá el CUIT para distinguirlos.`,
      },
    }
  }
}

// -------------------------------------------------------------------------------------------
// Validación
// -------------------------------------------------------------------------------------------

export function validar(lectura: LecturaPlantilla): ResultadoValidacion {
  const incidencias: Incidencia[] = [...lectura.incidencias]
  const ctx = new Contexto(incidencias)

  const clientes = validarClientes(ctx, lectura)
  const resolverCliente = crearResolvedorDeClientes(clientes)

  const { contactos } = validarContactos(ctx, lectura, resolverCliente)
  const sedes = validarSedes(ctx, lectura, resolverCliente)
  agregarSedesAutomaticas(ctx, clientes, sedes)
  const servicios = validarServicios(ctx, lectura, resolverCliente, sedes)
  const personas = validarPersonal(ctx, lectura)
  const habilitaciones = validarHabilitaciones(
    ctx,
    lectura,
    resolverCliente,
    personas,
  )
  const feriados = validarFeriados(ctx, lectura)
  const criterios = validarCriterios(ctx, lectura)

  const plan: Plan = {
    clientes,
    contactos,
    sedes,
    personas,
    servicios,
    habilitaciones,
    feriados,
    criterios,
  }
  return { incidencias: ordenar(incidencias), plan }
}

const ORDEN_HOJAS: Record<string, number> = {
  Archivo: 0,
  Clientes: 1,
  Contactos: 2,
  Sedes: 3,
  Empleados: 4,
  Supervisores: 5,
  Servicios: 6,
  Habilitaciones: 7,
  Feriados: 8,
  Criterios: 9,
}

function ordenar(incidencias: Incidencia[]): Incidencia[] {
  return incidencias
    .map((inc, i) => ({ inc, i }))
    .sort(
      (a, b) =>
        ORDEN_HOJAS[a.inc.hoja] - ORDEN_HOJAS[b.inc.hoja] ||
        (a.inc.fila ?? 0) - (b.inc.fila ?? 0) ||
        a.i - b.i,
    )
    .map((x) => x.inc)
}

// ---- Clientes -------------------------------------------------------------------------------

function validarClientes(
  ctx: Contexto,
  lectura: LecturaPlantilla,
): PlanCliente[] {
  const h = ctx.hoja('Clientes')
  const clientes: PlanCliente[] = []
  for (const f of lectura.hojas.Clientes.filas) {
    const r = h.fila(f)
    const razonSocial = r.txt('razonSocial', true)
    const cuit = r.cuitOCuil('cuit', 'CUIT')
    const coords = r.coordenadas('latitud', 'longitud')
    const estado = r.lista(
      'estado',
      ETIQUETAS_CLIENTE,
      'active',
      'Activo, Suspendido, Baja',
    )
    if (razonSocial === null) continue
    clientes.push({
      id: clientes.length,
      fila: f.fila,
      cuit,
      razonSocial,
      nombreFantasia: r.txt('nombreFantasia'),
      direccion: r.txt('direccion'),
      latitud: coords.latitud,
      longitud: coords.longitud,
      estado,
      notas: r.txt('notas'),
    })
  }

  // CUIT repetido: la base lo rechaza (`unique`).
  for (const [cuit, grupo] of agrupar(clientes, (c) => c.cuit)) {
    if (grupo.length < 2) continue
    const filas = grupo.map((c) => c.fila)
    for (const c of grupo) {
      h.error(
        c.fila,
        'cuit',
        'CUIT_REPETIDO',
        `El CUIT ${cuit} está repetido (filas ${filasTexto(filas)}). Cada cliente tiene que tener un CUIT distinto.`,
      )
    }
  }

  // Misma razón social: sin CUIT que los distinga no se los puede vincular ni reintentar (error);
  // con CUIT en alguno de los dos es solo un aviso.
  for (const grupo of agrupar(clientes, (c) =>
    claveNorm(c.razonSocial),
  ).values()) {
    if (grupo.length < 2) continue
    const filas = grupo.map((c) => c.fila)
    const sinCuit = grupo.filter(
      (c) => c.cuit === null && !tieneCuitConError(c, lectura),
    )
    const cuitsDistintos = new Set(grupo.map((c) => c.cuit))
    for (const c of grupo) {
      if (sinCuit.length > 1 && sinCuit.includes(c)) {
        h.error(
          c.fila,
          'razonSocial',
          'CLIENTE_SIN_CUIT_REPETIDO',
          `Hay ${sinCuit.length} clientes sin CUIT con esta misma razón social (filas ${filasTexto(sinCuit.map((x) => x.fila))}). Sin CUIT no se los puede distinguir: cargales el CUIT o diferenciá la razón social.`,
        )
      } else if (
        cuitsDistintos.size > 1 ||
        grupo.some((x) => x.cuit === null)
      ) {
        h.aviso(
          c.fila,
          'razonSocial',
          'RAZON_SOCIAL_REPETIDA',
          `La razón social está repetida (filas ${filasTexto(filas)}). Si son clientes distintos, en las otras hojas vinculalos por CUIT.`,
        )
      }
    }
  }
  return clientes
}

/** Un cliente cuyo CUIT se escribió mal ya tiene su propio error: no se lo cuenta como "sin CUIT". */
function tieneCuitConError(c: PlanCliente, lectura: LecturaPlantilla): boolean {
  const f = lectura.hojas.Clientes.filas.find((x) => x.fila === c.fila)
  return f !== undefined && texto(f.celdas.cuit ?? null) !== null
}

// ---- Contactos ------------------------------------------------------------------------------

function validarContactos(
  ctx: Contexto,
  lectura: LecturaPlantilla,
  resolver: (ref: string) => ResultadoCliente,
): { contactos: PlanContacto[] } {
  const h = ctx.hoja('Contactos')
  const contactos: PlanContacto[] = []
  for (const f of lectura.hojas.Contactos.filas) {
    const r = h.fila(f)
    const referencia = r.txt('cliente', true)
    const nombre = r.txt('nombre', true)
    const principal = r.siNo('principal', false)
    const email = r.txt('email')
    if (email !== null && !emailValido(email)) {
      h.aviso(
        f.fila,
        'email',
        'EMAIL_CONTACTO',
        `El email "${email}" no parece válido (falta la arroba o el dominio). Se carga igual; revisalo.`,
      )
    }
    if (referencia === null || nombre === null) continue
    const cliente = resolver(referencia)
    if ('error' in cliente) {
      h.error(f.fila, 'cliente', cliente.error.codigo, cliente.error.mensaje)
      continue
    }
    contactos.push({
      fila: f.fila,
      clienteId: cliente.cliente.id,
      nombre,
      cargo: r.txt('cargo'),
      telefono: r.txt('telefono'),
      email,
      principal,
    })
  }

  // Un solo contacto principal por cliente: la base lo rechaza (índice único parcial).
  for (const grupo of agrupar(
    contactos.filter((c) => c.principal),
    (c) => String(c.clienteId),
  ).values()) {
    if (grupo.length < 2) continue
    for (const c of grupo) {
      h.error(
        c.fila,
        'principal',
        'CONTACTO_PRINCIPAL_REPETIDO',
        `Hay más de un contacto principal para este cliente (filas ${filasTexto(grupo.map((x) => x.fila))}). Dejá un solo "Sí".`,
      )
    }
  }
  // Mismo nombre en el mismo cliente: hace falta para poder reintentar la carga.
  for (const grupo of agrupar(
    contactos,
    (c) => `${c.clienteId}|${claveNorm(c.nombre)}`,
  ).values()) {
    if (grupo.length < 2) continue
    for (const c of grupo) {
      h.error(
        c.fila,
        'nombre',
        'CONTACTO_REPETIDO',
        `Hay dos contactos con el mismo nombre en este cliente (filas ${filasTexto(grupo.map((x) => x.fila))}). Agregá una aclaración al nombre para distinguirlos.`,
      )
    }
  }
  return { contactos }
}

// ---- Sedes ----------------------------------------------------------------------------------

function validarSedes(
  ctx: Contexto,
  lectura: LecturaPlantilla,
  resolver: (ref: string) => ResultadoCliente,
): PlanSede[] {
  const h = ctx.hoja('Sedes')
  const sedes: PlanSede[] = []
  for (const f of lectura.hojas.Sedes.filas) {
    const r = h.fila(f)
    const referencia = r.txt('cliente', true)
    const nombre = r.txt('nombre', true)
    const direccion = r.txt('direccion', true)
    const coords = r.coordenadas('latitud', 'longitud')
    const celular = r.siNo('celular', false)
    const fotos = r.siNo('fotos', false)
    const estado = r.lista(
      'estado',
      ETIQUETAS_SEDE,
      'active',
      'Activa, Inactiva',
    )
    if (referencia === null || nombre === null || direccion === null) continue
    const cliente = resolver(referencia)
    if ('error' in cliente) {
      h.error(f.fila, 'cliente', cliente.error.codigo, cliente.error.mensaje)
      continue
    }
    sedes.push({
      fila: f.fila,
      clienteId: cliente.cliente.id,
      nombre,
      direccion,
      localidad: r.txt('localidad'),
      latitud: coords.latitud,
      longitud: coords.longitud,
      contactoNombre: r.txt('contactoNombre'),
      contactoTelefono: r.txt('contactoTelefono'),
      accesoInstrucciones: r.txt('acceso'),
      horarioEdificio: r.txt('horario'),
      celularRestringido: celular,
      fotosProhibidas: fotos,
      otrasRestricciones: r.txt('otras'),
      estado,
      automatica: false,
    })
  }

  // Nombre único por cliente: la base lo rechaza (índice único).
  for (const grupo of agrupar(
    sedes,
    (s) => `${s.clienteId}|${claveNorm(s.nombre)}`,
  ).values()) {
    if (grupo.length < 2) continue
    for (const s of grupo) {
      h.error(
        s.fila,
        'nombre',
        'SEDE_REPETIDA',
        `Hay dos sedes con el mismo nombre en este cliente (filas ${filasTexto(grupo.map((x) => x.fila ?? 0))}). El nombre tiene que ser único dentro del cliente.`,
      )
    }
  }
  return sedes
}

/**
 * Decisión del 6 oct 2026: un cliente sin ninguna fila en la hoja Sedes y con dirección
 * administrativa recibe una sede `Principal` con esa dirección (activa, sin coordenadas). Sin
 * dirección no se crea sede y queda como advertencia.
 */
function agregarSedesAutomaticas(
  ctx: Contexto,
  clientes: PlanCliente[],
  sedes: PlanSede[],
): void {
  const h = ctx.hoja('Clientes')
  const conSedes = new Set(sedes.map((s) => s.clienteId))
  for (const c of clientes) {
    if (conSedes.has(c.id)) continue
    if (c.direccion !== null) {
      sedes.push({
        fila: null,
        clienteId: c.id,
        nombre: NOMBRE_SEDE_AUTOMATICA,
        direccion: c.direccion,
        localidad: null,
        latitud: null,
        longitud: null,
        contactoNombre: null,
        contactoTelefono: null,
        accesoInstrucciones: null,
        horarioEdificio: null,
        celularRestringido: false,
        fotosProhibidas: false,
        otrasRestricciones: null,
        estado: 'active',
        automatica: true,
      })
    } else {
      h.aviso(
        c.fila,
        'direccion',
        'CLIENTE_SIN_SEDE',
        'El cliente no tiene sedes en la hoja Sedes ni dirección administrativa: se carga sin ninguna sede (después se agrega desde la aplicación).',
      )
    }
  }
}

// ---- Servicios ------------------------------------------------------------------------------

function validarServicios(
  ctx: Contexto,
  lectura: LecturaPlantilla,
  resolver: (ref: string) => ResultadoCliente,
  sedes: PlanSede[],
): PlanServicio[] {
  const h = ctx.hoja('Servicios')
  const sedesPorClave = new Map(
    sedes.map((s) => [`${s.clienteId}|${claveNorm(s.nombre)}`, s] as const),
  )
  const servicios: PlanServicio[] = []
  for (const f of lectura.hojas.Servicios.filas) {
    const r = h.fila(f)
    const referencia = r.txt('cliente', true)
    const sedeNombre = r.txt('sede', true)
    const nombre = r.txt('nombre', true)
    const dias: number[] = []
    for (const d of DIAS_SERVICIO)
      if (r.siNo(d.campo, false)) dias.push(d.numero)
    const inicio = r.hora('inicio', true)
    const fin = r.hora('fin', true)
    const dotacion = r.entero('dotacion', 1, 10)
    const desde = r.fecha('desde', true)
    const hasta = r.fecha('hasta')
    const feriados = r.siNo('feriados', true)
    const horasMinimas = r.horasMensuales('horasMinimas')
    const horasMaximas = r.horasMensuales('horasMaximas')
    const estado = r.lista(
      'estado',
      ETIQUETAS_SERVICIO,
      'active',
      'Activo, Pausado, Finalizado',
    )

    if (dias.length === 0) {
      h.error(
        f.fila,
        'lunes',
        'SERVICIO_SIN_DIAS',
        'Marcá "Sí" en al menos un día de la semana (de Lunes a Domingo).',
      )
    }
    if (inicio !== null && fin !== null && fin <= inicio) {
      h.error(
        f.fila,
        'fin',
        'HORA_FIN_ANTERIOR',
        `La hora de fin (${fin}) tiene que ser posterior a la de inicio (${inicio}): el servicio no puede cruzar la medianoche. Si hace falta, cargá dos servicios.`,
      )
    }
    if (desde !== null && hasta !== null && hasta < desde) {
      h.aviso(
        f.fila,
        'hasta',
        'VIGENCIA_INVERTIDA',
        'La fecha "Vigente hasta" es anterior a "Vigente desde": el servicio nunca estaría vigente.',
      )
    }
    if (
      horasMinimas !== null &&
      horasMaximas !== null &&
      horasMinimas > horasMaximas
    ) {
      h.aviso(
        f.fila,
        'horasMinimas',
        'HORAS_INVERTIDAS',
        'Las horas mínimas son mayores que las máximas.',
      )
    }

    if (referencia === null || sedeNombre === null || nombre === null) continue
    const cliente = resolver(referencia)
    if ('error' in cliente) {
      h.error(f.fila, 'cliente', cliente.error.codigo, cliente.error.mensaje)
      continue
    }
    const sede = sedesPorClave.get(
      `${cliente.cliente.id}|${claveNorm(sedeNombre)}`,
    )
    if (!sede) {
      h.error(
        f.fila,
        'sede',
        'SEDE_NO_ENCONTRADA',
        `La sede "${sedeNombre}" no figura en la hoja Sedes para este cliente. Tiene que estar escrita igual que allá.`,
      )
      continue
    }
    if (inicio === null || fin === null || desde === null) continue
    servicios.push({
      fila: f.fila,
      clienteId: cliente.cliente.id,
      sedeNombre: sede.nombre,
      nombre,
      dias,
      inicio,
      fin,
      dotacion: dotacion ?? 1,
      desde,
      hasta,
      seTrabajaFeriados: feriados,
      horasMinimas,
      horasMaximas,
      estado,
      notas: r.txt('notas'),
    })
  }

  // Mismo nombre en la misma sede: hace falta para poder reintentar la carga.
  for (const grupo of agrupar(
    servicios,
    (s) => `${s.clienteId}|${claveNorm(s.sedeNombre)}|${claveNorm(s.nombre)}`,
  ).values()) {
    if (grupo.length < 2) continue
    for (const s of grupo) {
      h.error(
        s.fila,
        'nombre',
        'SERVICIO_REPETIDO',
        `Hay dos servicios con el mismo nombre en esta sede (filas ${filasTexto(grupo.map((x) => x.fila))}). Cambiale el nombre a uno para distinguirlos.`,
      )
    }
  }
  return servicios
}

// ---- Empleados y supervisores ---------------------------------------------------------------

interface PersonaLeida {
  hoja: 'Empleados' | 'Supervisores'
  fila: number
  rol: RolPersona
  dni: string
  nombre: string
  apellido: string
  /** `null` si falta o es inválido (ya tiene su error): igual cuenta para detectar DNI repetidos. */
  email: string | null
  cuil: string | null
  telefono: string | null
  domicilio: string | null
  nacimiento: string | null
  ingreso: string | null
  emergenciaNombre: string | null
  emergenciaTelefono: string | null
  emergenciaVinculo: string | null
  legajo: number | null
  estado: EstadoPersona
  notas: string | null
}

function leerPersonas(
  ctx: Contexto,
  lectura: LecturaPlantilla,
  hoja: 'Empleados' | 'Supervisores',
  rol: RolPersona,
): PersonaLeida[] {
  const h = ctx.hoja(hoja)
  const leidas: PersonaLeida[] = []
  for (const f of lectura.hojas[hoja].filas) {
    // Decisión del 6 oct 2026: quien está de Baja no se carga. Se mira antes de validar nada más:
    // una fila ignorada no puede tener errores (le falte el email o lo que sea).
    if (claveNorm(texto(f.celdas.estado ?? null) ?? '') === 'baja') {
      h.ignorada(
        f.fila,
        'estado',
        'PERSONA_DE_BAJA',
        'La persona está de Baja: no se carga (no se crea su usuario). Si tiene que volver a trabajar, cambiale el estado a Activo.',
      )
      const dniBaja = soloDigitos(texto(f.celdas.dni ?? null) ?? '')
      if (esSoloDigitos(dniBaja)) ctx.dnisDeBaja.add(dniBaja)
      continue
    }
    const r = h.fila(f)
    const dniCrudo = r.txt('dni', true)
    const nombre = r.txt('nombre', true)
    const apellido = r.txt('apellido', true)
    const emailCrudo = r.txt('email')
    const cuil = r.cuitOCuil('cuil', 'CUIL')
    const nacimiento = r.fecha('nacimiento')
    const ingreso = r.fecha('ingreso')
    const legajo = r.entero('legajo', 1, 999_999)
    const estado = r.lista(
      'estado',
      ETIQUETAS_PERSONA,
      'active',
      'Activo, Baja',
    )

    // Email obligatorio (decisión del 6 oct 2026): es el usuario con el que entra a la aplicación.
    let email: string | null = null
    if (emailCrudo === null) {
      h.error(
        f.fila,
        'email',
        'EMAIL_FALTA',
        'Falta el email: cada persona necesita uno propio para entrar a la aplicación.',
      )
    } else if (!emailValido(emailCrudo)) {
      h.error(
        f.fila,
        'email',
        'EMAIL_INVALIDO',
        `El email "${emailCrudo}" no es válido (tiene que ser del estilo nombre@dominio.com, sin espacios).`,
      )
    } else {
      email = emailCrudo.toLowerCase()
    }

    let dni: string | null = null
    if (dniCrudo !== null) {
      const limpio = soloDigitos(dniCrudo)
      if (!esSoloDigitos(limpio)) {
        h.error(
          f.fila,
          'dni',
          'DNI_FORMATO',
          `El DNI "${dniCrudo}" tiene que tener solo números, sin letras.`,
        )
      } else {
        dni = limpio
        if (limpio !== dniCrudo) {
          h.aviso(
            f.fila,
            'dni',
            'DNI_LIMPIADO',
            `Se quitaron puntos, guiones o espacios del DNI (se carga ${limpio}).`,
          )
        }
        if (limpio.length < 6 || limpio.length > 9) {
          h.aviso(
            f.fila,
            'dni',
            'DNI_LARGO',
            `El DNI ${limpio} tiene ${limpio.length} dígitos (lo habitual es entre 6 y 9): puede haber un error de tipeo. Se carga igual; revisalo.`,
          )
        }
      }
    }

    if (dni === null || nombre === null || apellido === null) {
      continue
    }
    leidas.push({
      hoja,
      fila: f.fila,
      rol,
      dni,
      nombre,
      apellido,
      email,
      cuil,
      telefono: r.txt('telefono'),
      domicilio: r.txt('domicilio'),
      nacimiento,
      ingreso,
      emergenciaNombre: r.txt('emergenciaNombre'),
      emergenciaTelefono: r.txt('emergenciaTelefono'),
      emergenciaVinculo: r.txt('emergenciaVinculo'),
      legajo,
      estado,
      notas: r.txt('notas'),
    })
  }

  // DNI repetido dentro de la misma hoja: la base lo rechaza (`unique`).
  const repetidos = new Set<PersonaLeida>()
  for (const [dni, grupo] of agrupar(leidas, (p) => p.dni)) {
    if (grupo.length < 2) continue
    for (const p of grupo) {
      repetidos.add(p)
      h.error(
        p.fila,
        'dni',
        'DNI_REPETIDO',
        `El DNI ${dni} está repetido en esta hoja (filas ${filasTexto(grupo.map((x) => x.fila))}). Cada persona tiene que tener un DNI distinto.`,
      )
    }
  }
  return leidas.filter((p) => !repetidos.has(p))
}

function validarPersonal(
  ctx: Contexto,
  lectura: LecturaPlantilla,
): PlanPersona[] {
  // Las filas sin email ya tienen su error: no pasan al plan (pero sí contaron para el DNI repetido).
  const conEmail = (filas: PersonaLeida[]) =>
    filas.filter((p): p is PersonaLeida & { email: string } => p.email !== null)
  const empleados = conEmail(
    leerPersonas(ctx, lectura, 'Empleados', 'employee'),
  )
  const supervisores = conEmail(
    leerPersonas(ctx, lectura, 'Supervisores', 'supervisor'),
  )

  // Una persona en las dos hojas (mismo DNI) es una sola cuenta con los dos roles.
  const porDni = new Map<string, PlanPersona>()
  for (const p of [...empleados, ...supervisores]) {
    const existente = porDni.get(p.dni)
    if (!existente) {
      porDni.set(p.dni, {
        filas: { [p.hoja]: p.fila },
        dni: p.dni,
        nombre: p.nombre,
        apellido: p.apellido,
        email: p.email,
        cuil: p.cuil,
        telefono: p.telefono,
        domicilio: p.domicilio,
        nacimiento: p.nacimiento,
        ingreso: p.ingreso,
        emergenciaNombre: p.emergenciaNombre,
        emergenciaTelefono: p.emergenciaTelefono,
        emergenciaVinculo: p.emergenciaVinculo,
        legajo: p.legajo,
        estado: p.estado,
        notas: p.notas,
        roles: [p.rol],
      })
      continue
    }
    const h = ctx.hoja(p.hoja)
    const otraHoja =
      existente.filas.Empleados === undefined ? 'Supervisores' : 'Empleados'
    const filaOtra = existente.filas[otraHoja]
    existente.filas[p.hoja] = p.fila
    existente.roles.push(p.rol)
    if (p.email !== existente.email) {
      h.error(
        p.fila,
        'email',
        'EMAIL_DISTINTO_ENTRE_HOJAS',
        `El DNI ${p.dni} también está en la hoja ${otraHoja} (fila ${filaOtra}) con otro email. Una persona tiene un solo email: dejalo igual en las dos hojas.`,
      )
    }
    if (
      claveNorm(p.nombre) !== claveNorm(existente.nombre) ||
      claveNorm(p.apellido) !== claveNorm(existente.apellido)
    ) {
      h.aviso(
        p.fila,
        'nombre',
        'NOMBRE_DISTINTO_ENTRE_HOJAS',
        `El DNI ${p.dni} figura con otro nombre en la hoja ${otraHoja} (fila ${filaOtra}): se usa el de esa hoja.`,
      )
    }
    // Lo que falta en una hoja se completa con lo de la otra.
    existente.cuil ??= p.cuil
    existente.telefono ??= p.telefono
    existente.domicilio ??= p.domicilio
    existente.nacimiento ??= p.nacimiento
    existente.ingreso ??= p.ingreso
    existente.emergenciaNombre ??= p.emergenciaNombre
    existente.emergenciaTelefono ??= p.emergenciaTelefono
    existente.emergenciaVinculo ??= p.emergenciaVinculo
    existente.legajo ??= p.legajo
    existente.notas ??= p.notas
  }
  const personas = [...porDni.values()]

  // Email repetido entre personas distintas: Auth no lo admite.
  for (const [email, grupo] of agrupar(personas, (p) => p.email)) {
    if (grupo.length < 2) continue
    for (const p of grupo) {
      for (const hoja of ['Empleados', 'Supervisores'] as const) {
        const fila = p.filas[hoja]
        if (fila === undefined) continue
        ctx
          .hoja(hoja)
          .error(
            fila,
            'email',
            'EMAIL_REPETIDO',
            `El email ${email} lo usan varias personas con distinto DNI (${grupo.map((x) => x.dni).join(', ')}). Cada persona necesita un email propio.`,
          )
      }
    }
  }
  // Legajo repetido: la base lo rechaza (`unique`).
  for (const [legajo, grupo] of agrupar(personas, (p) =>
    p.legajo === null ? null : String(p.legajo),
  )) {
    if (grupo.length < 2) continue
    for (const p of grupo) {
      for (const hoja of ['Empleados', 'Supervisores'] as const) {
        const fila = p.filas[hoja]
        if (fila === undefined) continue
        ctx
          .hoja(hoja)
          .error(
            fila,
            'legajo',
            'LEGAJO_REPETIDO',
            `El legajo ${legajo} está asignado a más de una persona. Cada legajo es único.`,
          )
      }
    }
  }
  return personas
}

// ---- Habilitaciones -------------------------------------------------------------------------

function validarHabilitaciones(
  ctx: Contexto,
  lectura: LecturaPlantilla,
  resolver: (ref: string) => ResultadoCliente,
  personas: PlanPersona[],
): PlanHabilitacion[] {
  const h = ctx.hoja('Habilitaciones')
  const dnis = new Set(personas.map((p) => p.dni))
  const vistas = new Map<string, number>()
  const habilitaciones: PlanHabilitacion[] = []
  for (const f of lectura.hojas.Habilitaciones.filas) {
    const r = h.fila(f)
    const dniCrudo = r.txt('dni', true)
    const referencia = r.txt('cliente', true)
    if (dniCrudo === null || referencia === null) continue
    const dni = soloDigitos(dniCrudo)
    if (!dnis.has(dni) && ctx.dnisDeBaja.has(dni)) {
      h.ignorada(
        f.fila,
        'dni',
        'HABILITACION_DE_PERSONA_DE_BAJA',
        `El DNI ${dni} es de una persona de Baja, que no se carga: se ignora esta habilitación.`,
      )
      continue
    }
    if (!dnis.has(dni)) {
      h.error(
        f.fila,
        'dni',
        'DNI_NO_ENCONTRADO',
        `El DNI ${dniCrudo} no figura en las hojas Empleados ni Supervisores (o esa fila tiene errores).`,
      )
      continue
    }
    const cliente = resolver(referencia)
    if ('error' in cliente) {
      h.error(f.fila, 'cliente', cliente.error.codigo, cliente.error.mensaje)
      continue
    }
    const clave = `${dni}|${cliente.cliente.id}`
    const previa = vistas.get(clave)
    if (previa !== undefined) {
      h.aviso(
        f.fila,
        null,
        'HABILITACION_REPETIDA',
        `Esta habilitación ya estaba en la fila ${previa}: se carga una sola vez.`,
      )
      continue
    }
    vistas.set(clave, f.fila)
    habilitaciones.push({ fila: f.fila, dni, clienteId: cliente.cliente.id })
  }
  return habilitaciones
}

// ---- Feriados -------------------------------------------------------------------------------

function validarFeriados(
  ctx: Contexto,
  lectura: LecturaPlantilla,
): PlanFeriado[] {
  const h = ctx.hoja('Feriados')
  const feriados: PlanFeriado[] = []
  for (const f of lectura.hojas.Feriados.filas) {
    const r = h.fila(f)
    const fecha = r.fecha('fecha', true)
    const nombre = r.txt('nombre', true)
    if (fecha === null || nombre === null) continue
    feriados.push({ fila: f.fila, fecha, nombre })
  }
  // Una fecha por feriado: la base lo rechaza (`unique`).
  for (const [fecha, grupo] of agrupar(feriados, (x) => x.fecha)) {
    if (grupo.length < 2) continue
    for (const x of grupo) {
      h.error(
        x.fila,
        'fecha',
        'FERIADO_REPETIDO',
        `La fecha ${fecha} está repetida (filas ${filasTexto(grupo.map((y) => y.fila))}). No puede haber dos feriados el mismo día.`,
      )
    }
  }
  return feriados
}

// ---- Criterios ------------------------------------------------------------------------------

function validarCriterios(
  ctx: Contexto,
  lectura: LecturaPlantilla,
): PlanCriterio[] {
  const h = ctx.hoja('Criterios')
  const criterios: PlanCriterio[] = []
  for (const f of lectura.hojas.Criterios.filas) {
    const r = h.fila(f)
    const orden = r.entero('orden', 1, 99, true)
    const titulo = r.txt('titulo', true)
    const desde = r.fecha('desde')
    const hasta = r.fecha('hasta')
    if (desde !== null && hasta !== null && hasta < desde) {
      h.aviso(
        f.fila,
        'hasta',
        'VIGENCIA_INVERTIDA',
        'La fecha "Vigente hasta" es anterior a "Vigente desde": el criterio nunca estaría vigente.',
      )
    }
    if (orden === null || titulo === null) continue
    criterios.push({
      fila: f.fila,
      orden,
      titulo,
      descripcion: r.txt('descripcion'),
      desde,
      hasta,
    })
  }
  // Mismo título: hace falta para poder reintentar la carga.
  for (const grupo of agrupar(criterios, (c) => claveNorm(c.titulo)).values()) {
    if (grupo.length < 2) continue
    for (const c of grupo) {
      h.error(
        c.fila,
        'titulo',
        'CRITERIO_REPETIDO',
        `Hay dos criterios con el mismo título (filas ${filasTexto(grupo.map((x) => x.fila))}). Cambiale el título a uno para distinguirlos.`,
      )
    }
  }
  for (const grupo of agrupar(criterios, (c) => String(c.orden)).values()) {
    if (grupo.length < 2) continue
    for (const c of grupo) {
      h.aviso(
        c.fila,
        'orden',
        'ORDEN_REPETIDO',
        `El orden ${c.orden} está repetido (filas ${filasTexto(grupo.map((x) => x.fila))}): se van a mostrar juntos, sin un orden definido entre ellos.`,
      )
    }
  }
  return criterios
}
