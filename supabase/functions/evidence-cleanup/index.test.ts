// Tests Deno de la Edge Function `evidence-cleanup` (módulo H, P21.1).
//
// Sin red ni base: la lógica recibe un cliente simulado con la forma mínima que usa (`rpc` y
// `storage.from().remove()`). `deno test --allow-env --allow-net` desde esta carpeta.
//
// Qué NO cubren estos tests: la regla de qué archivos vencen (vive en SQL y la prueba pgTAP
// 0047_p21_1_evidencia_turnos.test.sql) ni el borrado real contra Storage (se verifica en vivo en
// P21.5, cuando se despliegue).

import { assertEquals } from 'jsr:@std/assert@1'
import { handleRequest, secretsMatch, SECRET_HEADER } from './index.ts'
import {
  isEvidencePath,
  runCleanup,
  type CleanupCandidate,
  type CleanupClient,
} from './cleanup.ts'

Deno.env.set('EVIDENCE_CLEANUP_SECRET', 'secreto-de-prueba')

const SHIFT = '11111111-1111-1111-1111-111111111111'

function candidate(
  n: number,
  reason: CleanupCandidate['reason'] = 'expired',
): CleanupCandidate {
  const id = `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`
  return {
    media_id: id,
    storage_path: `${SHIFT}/${id}.jpg`,
    thumb_path: `${SHIFT}/${id}_thumb.jpg`,
    reason,
  }
}

interface Calls {
  rpc: { fn: string; args?: Record<string, unknown> }[]
  removed: string[][]
}

// Cliente simulado: `batches` son las respuestas sucesivas de evidence_cleanup_candidates.
function fakeClient(
  batches: CleanupCandidate[][],
  opts: {
    removeError?: string
    markError?: string
    candidatesError?: string
    markReturns?: number
  } = {},
): { client: CleanupClient; calls: Calls } {
  const calls: Calls = { rpc: [], removed: [] }
  let next = 0
  const client: CleanupClient = {
    rpc(fn, args) {
      calls.rpc.push({ fn, args })
      if (fn === 'evidence_cleanup_candidates') {
        if (opts.candidatesError)
          return Promise.resolve({
            data: null,
            error: { message: opts.candidatesError },
          })
        return Promise.resolve({ data: batches[next++] ?? [], error: null })
      }
      if (opts.markError)
        return Promise.resolve({
          data: null,
          error: { message: opts.markError },
        })
      const ids = (args?.p_ids ?? []) as string[]
      return Promise.resolve({
        data: opts.markReturns ?? ids.length,
        error: null,
      })
    },
    storage: {
      from(bucket) {
        assertEquals(bucket, 'evidence')
        return {
          remove(paths) {
            calls.removed.push(paths)
            if (opts.removeError)
              return Promise.resolve({
                data: null,
                error: { message: opts.removeError },
              })
            return Promise.resolve({
              data: paths.map((name) => ({ name })),
              error: null,
            })
          },
        }
      },
    },
  }
  return { client, calls }
}

function request(method = 'POST', headers: Record<string, string> = {}) {
  return new Request(
    'https://example.supabase.co/functions/v1/evidence-cleanup',
    { method, headers },
  )
}

// handleRequest: autenticación -------------------------------------------------------------------

Deno.test('rechaza métodos que no son POST', async () => {
  const res = await handleRequest(
    request('GET', { [SECRET_HEADER]: 'secreto-de-prueba' }),
    () => fakeClient([]).client,
  )
  assertEquals(res.status, 405)
})

Deno.test(
  'sin el encabezado del secreto responde 401 y no toca nada',
  async () => {
    let creado = false
    const res = await handleRequest(request('POST'), () => {
      creado = true
      return fakeClient([]).client
    })
    assertEquals(res.status, 401)
    assertEquals((await res.json()).code, 'UNAUTHORIZED')
    assertEquals(creado, false)
  },
)

Deno.test('con un secreto incorrecto responde 401', async () => {
  const res = await handleRequest(
    request('POST', { [SECRET_HEADER]: 'otro' }),
    () => fakeClient([]).client,
  )
  assertEquals(res.status, 401)
})

