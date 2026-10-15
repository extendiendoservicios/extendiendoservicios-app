import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * `src/api/geo.ts` (módulo B1, P22.4): mismo patrón sin red que
 * `src/api/attendance.test.ts` -- se mockea `@/lib/supabase` entero.
 */

interface PostgrestResult<T> {
  data: T | null
  error: { message: string; code?: string; hint?: string } | null
}

function makeChainable<T>(result: PostgrestResult<T>) {
  const chain: Record<string, unknown> = {
    select: vi.fn(() => chain),
    eq: vi.fn(() => chain),
    in: vi.fn(() => chain),
    order: vi.fn(() => chain),
    single: vi.fn(() => Promise.resolve(result)),
    then: (
      resolve: (value: PostgrestResult<T>) => void,
      reject?: (reason: unknown) => void,
    ) => Promise.resolve(result).then(resolve, reject),
  }
  return chain
}

const { fromMock, rpcMock } = vi.hoisted(() => ({
  fromMock: vi.fn(),
  rpcMock: vi.fn(),
}))

vi.mock('@/lib/supabase', () => ({
  supabase: { from: fromMock, rpc: rpcMock },
}))

const {
  fetchPresenceToday,
  fetchAttendanceLocation,
  correctAttendanceTime,
  overrideGeoValidation,
  fetchAttendanceCorrections,
  setGeofenceRadius,
  fetchCompanyGeofence,
  mapPresenceRow,
} = await import('./geo')

beforeEach(() => {
  fromMock.mockReset()
  rpcMock.mockReset()
})

const PRESENCE_RAW = {
  kind: 'employee',
  record_id: 'a1',
  person_id: 'p1',
  person_first_name: 'Ana',
  person_last_name: 'Gómez',
  shift_id: 's1',
  client_id: 'c1',
  client_legal_name: 'Cliente SA',
  client_trade_name: null,
  site_id: 'site1',
  site_name: 'Sede',
  shift_date: '2026-10-14',
  effective_start_time: '08:00:00',
  effective_end_time: '12:00:00',
  check_in_at: '2026-10-14T11:03:00Z',
  check_out_at: null,
  in_progress: true,
  latitude: '-34.603700',
  longitude: -58.3816,
  accuracy_m: '12.5',
  geo_status: 'outside' as const,
  geo_reason: null,
  distance_m: 350,
  geofence_radius_m: 150,
  geo_overridden: null,
  site_latitude: -34.6,
  site_longitude: -58.38,
  site_radius_m: 150,
}

describe('mapPresenceRow', () => {
  it('pasa a camelCase y normaliza los numeric que llegan como texto', () => {
    const row = mapPresenceRow(PRESENCE_RAW)
    expect(row).toMatchObject({
      kind: 'employee',
      recordId: 'a1',
      personFirstName: 'Ana',
      startTime: '08:00:00',
      inProgress: true,
      latitude: -34.6037,
      longitude: -58.3816,
      accuracyM: 12.5,
      geoStatus: 'outside',
      distanceM: 350,
      geoOverridden: false,
      siteRadiusM: 150,
    })
  })

  it('descarta filas sin tipo conocido o sin id', () => {
    expect(mapPresenceRow({ ...PRESENCE_RAW, kind: 'otro' })).toBeNull()
    expect(mapPresenceRow({ ...PRESENCE_RAW, record_id: null })).toBeNull()
  })

  it('una posición vacía queda en null', () => {
    const row = mapPresenceRow({
      ...PRESENCE_RAW,
      latitude: null,
      longitude: null,
      accuracy_m: null,
    })
    expect(row?.latitude).toBeNull()
    expect(row?.accuracyM).toBeNull()
  })
})

describe('fetchPresenceToday', () => {
  it('consulta v_presence_today con columnas explícitas', async () => {
    const chain = makeChainable({ data: [PRESENCE_RAW], error: null })
    fromMock.mockReturnValue(chain)

    const rows = await fetchPresenceToday()

    expect(fromMock).toHaveBeenCalledWith('v_presence_today')
    const selected = (chain.select as ReturnType<typeof vi.fn>).mock
      .calls[0]?.[0] as string
    expect(selected).not.toContain('*')
    expect(rows).toHaveLength(1)
  })

  it('traduce el error del servidor', async () => {
    fromMock.mockReturnValue(
      makeChainable({
        data: null,
        error: { message: 'No tenés permiso.', hint: 'FORBIDDEN' },
      }),
    )
    await expect(fetchPresenceToday()).rejects.toMatchObject({
      message: 'No tenés permiso.',
      hint: 'FORBIDDEN',
    })
  })
})

describe('fetchAttendanceLocation', () => {
  it('llama a get_attendance_location y mapea la respuesta', async () => {
    rpcMock.mockResolvedValue({
      data: {
        record_type: 'attendance',
        record_id: 'r1',
        kind: 'check_in',
        recorded_at: '2026-10-14T11:03:00Z',
        latitude: -34.6037,
        longitude: -58.3816,
        accuracy_m: 20,
        geo_status: 'valid',
        geo_reason: null,
        distance_m: 12,
        geofence_radius_m: 150,
        geo_overridden: false,
        site_id: 'site1',
        site_name: 'Sede',
        site_latitude: -34.6,
        site_longitude: -58.38,
        site_radius_m: 200,
      },
      error: null,
    })

    const location = await fetchAttendanceLocation('attendance', 'r1')

    expect(rpcMock).toHaveBeenCalledWith('get_attendance_location', {
      p_record_type: 'attendance',
      p_record_id: 'r1',
    })
    expect(location).toMatchObject({
      recordId: 'r1',
      latitude: -34.6037,
      accuracyM: 20,
      geofenceRadiusM: 150,
      siteRadiusM: 200,
    })
  })

  it('RECORD_NOT_FOUND llega como error tipado', async () => {
    rpcMock.mockResolvedValue({
      data: null,
      error: {
        message: 'No encontramos ese registro.',
        hint: 'RECORD_NOT_FOUND',
      },
    })
    await expect(
      fetchAttendanceLocation('supervision', 'x'),
    ).rejects.toMatchObject({ hint: 'RECORD_NOT_FOUND' })
  })
})

