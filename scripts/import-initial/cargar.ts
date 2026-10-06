// scripts/import-initial/cargar.ts — DATA-003, DATA-004
//
// Escribe en la base el plan ya validado. Orden: clientes, contactos, sedes, empleados y
// supervisores con su usuario, habilitaciones, servicios, feriados y criterios (la planilla no
// trae disponibilidad: cada persona la declara desde la aplicación).
//
// Cada paso identifica lo que ya existe por su clave natural, sin depender de ids:
//   clientes -> CUIT (o razón social si no tiene CUIT) · contactos -> cliente + nombre ·
//   sedes -> cliente + nombre · personas -> DNI · habilitaciones -> persona + cliente ·
//   servicios -> cliente + sede + nombre · feriados -> fecha · criterios -> título.
// Sin `--resume`, si algo del archivo ya está en la base se corta ANTES de escribir (para no
// duplicar ni pisar por accidente). Con `--resume` se omite lo existente y se carga lo que falta.
//
// Usuarios: misma lógica que la acción `create_user` de la Edge Function `admin-users`
// (06_API.md sección 2.1): se crea la cuenta de Auth con `email_confirm: true` y nombre y
// apellido en `user_metadata` (el trigger `app.handle_new_user()` crea `profiles`), después la
// fila de `employees`, los roles en `user_roles` y el evento `user_created` en `security_events`.
// Diferencia buscada: acá no hay persona que actúa (`created_by`/`granted_by`/`actor_id` quedan
// nulos) y la cuenta se crea SIN contraseña: las contraseñas iniciales las asigna un paso aparte
// (DATA-008, `pnpm credenciales:inicial`), que toma la lista de emails de las cuentas creadas.
//
// Falla de una fila: se anota y se sigue con las demás filas de ese paso; lo que depende de una
// fila fallida se anota como falla también. No se deshace nada (las cuentas de Auth no se pueden
// borrar con confianza, P-014/P-105): se corrige la causa y se reintenta con `--resume`.

import type { SupabaseClient } from '@supabase/supabase-js'
import { claveNorm } from './normalizar.ts'
import type { RastroCarga } from './informe.ts'
import type { Plan, PlanPersona } from './tipos.ts'

export interface OpcionesCarga {
  resume: boolean
  /**
   * Punto de extensión de DATA-008: devuelve la contraseña inicial de una persona, o `undefined`
   * para crear la cuenta sin contraseña (lo que hace hoy el importador).
   */
  contrasenaInicial?: (persona: PlanPersona) => Promise<string | undefined>
  /** Avisos de avance (sin datos personales). */
  avance?: (mensaje: string) => void
}

export class ErrorDeCarga extends Error {}

/** El `id` de una fila devuelta por la base (el cliente sin tipos devuelve `any`). */
function idDe(fila: unknown): string {
  return (fila as { id: string }).id
}

type Id = string

interface PasoRastro {
  entidad: string
  creados: number
  omitidos: number
  fallidos: Array<{ fila: number | null; mensaje: string }>
}

// -------------------------------------------------------------------------------------------
// Lectura de lo que ya hay en la base
// -------------------------------------------------------------------------------------------

const TAMANO_PAGINA = 1000

async function leerTodo<T>(
  admin: SupabaseClient,
  tabla: string,
  columnas: string,
  orden: string,
): Promise<T[]> {
  const filas: T[] = []
  for (let desde = 0; ; desde += TAMANO_PAGINA) {
    const { data, error } = await admin
      .from(tabla)
      .select(columnas)
      .order(orden, { ascending: true })
      .range(desde, desde + TAMANO_PAGINA - 1)
    if (error)
      throw new ErrorDeCarga(`No se pudo leer ${tabla}: ${error.message}`)
    const pagina = (data ?? []) as unknown as T[]
    filas.push(...pagina)
    if (pagina.length < TAMANO_PAGINA) return filas
  }
}