Deno.test('un JWT de usuario no sustituye al secreto', async () => {
  const res = await handleRequest(
    request('POST', { Authorization: 'Bearer cualquier.jwt.token' }),
    () => fakeClient([]).client,
  )
  assertEquals(res.status, 401)
})

Deno.test(
  'si la función no tiene secreto configurado, falla cerrada (500)',
  async () => {
    Deno.env.delete('EVIDENCE_CLEANUP_SECRET')
    try {
      const res = await handleRequest(
        request('POST', { [SECRET_HEADER]: '' }),
        () => fakeClient([]).client,
      )
      assertEquals(res.status, 500)
      assertEquals((await res.json()).code, 'NOT_CONFIGURED')
    } finally {
      Deno.env.set('EVIDENCE_CLEANUP_SECRET', 'secreto-de-prueba')
    }
  },
)

Deno.test(
  'con el secreto correcto corre el barrido y responde el resumen',
  async () => {
    const { client, calls } = fakeClient([
      [candidate(1), candidate(2, 'removed')],
    ])
    const res = await handleRequest(
      request('POST', { [SECRET_HEADER]: 'secreto-de-prueba' }),
      () => client,
    )
    assertEquals(res.status, 200)
    const body = await res.json()
    assertEquals(body.ok, true)
    assertEquals(body.expired, 1)
    assertEquals(body.removed, 1)
    assertEquals(body.rows_marked, 2)
    assertEquals(calls.removed.length, 1)
  },
)

Deno.test(
  'si el barrido tiene errores responde 500 con el resumen',
  async () => {
    const { client } = fakeClient([[candidate(1)]], { removeError: 'timeout' })
    const res = await handleRequest(
      request('POST', { [SECRET_HEADER]: 'secreto-de-prueba' }),
      () => client,
    )
    assertEquals(res.status, 500)
    assertEquals((await res.json()).ok, false)
  },
)

Deno.test('secretsMatch compara por valor', async () => {
  assertEquals(await secretsMatch('abc', 'abc'), true)
  assertEquals(await secretsMatch('abc', 'abd'), false)
  assertEquals(await secretsMatch('', 'abc'), false)
})

// runCleanup: el barrido ---------------------------------------------------------------------------

Deno.test(
  'borra archivo y miniatura de cada candidato y recién después marca las filas',
  async () => {
    const { client, calls } = fakeClient([
      [candidate(1), candidate(2, 'pending_stale')],
    ])
    const summary = await runCleanup(client)
    assertEquals(calls.removed, [
      [
        candidate(1).storage_path,
        candidate(1).thumb_path,
        candidate(2).storage_path,
        candidate(2).thumb_path,
      ],
    ])
    assertEquals(
      calls.rpc.map((c) => c.fn),
      ['evidence_cleanup_candidates', 'evidence_cleanup_mark'],
    )
    assertEquals(calls.rpc[1].args, {
      p_ids: [candidate(1).media_id, candidate(2).media_id],
    })
    assertEquals(summary.expired, 1)
    assertEquals(summary.pending_stale, 1)
    assertEquals(summary.files_requested, 4)
    assertEquals(summary.complete, true)
    assertEquals(summary.errors, [])
  },
)

Deno.test('sin candidatos no borra nada y termina completo', async () => {
  const { client, calls } = fakeClient([[]])
  const summary = await runCleanup(client)
  assertEquals(calls.removed.length, 0)
  assertEquals(summary.complete, true)
  assertEquals(summary.batches, 0)
})

Deno.test(
  'si Storage falla no marca las filas (se reintenta en la próxima corrida)',
  async () => {
    const { client, calls } = fakeClient([[candidate(1)]], {
      removeError: 'timeout',
    })
    const summary = await runCleanup(client)
    assertEquals(
      calls.rpc.some((c) => c.fn === 'evidence_cleanup_mark'),
      false,
    )
    assertEquals(summary.errors.length, 1)
    assertEquals(summary.complete, false)
  },
)

