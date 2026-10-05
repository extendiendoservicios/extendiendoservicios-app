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
}