/** Todas las cuentas de Auth, por email en minúsculas. */
async function leerCuentasDeAuth(
  admin: SupabaseClient,
): Promise<Map<string, Id>> {
  const porEmail = new Map<string, Id>()
  for (let pagina = 1; ; pagina++) {
    const { data, error } = await admin.auth.admin.listUsers({
      page: pagina,
      perPage: 1000,
    })
    if (error)
      throw new ErrorDeCarga(
        `No se pudieron listar las cuentas: ${error.message}`,
      )
    for (const u of data.users)
      if (u.email) porEmail.set(u.email.toLowerCase(), u.id)
    if (data.users.length < 1000) return porEmail
  }
}

interface FilaCliente {
  id: Id
  cuit: string | null
  legal_name: string
  deleted_at: string | null
}
interface FilaSede {
  id: Id
  client_id: Id
  name: string
  deleted_at: string | null
}
interface FilaContacto {
  client_id: Id
  name: string
  deleted_at: string | null
}
interface FilaEmpleado {
  profile_id: Id
  dni: string
}
interface FilaRol {
  profile_id: Id
  role: string
}
interface FilaServicio {
  client_id: Id
  site_id: Id
  name: string
  deleted_at: string | null
}
interface FilaHabilitacion {
  employee_id: Id
  client_id: Id
}
interface FilaFeriado {
  holiday_date: string
}
interface FilaCriterio {
  title: string
}

export interface Existentes {
  clientes: FilaCliente[]
  sedes: FilaSede[]
  contactos: FilaContacto[]
  empleados: FilaEmpleado[]
  roles: FilaRol[]
  cuentas: Map<string, Id>
  servicios: FilaServicio[]
  habilitaciones: FilaHabilitacion[]
  feriados: FilaFeriado[]
  criterios: FilaCriterio[]
}

export async function leerExistentes(
  admin: SupabaseClient,
): Promise<Existentes> {
  return {
    clientes: await leerTodo<FilaCliente>(
      admin,
      'clients',
      'id, cuit, legal_name, deleted_at',
      'id',
    ),
    sedes: await leerTodo<FilaSede>(
      admin,
      'sites',
      'id, client_id, name, deleted_at',
      'id',
    ),
    contactos: await leerTodo<FilaContacto>(
      admin,
      'client_contacts',
      'id, client_id, name, deleted_at',
      'id',
    ),
    empleados: await leerTodo<FilaEmpleado>(
      admin,
      'employees',
      'profile_id, dni',
      'profile_id',
    ),
    roles: await leerTodo<FilaRol>(
      admin,
      'user_roles',
      'profile_id, role',
      'profile_id',
    ),
    cuentas: await leerCuentasDeAuth(admin),
    servicios: await leerTodo<FilaServicio>(
      admin,
      'services',
      'id, client_id, site_id, name, deleted_at',
      'id',
    ),
    habilitaciones: await leerTodo<FilaHabilitacion>(
      admin,
      'employee_client_permissions',
      'employee_id, client_id',
      'employee_id',
    ),
    feriados: await leerTodo<FilaFeriado>(
      admin,
      'holidays',
      'id, holiday_date',
      'id',
    ),
    criterios: await leerTodo<FilaCriterio>(
      admin,
      'rating_criteria',
      'id, title',
      'id',
    ),
  }
}

// -------------------------------------------------------------------------------------------
// Índices de lo existente (claves naturales)
// -------------------------------------------------------------------------------------------

interface Indices {
  clientePorCuit: Map<string, FilaCliente>
  clienteSinCuitPorNombre: Map<string, FilaCliente>
  sedePorClave: Map<string, FilaSede>
  sedesPorCliente: Map<Id, number>
  contactoPorClave: Set<string>
  empleadoPorDni: Map<string, Id>
  rolesPorPersona: Map<Id, Set<string>>
  servicioPorClave: Set<string>
  habilitacionPorClave: Set<string>
  feriadoPorFecha: Set<string>
  criterioPorTitulo: Set<string>
}