Deno.test(
  'los errores de la respuesta no filtran el detalle interno de Storage ni de Postgres',
  async () => {
    const secreto =
      'permission denied for table evidence_media; ruta evidence/abc/def.jpg'
    const casos = [
      fakeClient([[candidate(1)]], { removeError: secreto }),
      fakeClient([[candidate(1)]], { markError: secreto }),
      fakeClient([], { candidatesError: secreto }),
    ]
    const original = console.error
    const logs: string[] = []
    console.error = (...a: unknown[]) => logs.push(a.map(String).join(' '))
    try {
      for (const { client } of casos) {
        const summary = await runCleanup(client)
        assertEquals(summary.errors.length, 1)
        assertEquals(summary.errors[0].includes('permission denied'), false)
        assertEquals(summary.errors[0].includes('evidence/abc'), false)
      }
    } finally {
      console.error = original
    }
    // El detalle completo queda en el log de la función.
    assertEquals(logs.length, 3)
    assertEquals(
      logs.every((l) => l.includes('permission denied')),
      true,
    )
  },
)

Deno.test('si no puede marcar las filas lo informa', async () => {
  const { client } = fakeClient([[candidate(1)]], { markError: 'sin permiso' })
  const summary = await runCleanup(client)
  assertEquals(summary.errors.length, 1)
  assertEquals(summary.rows_marked, 0)
})

Deno.test('si falla la lectura de candidatos no borra nada', async () => {
  const { client, calls } = fakeClient([], { candidatesError: 'caído' })
  const summary = await runCleanup(client)
  assertEquals(calls.removed.length, 0)
  assertEquals(summary.errors.length, 1)
})

Deno.test(
  'procesa varios lotes hasta que el último viene incompleto',
  async () => {
    const { client, calls } = fakeClient([
      [candidate(1), candidate(2)],
      [candidate(3), candidate(4)],
      [candidate(5)],
    ])
    const summary = await runCleanup(client, { batchSize: 2 })
    assertEquals(calls.removed.length, 3)
    assertEquals(summary.batches, 3)
    assertEquals(summary.rows_marked, 5)
    assertEquals(summary.complete, true)
  },
)

Deno.test('respeta el máximo de lotes por corrida', async () => {
  const { client, calls } = fakeClient([
    [candidate(1)],
    [candidate(2)],
    [candidate(3)],
  ])
  const summary = await runCleanup(client, { batchSize: 1, maxBatches: 2 })
  assertEquals(calls.removed.length, 2)
  assertEquals(summary.complete, false)
})

Deno.test(
  'no borra rutas que no tengan la forma de una ruta de evidencia',
  async () => {
    const mala: CleanupCandidate = {
      ...candidate(9),
      storage_path: '../avatars/otra-cosa.jpg',
    }
    const { client, calls } = fakeClient([[mala, candidate(1)]])
    const summary = await runCleanup(client)
    assertEquals(calls.removed, [
      [candidate(1).storage_path, candidate(1).thumb_path],
    ])
    assertEquals(summary.invalid_paths, 1)
    assertEquals(calls.rpc[1].args, { p_ids: [candidate(1).media_id] })
  },
)

Deno.test(
  'si el lote no marca ninguna fila corta para no repetirlo',
  async () => {
    const { client } = fakeClient([[candidate(1)], [candidate(1)]], {
      markReturns: 0,
    })
    const summary = await runCleanup(client, { batchSize: 1 })
    assertEquals(summary.batches, 1)
    assertEquals(summary.errors.length, 1)
  },
)

Deno.test('isEvidencePath acepta las rutas del módulo y nada más', () => {
  const id = '00000000-0000-0000-0000-000000000001'
  assertEquals(isEvidencePath(`${SHIFT}/${id}.jpg`), true)
  assertEquals(isEvidencePath(`${SHIFT}/${id}.mp4`), true)
  assertEquals(isEvidencePath(`${SHIFT}/${id}.webm`), true)
  assertEquals(isEvidencePath(`${SHIFT}/${id}_thumb.jpg`), true)
  assertEquals(isEvidencePath(`${SHIFT}/${id}.exe`), false)
  assertEquals(isEvidencePath(`${id}.jpg`), false)
  assertEquals(isEvidencePath(null), false)
})
