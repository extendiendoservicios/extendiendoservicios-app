import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import * as clientsApi from '@/api/clients'
import type {
  ClientContactInput,
  ClientFormInput,
  ClientListFilters,
  ClientStatus,
} from '@/api/clients'

/**
 * Hooks de TanStack Query de ADM-19, ADM-20 y ADM-21 (CLIENT-001). Patrón de
 * `src/api/README.md`, igual que `src/features/users/queries.ts`.
 *
 * Polling: el listado de ADM-19 no es el tablero ni "Asistencia de hoy"
 * (`02_Decisiones.md` P-005: 30 s ahí, 60 s "en el resto de las listas") —
 * 60 s acá, igual que `usersKeys`. El detalle (ADM-21), sus contactos y sus
 * sedes son lecturas puntuales de una pantalla que se abre a demanda: sin
 * polling.
 */

const LIST_POLLING_MS = 60_000

export const clientsKeys = {
  all: ['clients'] as const,
  list: (filters: ClientListFilters) =>
    [...clientsKeys.all, 'list', filters] as const,
  primaryContacts: () => [...clientsKeys.all, 'primaryContacts'] as const,
  detail: (id: string) => [...clientsKeys.all, 'detail', id] as const,
  contacts: (clientId: string) =>
    [...clientsKeys.all, 'contacts', clientId] as const,
  sites: (clientId: string) => [...clientsKeys.all, 'sites', clientId] as const,
}

// -------------------------------------------------------------------------
// Listado (ADM-19)
// -------------------------------------------------------------------------

export function useClientsQuery(filters: ClientListFilters) {
  return useQuery({
    queryKey: clientsKeys.list(filters),
    queryFn: () => clientsApi.fetchClients(filters),
    staleTime: LIST_POLLING_MS,
    refetchInterval: LIST_POLLING_MS,
  })
}

export function usePrimaryContactNamesQuery() {
  return useQuery({
    queryKey: clientsKeys.primaryContacts(),
    queryFn: clientsApi.fetchPrimaryContactNames,
    staleTime: LIST_POLLING_MS,
    refetchInterval: LIST_POLLING_MS,
  })
}

function useInvalidateClientsList() {
  const queryClient = useQueryClient()
  return () => {
    void queryClient.invalidateQueries({ queryKey: clientsKeys.all })
  }
}

// -------------------------------------------------------------------------
// Detalle y formulario (ADM-20, ADM-21)
// -------------------------------------------------------------------------

export function useClientDetailQuery(id: string | undefined) {
  return useQuery({
    queryKey: clientsKeys.detail(id ?? ''),
    queryFn: () => clientsApi.fetchClientDetail(id as string),
    enabled: id != null,
  })
}

export function useCreateClientMutation() {
  const invalidate = useInvalidateClientsList()
  return useMutation({
    mutationFn: ({
      input,
      createdBy,
    }: {
      input: ClientFormInput
      createdBy: string
    }) => clientsApi.createClient(input, createdBy),
    onSuccess: invalidate,
  })
}

export function useUpdateClientMutation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({
      id,
      input,
      updatedBy,
    }: {
      id: string
      input: ClientFormInput
      updatedBy: string
    }) => clientsApi.updateClient(id, input, updatedBy),
    onSuccess: (client) => {
      void queryClient.invalidateQueries({ queryKey: clientsKeys.all })
      queryClient.setQueryData(clientsKeys.detail(client.id), client)
    },
  })
}

/** CLIENT-006: cambio de estado desde ADM-21. */
export function useSetClientStatusMutation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({
      id,
      status,
      updatedBy,
    }: {
      id: string
      status: ClientStatus
      updatedBy: string
    }) => clientsApi.setClientStatus(id, status, updatedBy),
    onSuccess: (client) => {
      void queryClient.invalidateQueries({ queryKey: clientsKeys.all })
      queryClient.setQueryData(clientsKeys.detail(client.id), client)
    },
  })
}

// -------------------------------------------------------------------------
// Contactos (CLIENT-005)
// -------------------------------------------------------------------------

export function useClientContactsQuery(clientId: string | undefined) {
  return useQuery({
    queryKey: clientsKeys.contacts(clientId ?? ''),
    queryFn: () => clientsApi.fetchClientContacts(clientId as string),
    enabled: clientId != null,
  })
}

function useInvalidateClientContacts(clientId: string) {
  const queryClient = useQueryClient()
  return () => {
    void queryClient.invalidateQueries({
      queryKey: clientsKeys.contacts(clientId),
    })
    void queryClient.invalidateQueries({
      queryKey: clientsKeys.primaryContacts(),
    })
  }
}

export function useCreateClientContactMutation(clientId: string) {
  const invalidate = useInvalidateClientContacts(clientId)
  return useMutation({
    mutationFn: ({
      input,
      createdBy,
    }: {
      input: ClientContactInput
      createdBy: string
    }) => clientsApi.createClientContact(clientId, input, createdBy),
    onSuccess: invalidate,
  })
}

export function useUpdateClientContactMutation(clientId: string) {
  const invalidate = useInvalidateClientContacts(clientId)
  return useMutation({
    mutationFn: ({
      id,
      input,
      updatedBy,
    }: {
      id: string
      input: Omit<ClientContactInput, 'isPrimary'>
      updatedBy: string
    }) => clientsApi.updateClientContact(id, input, updatedBy),
    onSuccess: invalidate,
  })
}

export function useSetPrimaryClientContactMutation(clientId: string) {
  const invalidate = useInvalidateClientContacts(clientId)
  return useMutation({
    mutationFn: ({
      contactId,
      updatedBy,
    }: {
      contactId: string
      updatedBy: string
    }) => clientsApi.setPrimaryClientContact(clientId, contactId, updatedBy),
    onSuccess: invalidate,
  })
}

export function useDeactivateClientContactMutation(clientId: string) {
  const invalidate = useInvalidateClientContacts(clientId)
  return useMutation({
    mutationFn: ({ id, updatedBy }: { id: string; updatedBy: string }) =>
      clientsApi.deactivateClientContact(id, updatedBy),
    onSuccess: invalidate,
  })
}

// -------------------------------------------------------------------------
// Sedes del cliente (pestaña Sedes de ADM-21)
// -------------------------------------------------------------------------

export function useClientSitesQuery(clientId: string | undefined) {
  return useQuery({
    queryKey: clientsKeys.sites(clientId ?? ''),
    queryFn: () => clientsApi.fetchClientSites(clientId as string),
    enabled: clientId != null,
  })
}