function indexar(e: Existentes): Indices {
  const rolesPorPersona = new Map<Id, Set<string>>()
  for (const r of e.roles) {
    const s = rolesPorPersona.get(r.profile_id) ?? new Set<string>()
    s.add(r.role)
    rolesPorPersona.set(r.profile_id, s)
  }
  const sedesPorCliente = new Map<Id, number>()
  for (const s of e.sedes) {
    sedesPorCliente.set(
      s.client_id,
      (sedesPorCliente.get(s.client_id) ?? 0) + 1,
    )
  }
  return {
    clientePorCuit: new Map(
      e.clientes
        .filter((c) => c.cuit !== null)
        .map((c) => [c.cuit as string, c]),
    ),
    clienteSinCuitPorNombre: new Map(
      e.clientes
        .filter((c) => c.cuit === null && c.deleted_at === null)
        .map((c) => [claveNorm(c.legal_name), c]),
    ),
    sedePorClave: new Map(
      e.sedes
        .filter((s) => s.deleted_at === null)
        .map((s) => [`${s.client_id}|${claveNorm(s.name)}`, s]),
    ),
    sedesPorCliente,
    contactoPorClave: new Set(
      e.contactos
        .filter((c) => c.deleted_at === null)
        .map((c) => `${c.client_id}|${claveNorm(c.name)}`),
    ),
    empleadoPorDni: new Map(e.empleados.map((x) => [x.dni, x.profile_id])),
    rolesPorPersona,
    servicioPorClave: new Set(
      e.servicios
        .filter((s) => s.deleted_at === null)
        .map((s) => `${s.site_id}|${claveNorm(s.name)}`),
    ),
    habilitacionPorClave: new Set(
      e.habilitaciones.map((h) => `${h.employee_id}|${h.client_id}`),
    ),
    feriadoPorFecha: new Set(e.feriados.map((f) => f.holiday_date)),
    criterioPorTitulo: new Set(e.criterios.map((c) => claveNorm(c.title))),
  }
}

/** Cuántos datos del plan ya están en la base (para cortar antes de escribir si no es un reintento). */
export function contarYaCargados(
  plan: Plan,
  e: Existentes,
): {
  total: number
  detalle: Array<{ entidad: string; cantidad: number }>
} {
  const ix = indexar(e)
  const clienteExistente = (c: { cuit: string | null; razonSocial: string }) =>
    c.cuit !== null
      ? ix.clientePorCuit.get(c.cuit)
      : ix.clienteSinCuitPorNombre.get(claveNorm(c.razonSocial))
  const detalle = [
    {
      entidad: 'Clientes',
      cantidad: plan.clientes.filter((c) => clienteExistente(c)).length,
    },
    {
      entidad: 'Personas (por DNI)',
      cantidad: plan.personas.filter((p) => ix.empleadoPorDni.has(p.dni))
        .length,
    },
    {
      entidad: 'Cuentas de acceso (por email)',
      cantidad: plan.personas.filter(
        (p) => e.cuentas.has(p.email) && !ix.empleadoPorDni.has(p.dni),
      ).length,
    },
    {
      entidad: 'Feriados (por fecha)',
      cantidad: plan.feriados.filter((f) => ix.feriadoPorFecha.has(f.fecha))
        .length,
    },
    {
      entidad: 'Criterios (por título)',
      cantidad: plan.criterios.filter((c) =>
        ix.criterioPorTitulo.has(claveNorm(c.titulo)),
      ).length,
    },
  ]
  return { total: detalle.reduce((a, d) => a + d.cantidad, 0), detalle }
}

// -------------------------------------------------------------------------------------------
// Escritura
// -------------------------------------------------------------------------------------------

/** Mensaje en español para un error de Postgres/PostgREST (sin volcar el texto crudo). */
function traducirError(error: { code?: string; message: string }): string {
  switch (error.code) {
    case '23505':
      return 'Ya existe un registro con un dato que tiene que ser único.'
    case '23503':
      return 'Se refiere a algo que no existe en la base.'
    case '23514':
      return 'La base rechazó un dato por no cumplir una regla (restricción de formato o rango).'
    case '23502':
      return 'Falta un dato obligatorio para la base.'
    case '22P02':
    case '22007':
    case '22008':
      return 'La base no pudo interpretar un dato (formato inválido).'
    default:
      return `La base rechazó la fila (${error.code ?? 'sin código'}): ${error.message}`
  }
}

