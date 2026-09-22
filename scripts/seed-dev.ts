// scripts/seed-dev.ts — DB-019 (08_Fases_y_Backlog.md, F4 · Modelo de datos y RLS base)
//
// Crea (o reutiliza, si ya existen) los usuarios de prueba de `App_dev` por la Admin API de
// Supabase Auth. Los usuarios de `auth.users` nunca se insertan por SQL (regla del encargo): la
// única vía es esta -- `supabase.auth.admin.createUser(...)`, con la clave de servicio. Al
// crearse cada usuario, el trigger `app.handle_new_user()` (0003_profiles_roles_capabilities.sql)
// inserta la fila espejo en `public.profiles` con `first_name`/`last_name` desde
// `raw_user_meta_data` -- por eso este script manda esos dos campos en `user_metadata`.
//
// Este script SOLO crea personas en Auth (owner, administradora, supervisoras, empleados).
// Roles, capacidades, datos laborales (`employees`), clientes, sedes, servicios, turnos y el
// resto de los datos ficticios del mockup los carga `supabase/seed.sql` (búsqueda por email en
// `auth.users`), que se corre DESPUÉS de este script -- ver `pnpm db:seed` en package.json y
// `docs/database.md`.
//
// Uso local (nunca en CI: este script no aparece en ningún workflow, es solo para poblar
// `App_dev` a mano o desde `pnpm db:seed`):
//   node --env-file=.env.local scripts/seed-dev.ts
//
// Variables que lee de `.env.local` (docs/environments.md sección 4):
//   VITE_SUPABASE_URL            URL del proyecto (App_dev).
//   SUPABASE_SERVICE_ROLE_KEY    Clave de servicio, SOLO local, nunca en el frontend ni en un
//                                 secreto de CI (el nombre exacto de la variable ya lo dice: no
//                                 se imprime ni se commitea acá abajo).
//   SEED_DEV_PASSWORD            Obligatoria. Contraseña inicial para los usuarios ficticios de
//                                 staging (mínimo 8 caracteres, P-106). La elegís vos y vive
//                                 solo en `.env.local`, que git ignora. NO tiene valor por
//                                 defecto a propósito: este repositorio es público y `App_dev`
//                                 es el backend de `dev.extendiendoservicios.com`, accesible
//                                 desde internet. Una contraseña escrita acá sería la de una
//                                 cuenta con rol `owner` de un proyecto vivo, publicada para
//                                 siempre en el historial de git. Los datos son ficticios; el
//                                 acceso al proyecto, no.
//
// Sin dependencia de un framework de línea de comandos ni de `dotenv`: `@supabase/supabase-js`
// ya estaba faltando como dependencia del proyecto (el frontend todavía no tiene cliente propio,
// llega en F6/F7) y se agregó en este paquete porque este script la necesita para hablar con la
// Admin API sin reconstruir a mano un contrato REST no completamente documentado; `--env-file`
// es una flag nativa de Node (>= 20.6, este proyecto pide Node >= 24) que evita otra dependencia
// solo para leer `.env.local`.

import { createClient } from '@supabase/supabase-js'

// -------------------------------------------------------------------------------------------
// Variables de entorno
// -------------------------------------------------------------------------------------------

const SUPABASE_URL = process.env.VITE_SUPABASE_URL
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
const PASSWORD = process.env.SEED_DEV_PASSWORD

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.error(
    'Faltan variables de entorno. Corré este script con `node --env-file=.env.local ' +
      'scripts/seed-dev.ts` desde la raíz de `app/`, con VITE_SUPABASE_URL y ' +
      'SUPABASE_SERVICE_ROLE_KEY cargadas en .env.local (docs/environments.md sección 4).',
  )
  process.exit(1)
}

// Sin valor por defecto: ver el comentario de la cabecera. Preferimos que el script no corra
// antes que publicar la contraseña de una cuenta `owner` de `App_dev` en un repo público.
if (!PASSWORD || PASSWORD.length < 8) {
  console.error(
    'Falta SEED_DEV_PASSWORD en .env.local, o tiene menos de 8 caracteres (P-106).\n' +
      'Elegí una contraseña para las cuentas ficticias de staging y agregala así:\n' +
      '  SEED_DEV_PASSWORD=<la que elijas>\n' +
      'No tiene valor por defecto a propósito: este repositorio es público y esas cuentas ' +
      'entran a App_dev, que está publicado en dev.extendiendoservicios.com.',
  )
  process.exit(1)
}

