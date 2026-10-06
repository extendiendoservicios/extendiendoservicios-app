// scripts/import-initial/tipos.ts — DATA-003
//
// Tipos compartidos por el importador de la carga inicial: lo que se lee de la planilla, las
// incidencias del informe (errores, advertencias, filas ignoradas) y el plan ya validado y
// normalizado que después escribe `cargar.ts`.

export const NOMBRES_HOJAS = [
  'Clientes',
  'Contactos',
  'Sedes',
  'Empleados',
  'Supervisores',
  'Servicios',
  'Habilitaciones',
  'Feriados',
  'Criterios',
] as const

export type NombreHoja = (typeof NOMBRES_HOJAS)[number]

/** Valor crudo de una celda, ya sin envoltorios de Excel (texto enriquecido, fórmulas, etc.). */
export type Celda = string | number | boolean | Date | null

export type Nivel = 'error' | 'advertencia' | 'ignorada'

export interface Incidencia {
  nivel: Nivel
  hoja: NombreHoja | 'Archivo'
  /** Número de fila tal como se ve en Excel (1 = primera fila). `null` si es de toda la hoja. */
  fila: number | null
  /** Título de la columna tal como lo ve la empresa, sin el asterisco. `null` si es de la fila. */
  columna: string | null
  /** Código estable, para agrupar en el informe y para los tests. */
  codigo: string
  mensaje: string
}

export interface FilaLeida {
  fila: number
  /** Valores por clave de campo (ver `esquema.ts`). */
  celdas: Record<string, Celda>
}

export interface HojaLeida {
  nombre: NombreHoja
  encontrada: boolean
  filas: FilaLeida[]
}

export interface LecturaPlantilla {
  hojas: Record<NombreHoja, HojaLeida>
  incidencias: Incidencia[]
}

// -------------------------------------------------------------------------------------------
// Plan validado (lo que se escribe en la base)
// -------------------------------------------------------------------------------------------

export type EstadoCliente = 'active' | 'suspended' | 'closed'
export type EstadoSede = 'active' | 'inactive'
export type EstadoPersona = 'active' | 'terminated'
export type EstadoServicio = 'active' | 'paused' | 'ended'
export type RolPersona = 'employee' | 'supervisor'

export interface PlanCliente {
  /** Identificador local (índice), para vincular las otras hojas. */
  id: number
  fila: number
  cuit: string | null
  razonSocial: string
  nombreFantasia: string | null
  direccion: string | null
  latitud: number | null
  longitud: number | null
  estado: EstadoCliente
  notas: string | null
}

export interface PlanContacto {
  fila: number
  clienteId: number
  nombre: string
  cargo: string | null
  telefono: string | null
  email: string | null
  principal: boolean
}

export interface PlanSede {
  /** `null` si es la sede `Principal` que crea el importador. */
  fila: number | null
  clienteId: number
  nombre: string
  direccion: string
  localidad: string | null
  latitud: number | null
  longitud: number | null
  contactoNombre: string | null
  contactoTelefono: string | null
  accesoInstrucciones: string | null
  horarioEdificio: string | null
  celularRestringido: boolean
  fotosProhibidas: boolean
  otrasRestricciones: string | null
  estado: EstadoSede
  automatica: boolean
}

export interface PlanPersona {
  /** Filas de origen por hoja (puede estar en las dos). */
  filas: { Empleados?: number; Supervisores?: number }
  dni: string
  nombre: string
  apellido: string
  email: string
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
  roles: RolPersona[]
}

export interface PlanServicio {
  fila: number
  clienteId: number
  sedeNombre: string
  nombre: string
  /** 0 = domingo .. 6 = sábado (igual que `services.weekdays`). */
  dias: number[]
  inicio: string
  fin: string
  dotacion: number
  desde: string
  hasta: string | null
  seTrabajaFeriados: boolean
  horasMinimas: number | null
  horasMaximas: number | null
  estado: EstadoServicio
  notas: string | null
}

export interface PlanHabilitacion {
  fila: number
  dni: string
  clienteId: number
}

export interface PlanFeriado {
  fila: number
  fecha: string
  nombre: string
}

export interface PlanCriterio {
  fila: number
  orden: number
  titulo: string
  descripcion: string | null
  desde: string | null
  hasta: string | null
}

export interface Plan {
  clientes: PlanCliente[]
  contactos: PlanContacto[]
  sedes: PlanSede[]
  personas: PlanPersona[]
  servicios: PlanServicio[]
  habilitaciones: PlanHabilitacion[]
  feriados: PlanFeriado[]
  criterios: PlanCriterio[]
}

export interface ResultadoValidacion {
  incidencias: Incidencia[]
  plan: Plan
}
