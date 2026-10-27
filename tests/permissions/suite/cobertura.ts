// tests/permissions/suite/cobertura.ts — TEST-019 (P18.3)
//
// Lo que la matriz declara cubrir fuera de las tablas, vistas y RPC (que se derivan de `tablas.ts`,
// `vistas.ts` y `rpc.ts`). El test de inventario compara esto con las migraciones y con las Edge
// Functions del repositorio: si aparece un bucket, una función o una acción nueva sin casos,
// falla hasta que se la agregue a la matriz (y a esta lista).

export const BUCKETS_CUBIERTOS = ['avatars', 'branding'] as const

/** Edge Functions cubiertas y las acciones de cada una (ver `edge-casos.ts`). */
export const EDGE_CUBIERTAS: Record<string, readonly string[]> = {
  'admin-users': [
    'create_user',
    'reset_password',
    'update_email',
    'sign_out_user',
    'deactivate_user',
    'reactivate_user',
  ],
  // Sin acciones: se autentica con el secreto del encabezado, no con un JWT (H-08, P21.1). Sus
  // casos están en `61-edge-evidence-cleanup.permissions.ts`.
  'evidence-cleanup': [],
}

/**
 * Objetos cuyos casos viven en una suite propia y no en las matrices genéricas (`tablas.ts`,
 * `vistas.ts`, `rpc.ts`). Cada uno se vincula al archivo que lo cubre, y el inventario comprueba
 * que ese archivo exista y nombre de verdad al objeto: no alcanza con declararlo.
 */
export type SuiteExterna =
  | '90-evidencia.permissions.ts'
  | '91-modulos-p19.permissions.ts'
  | '61-edge-evidence-cleanup.permissions.ts'
  | '95-insumos.permissions.ts'
  | '96-client-photos.permissions.ts'

export const COBERTURA_EXTERNA: {
  tablas: Record<string, SuiteExterna>
  vistas: Record<string, SuiteExterna>
  rpc: Record<string, SuiteExterna>
  buckets: Record<string, SuiteExterna>
} = {
  tablas: {
    // Módulo H (0047)
    shift_media: '90-evidencia.permissions.ts',
    // Avisos y anuncios (0042), datos bancarios y observación del turno (0040), fijos (0041)
    announcements: '91-modulos-p19.permissions.ts',
    announcement_recipients: '91-modulos-p19.permissions.ts',
    announcement_reads: '91-modulos-p19.permissions.ts',
    client_bank_details: '91-modulos-p19.permissions.ts',
    employee_bank_details: '91-modulos-p19.permissions.ts',
    shift_observations: '91-modulos-p19.permissions.ts',
    service_fixed_employees: '91-modulos-p19.permissions.ts',
    // Insumos y control de stock (0070, P25.5c)
    supply_categories: '95-insumos.permissions.ts',
    supplies: '95-insumos.permissions.ts',
    supply_price_changes: '95-insumos.permissions.ts',
    stock_movements: '95-insumos.permissions.ts',
    stock_movement_lines: '95-insumos.permissions.ts',
    stock_counts: '95-insumos.permissions.ts',
    stock_count_lines: '95-insumos.permissions.ts',
    supply_shortage_reports: '95-insumos.permissions.ts',
  },
  vistas: {
    v_shift_media: '90-evidencia.permissions.ts',
    v_announcements_admin: '91-modulos-p19.permissions.ts',
    v_announcement_recipients: '91-modulos-p19.permissions.ts',
    v_my_announcements: '91-modulos-p19.permissions.ts',
    // Insumos y control de stock (0070 y 0072, P25.5c)
    v_supply_catalog: '95-insumos.permissions.ts',
    v_stock_admin: '95-insumos.permissions.ts',
    v_stock_movements_admin: '95-insumos.permissions.ts',
    v_stock_counts_admin: '95-insumos.permissions.ts',
    v_supply_consumption_by_client: '95-insumos.permissions.ts',
    v_my_withdrawals: '95-insumos.permissions.ts',
    v_my_shortage_reports: '95-insumos.permissions.ts',
    v_withdrawal_shift_options: '95-insumos.permissions.ts',
    v_withdrawal_site_options: '95-insumos.permissions.ts',
    v_withdrawal_shift_options_admin: '95-insumos.permissions.ts',
    v_withdrawal_site_options_admin: '95-insumos.permissions.ts',
  },
  rpc: {
    begin_shift_media: '90-evidencia.permissions.ts',
    confirm_shift_media: '90-evidencia.permissions.ts',
    remove_shift_media: '90-evidencia.permissions.ts',
    set_shift_media_keep: '90-evidencia.permissions.ts',
    set_shift_media_keep_many: '90-evidencia.permissions.ts',
    delete_shift_media: '90-evidencia.permissions.ts',
    storage_usage: '90-evidencia.permissions.ts',
    set_media_retention: '90-evidencia.permissions.ts',
    // Insumos y control de stock (0070, P25.5c)
    upsert_supply: '95-insumos.permissions.ts',
    set_supply_active: '95-insumos.permissions.ts',
    set_supply_prices: '95-insumos.permissions.ts',
    upsert_supply_category: '95-insumos.permissions.ts',
    register_stock_entry: '95-insumos.permissions.ts',
    adjust_stock: '95-insumos.permissions.ts',
    register_withdrawal: '95-insumos.permissions.ts',
    void_stock_movement: '95-insumos.permissions.ts',
    register_stock_count: '95-insumos.permissions.ts',
    report_supply_shortage: '95-insumos.permissions.ts',
    resolve_supply_shortage: '95-insumos.permissions.ts',
    get_stock_summary: '95-insumos.permissions.ts',
  },
  buckets: {
    evidence: '90-evidencia.permissions.ts',
    'supply-images': '95-insumos.permissions.ts',
    // Lo agregó P19.6c (0039); la matriz no lo veía por el guion del nombre (P25.5c).
    'client-photos': '96-client-photos.permissions.ts',
  },
}