// Salvaguarda de entorno (regla común 8: nada de `App`, producción, desde acá). `App_dev` tiene
// el fragmento `anesttvrnpsaaaxaquce` en su URL (docs/environments.md sección 2); `App`
// (producción) tiene `fysuppdadwvabrjpnnoh`. Si algún día `.env.local` apuntara mal, este script
// corta antes de crear un solo usuario.
if (SUPABASE_URL.includes('fysuppdadwvabrjpnnoh')) {
  console.error(
    'VITE_SUPABASE_URL apunta al proyecto de PRODUCCIÓN (App). Este script es solo para ' +
      'App_dev: corta sin crear nada. Revisá .env.local.',
  )
  process.exit(1)
}

const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
})

// -------------------------------------------------------------------------------------------
// Personas a crear (04_Modelo_de_Datos.md sección 10; nombres tomados de los que sí aparecen en
// el mockup -- `Mockup/screens_personas.py`, `screens_reportes.py`, `screens_sistema.py` -- más
// una decisión menor: el modelo pide "los diez empleados del mockup" pero el mockup real solo
// nombra nueve con legajo -- María Gómez, Juan Pérez, Sofía Ruiz, Carlos Medina, Lucía Torres,
// Rocío Aguirre, Valeria Paz, Diego Fabbri, Martín Sosa --; se agregó Patricia Núñez (legajo 045)
// como décima, con el mismo estilo, para completar la cantidad exacta que pide 04 sección 10.
// Los roles, las capacidades y los datos de `employees` los asigna `supabase/seed.sql`, no este
// script: acá solo nace la cuenta de Auth (y, por el trigger, la fila espejo de `profiles`).
//
// Emails ficticios de staging bajo el propio dominio de la empresa (P-010: el login es por email
// real, sin mapeo por DNI; "real o provisto por la empresa"): ninguna de estas casillas existe de
// verdad, así que no hace falta -- ni conviene, siendo `App_dev` un entorno público con banner
// "Entorno de prueba" -- usar direcciones de personas reales. Único email real: el del dueño
// (P-099, `extserviciosapp@gmail.com`), que además necesita estar confirmado para poder iniciar
// sesión de verdad en el panel.
// -------------------------------------------------------------------------------------------

interface UsuarioSeed {
  email: string
  first_name: string
  last_name: string
}

const USUARIOS: UsuarioSeed[] = [
  // Dueño (P-099).
  {
    email: 'extserviciosapp@gmail.com',
    first_name: 'Lucas',
    last_name: 'Enriquez',
  },
  // Administradora (Andrea Ríos, screens_sistema.py).
  {
    email: 'andrea.rios@extendiendoservicios.com',
    first_name: 'Andrea',
    last_name: 'Ríos',
  },
  // Supervisoras (Paula Lemos, Noelia Vera, screens_incidencias.py / screens_sistema.py).
  {
    email: 'paula.lemos@extendiendoservicios.com',
    first_name: 'Paula',
    last_name: 'Lemos',
  },
  {
    email: 'noelia.vera@extendiendoservicios.com',
    first_name: 'Noelia',
    last_name: 'Vera',
  },
  // Diez empleados (legajos entre paréntesis, ver supabase/seed.sql).
  {
    email: 'maria.gomez@extendiendoservicios.com',
    first_name: 'María',
    last_name: 'Gómez',
  },
  {
    email: 'juan.perez@extendiendoservicios.com',
    first_name: 'Juan',
    last_name: 'Pérez',
  },
  {
    email: 'sofia.ruiz@extendiendoservicios.com',
    first_name: 'Sofía',
    last_name: 'Ruiz',
  },
  {
    email: 'carlos.medina@extendiendoservicios.com',
    first_name: 'Carlos',
    last_name: 'Medina',
  },
  {
    email: 'lucia.torres@extendiendoservicios.com',
    first_name: 'Lucía',
    last_name: 'Torres',
  },
  {
    email: 'rocio.aguirre@extendiendoservicios.com',
    first_name: 'Rocío',
    last_name: 'Aguirre',
  },
  {
    email: 'valeria.paz@extendiendoservicios.com',
    first_name: 'Valeria',
    last_name: 'Paz',
  },
  {
    email: 'diego.fabbri@extendiendoservicios.com',
    first_name: 'Diego',
    last_name: 'Fabbri',
  },
  {
    email: 'martin.sosa@extendiendoservicios.com',
    first_name: 'Martín',
    last_name: 'Sosa',
  },
  {
    email: 'patricia.nunez@extendiendoservicios.com',
    first_name: 'Patricia',
    last_name: 'Núñez',
  },
]

