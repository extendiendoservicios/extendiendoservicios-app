import type { ShiftMediaRow } from '@/api/mediaAdmin'

/** Filas de prueba de `v_shift_media` ya traducidas (solo para los tests). */
export function mediaRow(
  overrides: Partial<ShiftMediaRow> = {},
): ShiftMediaRow {
  return {
    id: 'm1',
    shiftId: 'sh1',
    shiftDate: '2026-10-13',
    clientId: 'c1',
    clientName: 'Limpia Ya',
    siteId: 'si1',
    siteName: 'Sede Centro',
    assignmentId: 'a1',
    supervisionId: null,
    uploadedBy: 'p1',
    uploaderName: 'Ana Pérez',
    uploaderRole: 'employee',
    kind: 'photo',
    storagePath: 'sh1/m1.jpg',
    thumbPath: 'sh1/m1_thumb.jpg',
    sizeBytes: 170000,
    width: 1280,
    height: 960,
    durationSeconds: null,
    capturedAt: null,
    createdAt: '2026-10-13T11:15:00Z',
    keep: false,
    hasFile: true,
    expiresOn: '2026-12-12',
    retentionDays: 60,
    deletedAt: null,
    deletedBy: null,
    deletedByFirstName: null,
    deletedByLastName: null,
    ...overrides,
  }
}