describe('correcciones', () => {
  it('correctAttendanceTime manda registro, hora y motivo', async () => {
    rpcMock.mockResolvedValue({ data: { id: 'r1' }, error: null })

    await correctAttendanceTime(
      'r1',
      '2026-10-14T08:00:00-03:00',
      'Olvidó fichar',
    )

    expect(rpcMock).toHaveBeenCalledWith('correct_attendance_time', {
      p_record_id: 'r1',
      p_new_time: '2026-10-14T08:00:00-03:00',
      p_reason: 'Olvidó fichar',
    })
  })

  it('correctAttendanceTime propaga el hint del servidor', async () => {
    rpcMock.mockResolvedValue({
      data: null,
      error: {
        message: 'La hora nueva es igual a la actual.',
        hint: 'SAME_TIME',
      },
    })
    await expect(
      correctAttendanceTime('r1', '2026-10-14T08:00:00-03:00', 'x'),
    ).rejects.toMatchObject({ hint: 'SAME_TIME' })
  })

  it('overrideGeoValidation manda tipo, registro y motivo', async () => {
    rpcMock.mockResolvedValue({ data: {}, error: null })

    await overrideGeoValidation('supervision', 's1', 'Subsuelo sin GPS')

    expect(rpcMock).toHaveBeenCalledWith('override_geo_validation', {
      p_record_type: 'supervision',
      p_record_id: 's1',
      p_reason: 'Subsuelo sin GPS',
    })
  })

  it('overrideGeoValidation propaga GEO_ALREADY_VALID', async () => {
    rpcMock.mockResolvedValue({
      data: null,
      error: {
        message: 'Este fichaje ya está validado.',
        hint: 'GEO_ALREADY_VALID',
      },
    })
    await expect(
      overrideGeoValidation('attendance', 'r1', 'x'),
    ).rejects.toMatchObject({ hint: 'GEO_ALREADY_VALID' })
  })
})

describe('fetchAttendanceCorrections', () => {
  it('sin ids no consulta', async () => {
    expect(await fetchAttendanceCorrections([])).toEqual([])
    expect(fromMock).not.toHaveBeenCalled()
  })

  it('trae las correcciones y resuelve el nombre de quien corrigió', async () => {
    const corrections = makeChainable({
      data: [
        {
          id: 'c1',
          attendance_record_id: 'r1',
          kind: 'time',
          old_recorded_at: '2026-10-14T11:30:00Z',
          new_recorded_at: '2026-10-14T11:00:00Z',
          reason: 'Fichó tarde',
          corrected_by: 'u1',
          created_at: '2026-10-14T15:00:00Z',
        },
      ],
      error: null,
    })
    const people = makeChainable({
      data: [{ profile_id: 'u1', first_name: 'Laura', last_name: 'Díaz' }],
      error: null,
    })
    fromMock.mockImplementation((table: string) =>
      table === 'attendance_corrections' ? corrections : people,
    )

    const result = await fetchAttendanceCorrections(['r1', 'r1'])

    expect(result).toEqual([
      {
        id: 'c1',
        attendanceRecordId: 'r1',
        kind: 'time',
        oldRecordedAt: '2026-10-14T11:30:00Z',
        newRecordedAt: '2026-10-14T11:00:00Z',
        reason: 'Fichó tarde',
        correctedBy: 'u1',
        correctedByName: { firstName: 'Laura', lastName: 'Díaz' },
        createdAt: '2026-10-14T15:00:00Z',
      },
    ])
    expect(corrections.in).toHaveBeenCalledWith('attendance_record_id', ['r1'])
  })
})

describe('radio general', () => {
  it('setGeofenceRadius llama a set_geofence_radius y devuelve el radio guardado', async () => {
    rpcMock.mockResolvedValue({ data: { geofence_radius_m: 200 }, error: null })
    expect(await setGeofenceRadius(200)).toBe(200)
    expect(rpcMock).toHaveBeenCalledWith('set_geofence_radius', {
      p_radius: 200,
    })
  })

  it('RADIUS_OUT_OF_RANGE llega como error tipado', async () => {
    rpcMock.mockResolvedValue({
      data: null,
      error: {
        message: 'El radio tiene que estar entre 50 y 1000 metros.',
        hint: 'RADIUS_OUT_OF_RANGE',
      },
    })
    await expect(setGeofenceRadius(5000)).rejects.toMatchObject({
      hint: 'RADIUS_OUT_OF_RANGE',
    })
  })

  it('fetchCompanyGeofence lee el radio, el tope y la fecha del consentimiento', async () => {
    fromMock.mockReturnValue(
      makeChainable({
        data: {
          geofence_radius_m: 150,
          geofence_max_accuracy_m: 150,
          location_consent_updated_at: '2026-10-14T12:00:00Z',
        },
        error: null,
      }),
    )
    expect(await fetchCompanyGeofence()).toEqual({
      radiusM: 150,
      maxAccuracyM: 150,
      locationConsentUpdatedAt: '2026-10-14T12:00:00Z',
    })
  })
})