// -------------------------------------------------------------------------------------------
// Alta idempotente: lista lo que ya existe (por email) y solo crea lo que falta. Con 14 personas,
// una sola página de `listUsers` (hasta 200) alcanza de sobra; no hace falta paginar. La Admin
// API no ofrece un filtro por email en `listUsers` (revisado en los tipos de `@supabase/auth-js`
// instalados: `PageParams` solo acepta `page`/`perPage`), así que el filtro se hace acá.
// -------------------------------------------------------------------------------------------

async function main(): Promise<void> {
  console.log(`Buscando usuarios existentes en ${SUPABASE_URL}...`)
  const { data: listado, error: errorListado } =
    await admin.auth.admin.listUsers({
      page: 1,
      perPage: 200,
    })
  if (errorListado) {
    throw new Error(
      `No se pudo listar usuarios existentes: ${errorListado.message}`,
    )
  }

  const existentesPorEmail = new Map(
    listado.users.map((usuario) => [usuario.email?.toLowerCase(), usuario]),
  )

  let creados = 0
  let reutilizados = 0
  let fallidos = 0

  for (const usuario of USUARIOS) {
    const previo = existentesPorEmail.get(usuario.email.toLowerCase())
    if (previo) {
      // La cuenta de Auth no se recrea nunca (perdería su id, y con él todo lo que cuelga del
      // perfil). Pero sí se sincroniza el nombre: si cambia en la lista de arriba, una corrida
      // nueva tiene que dejarlo igual en la base, o el seed deja de ser idempotente. Acá se
      // actualiza solo la metadata de Auth; la fila espejo de `public.profiles` la sincroniza
      // `supabase/seed.sql` leyendo esa misma metadata, porque el trigger `app.handle_new_user()`
      // (0003) la copia solo al insertar y `service_role` no puede actualizar `profiles` por
      // PostgREST: el trigger de la tabla vive en el esquema `app`, cerrado en 0016/0017
      // (`permission denied for schema app`). El paso SQL corre como `postgres` y sí puede.
      const metadata = previo.user_metadata ?? {}
      if (
        metadata.first_name !== usuario.first_name ||
        metadata.last_name !== usuario.last_name
      ) {
        const { error: errorMeta } = await admin.auth.admin.updateUserById(
          previo.id,
          {
            user_metadata: {
              ...metadata,
              first_name: usuario.first_name,
              last_name: usuario.last_name,
            },
          },
        )
        if (errorMeta) {
          console.error(
            `- ${usuario.email}: error al actualizar el nombre en Auth -> ${errorMeta.message}`,
          )
          fallidos += 1
          continue
        }
      }

      console.log(
        `- ${usuario.email}: ya existe (id ${previo.id}), no se recrea.`,
      )
      reutilizados += 1
      continue
    }

    const { data: creado, error: errorCrear } =
      await admin.auth.admin.createUser({
        email: usuario.email,
        password: PASSWORD,
        email_confirm: true,
        user_metadata: {
          first_name: usuario.first_name,
          last_name: usuario.last_name,
        },
      })

    if (errorCrear || !creado.user) {
      console.error(
        `- ${usuario.email}: error al crear -> ${errorCrear?.message}`,
      )
      fallidos += 1
      continue
    }

    console.log(`- ${usuario.email}: creado (id ${creado.user.id}).`)
    creados += 1
  }

  console.log(
    `\nListo: ${creados} creado(s), ${reutilizados} ya existían, ${fallidos} fallaron.`,
  )
  if (fallidos > 0) {
    process.exitCode = 1
    return
  }

  console.log(
    'Ahora corré `pnpm db:seed:data` (o `supabase db query --linked -f supabase/seed.sql`) ' +
      'para cargar roles, capacidades y el resto de los datos ficticios.',
  )
}

main().catch((error: unknown) => {
  console.error(error)
  process.exit(1)
})
