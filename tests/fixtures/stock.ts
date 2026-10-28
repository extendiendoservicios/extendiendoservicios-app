// tests/fixtures/stock.ts — P25.5c (módulo E, Insumos y control de stock)
//
// Datos de prueba de Insumos para las suites e2e y la matriz de permisos. Cada suite pide un
// `InsumosE2e` con una marca propia (`adm`, `emp`, `sup`, `perm`...) y todo lo que crea lleva el
// prefijo `e2e-<marca>-` (código del artículo, nombre de la categoría, observaciones, comentarios
// y descripciones). Así:
//   - nunca se toca un insumo del seed (los códigos `QUI-`, `DES-`, `PRO-`, `UTE-`);
//   - dos archivos que corren a la vez no se pisan al limpiar.
//
// Limpieza (P25.5c): los movimientos, las líneas, los controles y el historial de precios son
// INMUTABLES (IS-27, trigger `trg_stock_immutable`, también para `postgres`). La clave de servicio
// no puede borrarlos por la API, y dejarlos acumula basura en `App_dev` (además de que un movimiento
// con turno o sede impide borrar el cliente de prueba). Por eso `purgar()` corre un script SQL con
// la CLI de Supabase contra el proyecto vinculado, igual que el seed de insumos
// (`supabase/seed-insumos-dev.sql`): apaga el trigger DENTRO de una transacción, borra solo lo que
// lleva el prefijo y lo vuelve a prender. Si algo falla, la transacción deshace todo (el trigger
// queda prendido). Antes de correr verifica que el proyecto vinculado sea el de `VITE_SUPABASE_URL`
// (App_dev) y nunca el de producción.

import { execSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { existsSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { getAdminDb } from './accounts.ts'
import { minutesSinceMidnightAR } from './dates.ts'
import { requireE2eEnv } from './env.ts'
import { sessionClient } from './scenario.ts'

const RAIZ = fileURLToPath(new URL('../..', import.meta.url))

/** Ref de producción (`App`): jamás se purga ahí. */
const REF_PRODUCCION = 'fysuppdadwvabrjpnnoh'

export interface InsumoCreado {
  id: string
  code: string
  name: string
  presentation: string | null
  categoryId: string
}

export interface OpcionesInsumo {
  /** Parte del nombre (queda `e2e-<marca>-<slug>-<azar>`). */
  slug: string
  presentation?: string
  /** Stock inicial (se carga con un ingreso real). Por omisión 0. */
  stock?: number
  /** Mínimo; sin valor, el artículo no tiene aviso amarillo. */
  minQty?: number
  cost?: number
  sale?: number
  categoryId?: string
}

function azar(): string {
  return randomBytes(3).toString('hex')
}

/** Ref del proyecto de `VITE_SUPABASE_URL` (por ejemplo `anesttvrnpsaaaxaquce`). */
function refDeLaUrl(): string {
  const host = new URL(requireE2eEnv().supabaseUrl).hostname
  return host.split('.')[0]
}

/** Falla si el proyecto vinculado de la CLI no es el de las variables de entorno (o es producción). */
function verificarProyecto(): void {
  const ref = refDeLaUrl()
  if (ref === REF_PRODUCCION) {
    throw new Error('Las pruebas de insumos no corren contra producción.')
  }
  const archivo = path.join(RAIZ, 'supabase', '.temp', 'project-ref')
  const vinculado = existsSync(archivo)
    ? readFileSync(archivo, 'utf8').trim()
    : ''
  if (vinculado !== ref) {
    throw new Error(
      `El proyecto vinculado de la CLI (${vinculado || 'ninguno'}) no es el de VITE_SUPABASE_URL (${ref}): no se purga nada.`,
    )
  }
}

function sqlPurga(prefijos: readonly string[]): string {
  // Cada prefijo es `e2e-<marca>-` con la marca en minúsculas y sin comodines: se valida acá.
  for (const prefijo of prefijos) {
    if (!/^e2e-[a-z0-9]+-$/.test(prefijo)) {
      throw new Error(`Prefijo de purga inválido: ${prefijo}`)
    }
  }
  const p = `array[${prefijos.map((x) => `'${x}%'`).join(', ')}]`
  return `
begin;
alter table public.stock_movements disable trigger trg_stock_immutable;
alter table public.stock_movement_lines disable trigger trg_stock_immutable;
alter table public.stock_counts disable trigger trg_stock_immutable;
alter table public.stock_count_lines disable trigger trg_stock_immutable;
alter table public.supply_price_changes disable trigger trg_stock_immutable;

create temp table _p_s on commit drop as
  select id from public.supplies where lower(code) like any (${p});
create temp table _p_c on commit drop as
  select id from public.supply_categories where lower(name) like any (${p});
create temp table _p_m on commit drop as
  select distinct l.movement_id as id from public.stock_movement_lines l
   where l.supply_id in (select id from _p_s)
  union
  select m.id from public.stock_movements m where lower(coalesce(m.note, '')) like any (${p});
insert into _p_m
  select m.id from public.stock_movements m
   where (m.reverses_id in (select id from _p_m)
          or m.id in (select reverses_id from public.stock_movements where id in (select id from _p_m)))
     and m.id not in (select id from _p_m);
create temp table _p_k on commit drop as
  select m.count_id as id from public.stock_movements m
   where m.id in (select id from _p_m) and m.count_id is not null
  union
  select k.id from public.stock_counts k
   where lower(coalesce(k.reviewer_name, '')) like any (${p}) or lower(coalesce(k.notes, '')) like any (${p});

delete from public.supply_shortage_reports
 where supply_id in (select id from _p_s)
    or lower(coalesce(description, '')) like any (${p})
    or lower(coalesce(comment, '')) like any (${p});
delete from public.stock_movement_lines where movement_id in (select id from _p_m);
delete from public.stock_movements where id in (select id from _p_m);
delete from public.stock_count_lines where count_id in (select id from _p_k);
delete from public.stock_counts where id in (select id from _p_k);
delete from public.supply_price_changes where supply_id in (select id from _p_s);
delete from public.supplies where id in (select id from _p_s);
delete from public.supply_categories where id in (select id from _p_c);

alter table public.stock_movements enable trigger trg_stock_immutable;
alter table public.stock_movement_lines enable trigger trg_stock_immutable;
alter table public.stock_counts enable trigger trg_stock_immutable;
alter table public.stock_count_lines enable trigger trg_stock_immutable;
alter table public.supply_price_changes enable trigger trg_stock_immutable;
commit;
`
}

/**
 * Espera, sin `sleep`, a que empiece un minuto nuevo (hora de Argentina). «Cargar control» arma la
 * hora del conteo con `HH:mm` (segundos en cero): un movimiento hecho dentro de ese mismo minuto
 * queda como POSTERIOR al conteo y la diferencia se calcularía contra un stock sin él (IS-31). El
 * test que carga el control con la hora por omisión espera a que pase el minuto de sus datos.
 */
export async function esperarMinutoNuevo(
  desde: number = minutesSinceMidnightAR(),
  timeoutMs = 90_000,
): Promise<void> {
  const limite = Date.now() + timeoutMs
  while (minutesSinceMidnightAR() === desde) {
    if (Date.now() > limite) throw new Error('El minuto no cambió a tiempo.')
    await new Promise((resolve) => setTimeout(resolve, 500))
  }
}

/** Marcas de las suites que crean datos de Insumos (para el barrido previo de residuos). */
export const MARCAS_INSUMOS = ['adm', 'emp', 'sup', 'permstock'] as const

/** `true` si quedó algo de Insumos con prefijo `e2e-` (una corrida cortada a la mitad). */
export async function hayResiduosDeInsumos(
  db: ReturnType<typeof getAdminDb> = getAdminDb(),
): Promise<boolean> {
  const pedidos = await Promise.all([
    db
      .from('supplies')
      .select('id', { count: 'exact', head: true })
      .ilike('code', 'e2e-%'),
    db
      .from('supply_categories')
      .select('id', { count: 'exact', head: true })
      .ilike('name', 'e2e-%'),
    db
      .from('supply_shortage_reports')
      .select('id', { count: 'exact', head: true })
      .or('description.ilike.e2e-%,comment.ilike.e2e-%'),
    db
      .from('stock_movements')
      .select('id', { count: 'exact', head: true })
      .ilike('note', 'e2e-%'),
  ])
  return pedidos.some((p) => (p.count ?? 0) > 0)
}

/**
 * Borra todo lo que lleve alguno de los prefijos `e2e-<marca>-` (movimientos, controles, avisos,
 * historial de precios, artículos, categorías e imágenes). Devuelve notas si algo no se pudo.
 */
export async function purgarInsumosE2e(
  marcas: readonly string[],
): Promise<string[]> {
  const notas: string[] = []
  const prefijos = marcas.map((m) => `e2e-${m}-`)
  const db = getAdminDb()
  try {
    for (const prefijo of prefijos) {
      const { data: conImagen } = await db
        .from('supplies')
        .select('image_path')
        .ilike('code', `${prefijo}%`)
        .not('image_path', 'is', null)
      const rutas = (conImagen ?? [])
        .map((s) => s.image_path)
        .filter((r): r is string => r !== null)
      if (rutas.length > 0) {
        const { error } = await db.storage.from('supply-images').remove(rutas)
        if (error) notas.push(`imágenes: ${error.message}`)
      }
    }
    verificarProyecto()
    const archivo = path.join(os.tmpdir(), `purga-insumos-${azar()}.sql`)
    writeFileSync(archivo, sqlPurga(prefijos), 'utf8')
    try {
      const cli = path.join(
        RAIZ,
        'node_modules',
        '.bin',
        process.platform === 'win32' ? 'supabase.cmd' : 'supabase',
      )
      execSync(`"${cli}" db query --linked -f "${archivo}"`, {
        cwd: RAIZ,
        stdio: 'pipe',
        timeout: 120_000,
      })
    } finally {
      unlinkSync(archivo)
    }
  } catch (error) {
    notas.push(
      `purga de insumos ${prefijos.join(', ')}: ${error instanceof Error ? error.message : String(error)}`,
    )
  }
  return notas
}

/**
 * Datos de Insumos de una suite. `marca` identifica a la suite (`adm`, `emp`, `sup`, `perm`);
 * dos suites que corren en paralelo usan marcas distintas.
 */
export class InsumosE2e {
  readonly marca: string
  readonly prefijo: string

  constructor(marca: string) {
    this.marca = marca
    this.prefijo = `e2e-${marca}-`
  }

  /** Texto reconocible para observaciones, comentarios y descripciones (la purga lo busca). */
  texto(detalle: string): string {
    return `${this.prefijo}${detalle}`
  }

  /** Categoría propia (con el prefijo en el nombre), por la RPC real como dueño. */
  async categoria(slug = 'cat'): Promise<{ id: string; name: string }> {
    const owner = await sessionClient('owner')
    const name = `${this.prefijo}${slug}-${azar()}`
    const { data, error } = await owner.rpc('upsert_supply_category', {
      p_name: name,
      p_sort_order: 900,
    })
    if (error) throw new Error(`categoría de prueba: ${error.message}`)
    return { id: data.id, name }
  }

  /** Artículo propio por las RPC reales (como dueño); el stock inicial entra con un ingreso. */
  async insumo(opciones: OpcionesInsumo): Promise<InsumoCreado> {
    const owner = await sessionClient('owner')
    const categoryId = opciones.categoryId ?? (await this.categoria()).id
    const sufijo = azar()
    const code = `${this.prefijo}${sufijo}`
    const name = `${this.prefijo}${opciones.slug}-${sufijo}`
    const { data, error } = await owner.rpc('upsert_supply', {
      p_code: code,
      p_name: name,
      p_category_id: categoryId,
      ...(opciones.presentation
        ? { p_presentation: opciones.presentation }
        : {}),
      ...(opciones.minQty !== undefined ? { p_min_qty: opciones.minQty } : {}),
      p_cost_price: opciones.cost ?? 10,
      p_sale_price: opciones.sale ?? 15,
    })
    if (error) throw new Error(`artículo de prueba: ${error.message}`)
    const stock = opciones.stock ?? 0
    if (stock > 0) await this.ingresar(data.id, stock)
    return {
      id: data.id,
      code,
      name,
      presentation: opciones.presentation ?? null,
      categoryId,
    }
  }

  /** Ingreso real (como dueño) para dejar el stock donde el test lo necesita. */
  async ingresar(supplyId: string, qty: number): Promise<void> {
    const owner = await sessionClient('owner')
    const { error } = await owner.rpc('register_stock_entry', {
      p_lines: [{ supply_id: supplyId, qty }],
      p_note: this.texto('preparación'),
    })
    if (error) throw new Error(`ingreso de preparación: ${error.message}`)
  }

  /** Stock actual del artículo (lectura con la clave de servicio, solo para verificar). */
  async stock(supplyId: string): Promise<number> {
    const { data, error } = await getAdminDb()
      .from('supplies')
      .select('stock_qty')
      .eq('id', supplyId)
      .single()
    if (error) throw new Error(`stock: ${error.message}`)
    return data.stock_qty
  }

  /**
   * Borra todo lo que lleva el prefijo de la suite: movimientos, controles, avisos, historial de
   * precios, artículos y categorías, más las imágenes subidas. Devuelve notas si algo no se pudo
   * (no rompe el test). Hay que llamarla ANTES de borrar los clientes del escenario.
   */
  async purgar(): Promise<string[]> {
    return purgarInsumosE2e([this.marca])
  }
}