export async function cargar(
  admin: SupabaseClient,
  plan: Plan,
  existentes: Existentes,
  opciones: OpcionesCarga,
): Promise<RastroCarga> {
  const avance = opciones.avance ?? (() => undefined)
  const ix = indexar(existentes)
  const pasos: PasoRastro[] = []
  let cuentasSinContrasena = 0
  const emailsSinContrasena: string[] = []
  let interrumpidaEn: string | null = null
  let pasoActual = 'inicio'

  const nuevoPaso = (entidad: string): PasoRastro => {
    const paso: PasoRastro = { entidad, creados: 0, omitidos: 0, fallidos: [] }
    pasos.push(paso)
    pasoActual = entidad
    avance(`Cargando ${entidad}...`)
    return paso
  }
  const fallo = (paso: PasoRastro, fila: number | null, mensaje: string) =>
    paso.fallidos.push({ fila, mensaje })

  const clienteUuid = new Map<number, Id>()
  const sedeUuid = new Map<string, Id>() // `${clienteLocal}|${nombre normalizado}`
  const personaUuid = new Map<string, Id>() // por DNI
  let sedesAutomaticas = 0

  try {
    // ---- Clientes ----
    {
      const paso = nuevoPaso('Clientes')
      for (const c of plan.clientes) {
        const previo =
          c.cuit !== null
            ? ix.clientePorCuit.get(c.cuit)
            : ix.clienteSinCuitPorNombre.get(claveNorm(c.razonSocial))
        if (previo) {
          if (previo.deleted_at !== null) {
            fallo(
              paso,
              c.fila,
              'Ya existe un cliente dado de baja con ese CUIT; reactivalo desde la aplicación.',
            )
            continue
          }
          clienteUuid.set(c.id, previo.id)
          paso.omitidos++
          continue
        }
        const { data, error } = await admin
          .from('clients')
          .insert({
            legal_name: c.razonSocial,
            trade_name: c.nombreFantasia,
            cuit: c.cuit,
            admin_address: c.direccion,
            latitude: c.latitud,
            longitude: c.longitud,
            status: c.estado,
            notes: c.notas,
          })
          .select('id')
          .single()
        if (error) {
          fallo(paso, c.fila, traducirError(error))
          continue
        }
        clienteUuid.set(c.id, idDe(data))
        paso.creados++
      }
    }

    // ---- Contactos ----
    {
      const paso = nuevoPaso('Contactos')
      for (const c of plan.contactos) {
        const cliente = clienteUuid.get(c.clienteId)
        if (!cliente) {
          fallo(paso, c.fila, 'No se pudo cargar el cliente de este contacto.')
          continue
        }
        if (ix.contactoPorClave.has(`${cliente}|${claveNorm(c.nombre)}`)) {
          paso.omitidos++
          continue
        }
        const { error } = await admin.from('client_contacts').insert({
          client_id: cliente,
          name: c.nombre,
          role_title: c.cargo,
          phone: c.telefono,
          email: c.email,
          is_primary: c.principal,
        })
        if (error) fallo(paso, c.fila, traducirError(error))
        else paso.creados++
      }
    }

    // ---- Sedes (incluye las "Principal" automáticas) ----
    {
      const paso = nuevoPaso('Sedes')
      for (const s of plan.sedes) {
        const cliente = clienteUuid.get(s.clienteId)
        const clave = `${s.clienteId}|${claveNorm(s.nombre)}`
        if (!cliente) {
          fallo(paso, s.fila, 'No se pudo cargar el cliente de esta sede.')
          continue
        }
        const previa = ix.sedePorClave.get(`${cliente}|${claveNorm(s.nombre)}`)
        if (previa) {
          sedeUuid.set(clave, previa.id)
          paso.omitidos++
          continue
        }
        // La sede automática solo se crea si el cliente no tiene ninguna sede en la base (en un
        // reintento, si alguien ya la renombró o cargó otras, no se crea una "Principal" de más).
        if (s.automatica && (ix.sedesPorCliente.get(cliente) ?? 0) > 0) {
          paso.omitidos++
          continue
        }
        const { data, error } = await admin
          .from('sites')
          .insert({
            client_id: cliente,
            name: s.nombre,
            address: s.direccion,
            city: s.localidad,
            latitude: s.latitud,
            longitude: s.longitud,
            contact_name: s.contactoNombre,
            contact_phone: s.contactoTelefono,
            access_instructions: s.accesoInstrucciones,
            building_hours: s.horarioEdificio,
            phone_restricted: s.celularRestringido,
            photos_not_allowed: s.fotosProhibidas,
            restrictions_notes: s.otrasRestricciones,
            status: s.estado,
          })
          .select('id')
          .single()
        if (error) {
          fallo(paso, s.fila, traducirError(error))
          continue
        }
        sedeUuid.set(clave, idDe(data))
        paso.creados++
        if (s.automatica) sedesAutomaticas++
      }
    }

    // ---- Empleados y supervisores, con su usuario ----
    {
      const paso = nuevoPaso('Personas con usuario (empleados y supervisores)')
      for (const p of plan.personas) {
        const fila = p.filas.Empleados ?? p.filas.Supervisores ?? null
        try {
          const previo = ix.empleadoPorDni.get(p.dni)
          if (previo) {
            // Ya cargada: solo se completan los roles que falten (por ejemplo, ahora también
            // figura en la hoja Supervisores).
            personaUuid.set(p.dni, previo)
            const tiene = ix.rolesPorPersona.get(previo) ?? new Set<string>()
            const faltan = p.roles.filter((r) => !tiene.has(r))
            if (faltan.length > 0) {
              const { error } = await admin
                .from('user_roles')
                .insert(faltan.map((role) => ({ profile_id: previo, role })))
              if (error) {
                fallo(
                  paso,
                  fila,
                  `No se pudieron agregar los roles que faltaban. ${traducirError(error)}`,
                )
                continue
              }
            }
            paso.omitidos++
            continue
          }

          let perfil = existentes.cuentas.get(p.email)
          if (perfil) {
            // Cuenta de Auth que quedó sin su fila de empleado (corrida interrumpida): se la retoma,
            // salvo que ya sea de otra persona.
            const { data: otra, error: errorOtra } = await admin
              .from('employees')
              .select('dni')
              .eq('profile_id', perfil)
              .maybeSingle()
            if (errorOtra) {
              fallo(paso, fila, traducirError(errorOtra))
              continue
            }
            if (otra) {
              fallo(
                paso,
                fila,
                'Ya existe una cuenta con ese email que pertenece a otro empleado.',
              )
              continue
            }
          } else {
            const contrasena = await opciones.contrasenaInicial?.(p)
            const { data, error } = await admin.auth.admin.createUser({
              email: p.email,
              ...(contrasena ? { password: contrasena } : {}),
              email_confirm: true,
              user_metadata: { first_name: p.nombre, last_name: p.apellido },
            })
            if (error || !data.user) {
              fallo(
                paso,
                fila,
                `No se pudo crear la cuenta de acceso: ${error?.message ?? 'sin detalle'}`,
              )
              continue
            }
            perfil = data.user.id
            existentes.cuentas.set(p.email, perfil)
            if (!contrasena) {
              cuentasSinContrasena++
              emailsSinContrasena.push(p.email)
            }
          }

          const { error: errorEmpleado } = await admin
            .from('employees')
            .insert({
              profile_id: perfil,
              dni: p.dni,
              cuil: p.cuil,
              address: p.domicilio,
              birth_date: p.nacimiento,
              hire_date: p.ingreso,
              emergency_contact_name: p.emergenciaNombre,
              emergency_contact_phone: p.emergenciaTelefono,
              emergency_contact_relationship: p.emergenciaVinculo,
              status: p.estado,
              notes: p.notas,
              ...(p.legajo !== null ? { employee_number: p.legajo } : {}),
            })
          if (errorEmpleado) {
            fallo(
              paso,
              fila,
              `La cuenta de acceso quedó creada pero no se guardaron los datos de empleado. ${traducirError(errorEmpleado)} Corregí y reintentá con --resume.`,
            )
            continue
          }
          const { error: errorRoles } = await admin
            .from('user_roles')
            .insert(p.roles.map((role) => ({ profile_id: perfil, role })))
          if (errorRoles) {
            fallo(
              paso,
              fila,
              `No se guardaron los roles. ${traducirError(errorRoles)} Reintentá con --resume.`,
            )
            continue
          }
          if (p.telefono !== null) {
            const { error: errorTel } = await admin
              .from('profiles')
              .update({ phone: p.telefono })
              .eq('id', perfil)
            if (errorTel) {
              fallo(
                paso,
                fila,
                `No se guardó el teléfono. ${traducirError(errorTel)}`,
              )
            }
          }
          const { error: errorEvento } = await admin
            .from('security_events')
            .insert({
              event_type: 'user_created',
              target_id: perfil,
              details: {
                email: p.email,
                roles: p.roles,
                origen: 'import-initial',
              },
            })
          if (errorEvento) {
            // Igual que la Edge Function: un fallo al auditar no deshace el alta.
            avance(
              'Aviso: no se pudo registrar un evento de auditoría de alta de usuario.',
            )
          }
          personaUuid.set(p.dni, perfil)
          paso.creados++
        } catch (error) {
          fallo(
            paso,
            fila,
            error instanceof Error ? error.message : String(error),
          )
        }
      }
    }

    // ---- Habilitaciones ----
    {
      const paso = nuevoPaso('Habilitaciones')
      for (const h of plan.habilitaciones) {
        const persona = personaUuid.get(h.dni)
        const cliente = clienteUuid.get(h.clienteId)
        if (!persona || !cliente) {
          fallo(
            paso,
            h.fila,
            'No se pudo cargar la persona o el cliente de esta habilitación.',
          )
          continue
        }
        if (ix.habilitacionPorClave.has(`${persona}|${cliente}`)) {
          paso.omitidos++
          continue
        }
        const { error } = await admin
          .from('employee_client_permissions')
          .insert({ employee_id: persona, client_id: cliente })
        if (error) fallo(paso, h.fila, traducirError(error))
        else paso.creados++
      }
    }

    // ---- Servicios ----
    {
      const paso = nuevoPaso('Servicios')
      for (const s of plan.servicios) {
        const cliente = clienteUuid.get(s.clienteId)
        const sede = sedeUuid.get(`${s.clienteId}|${claveNorm(s.sedeNombre)}`)
        if (!cliente || !sede) {
          fallo(
            paso,
            s.fila,
            'No se pudo cargar el cliente o la sede de este servicio.',
          )
          continue
        }
        if (ix.servicioPorClave.has(`${sede}|${claveNorm(s.nombre)}`)) {
          paso.omitidos++
          continue
        }
        const { error } = await admin.from('services').insert({
          client_id: cliente,
          site_id: sede,
          name: s.nombre,
          weekdays: s.dias,
          start_time: s.inicio,
          end_time: s.fin,
          required_staff: s.dotacion,
          valid_from: s.desde,
          valid_to: s.hasta,
          works_on_holidays: s.seTrabajaFeriados,
          min_hours_month: s.horasMinimas,
          max_hours_month: s.horasMaximas,
          status: s.estado,
          notes: s.notas,
        })
        if (error) fallo(paso, s.fila, traducirError(error))
        else paso.creados++
      }
    }

    // ---- Feriados ----
    {
      const paso = nuevoPaso('Feriados')
      for (const f of plan.feriados) {
        if (ix.feriadoPorFecha.has(f.fecha)) {
          paso.omitidos++
          continue
        }
        const { error } = await admin
          .from('holidays')
          .insert({ holiday_date: f.fecha, name: f.nombre })
        if (error) fallo(paso, f.fila, traducirError(error))
        else paso.creados++
      }
    }

    // ---- Criterios ----
    {
      const paso = nuevoPaso('Criterios')
      for (const c of plan.criterios) {
        if (ix.criterioPorTitulo.has(claveNorm(c.titulo))) {
          paso.omitidos++
          continue
        }
        const { error } = await admin.from('rating_criteria').insert({
          position: c.orden,
          title: c.titulo,
          description: c.descripcion,
          // Sin fecha de inicio, la base pone la de hoy.
          ...(c.desde !== null ? { valid_from: c.desde } : {}),
          valid_to: c.hasta,
        })
        if (error) fallo(paso, c.fila, traducirError(error))
        else paso.creados++
      }
    }
  } catch (error) {
    // Una falla inesperada (por ejemplo, se cortó la conexión) frena la carga; lo hecho queda.
    const detalle = error instanceof Error ? error.message : String(error)
    interrumpidaEn = `${pasoActual} (${detalle})`
  }
  return {
    pasos,
    sedesAutomaticas,
    cuentasSinContrasena,
    emailsSinContrasena,
    interrumpidaEn,
  }
}
