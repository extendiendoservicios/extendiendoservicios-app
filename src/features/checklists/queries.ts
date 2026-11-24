import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import * as checklistsApi from '@/api/checklists'
import type {
  ChecklistItemInput,
  ChecklistTemplateItem,
} from '@/api/checklists'

/**
 * Hooks de TanStack Query de ADM-26, y de la parte "plantilla" de ADM-21/
 * ADM-22 (TASK-003). Patrón de `src/api/README.md`, igual que
 * `src/features/clients/queries.ts`.
 *
 * Sin polling: ADM-26 no está en la lista de pantallas con polling de
 * `02_Decisiones.md` P-005 (es una pantalla de configuración, de uso
 * esporádico). Invalidación amplia (`checklistsKeys.all`) en cada
 * mutación: el volumen de plantillas e ítems por cliente es bajo y no
 * justifica una invalidación más fina.
 */

export const checklistsKeys = {
  all: ['checklists'] as const,
  template: (clientId: string, siteId: string | null) =>
    [...checklistsKeys.all, 'template', clientId, siteId] as const,
  items: (templateId: string) =>
    [...checklistsKeys.all, 'items', templateId] as const,
  /** D-03: turnos próximos con tareas distintas a la plantilla. */
  outdated: (clientId: string, siteId: string | null) =>
    [...checklistsKeys.all, 'outdated', clientId, siteId] as const,
}

/** La plantilla vigente de un cliente (`siteId` `null`) o de una sede. */
export function useChecklistTemplateQuery(
  clientId: string | undefined,
  siteId: string | null,
) {
  return useQuery({
    queryKey: checklistsKeys.template(clientId ?? '', siteId),
    queryFn: () =>
      checklistsApi.fetchChecklistTemplate(clientId as string, siteId),
    enabled: clientId != null,
  })
}

/**
 * D-03: cuántos turnos próximos tienen tareas distintas a la plantilla.
 * Solo se consulta si quien mira puede editar (la RPC exige `edit_checklists`).
 */
export function useOutdatedTemplateShiftsCountQuery(
  clientId: string | undefined,
  siteId: string | null,
  enabled: boolean,
) {
  return useQuery({
    queryKey: checklistsKeys.outdated(clientId ?? '', siteId),
    queryFn: () =>
      checklistsApi.countOutdatedTemplateShifts(clientId as string, siteId),
    enabled: enabled && clientId != null,
  })
}

/**
 * D-03: recarga las tareas de los turnos próximos desactualizados. Además de
 * los checklists, refresca todo lo que muestra tareas de un turno. Las raíces
 * van como literales para no importar en círculo.
 */
export function useReloadTemplateShiftTasksMutation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({
      clientId,
      siteId,
    }: {
      clientId: string
      siteId: string | null
    }) => checklistsApi.reloadTemplateShiftTasks(clientId, siteId),
    onSuccess: () => {
      for (const root of ['checklists', 'planning', 'shifts', 'employee']) {
        void queryClient.invalidateQueries({ queryKey: [root] })
      }
    },
  })
}

export function useChecklistItemsQuery(templateId: string | undefined) {
  return useQuery({
    queryKey: checklistsKeys.items(templateId ?? ''),
    queryFn: () => checklistsApi.fetchTemplateItems(templateId as string),
    enabled: templateId != null,
  })
}

function useInvalidateChecklists() {
  const queryClient = useQueryClient()
  return () => {
    void queryClient.invalidateQueries({ queryKey: checklistsKeys.all })
  }
}

export function useCreateClientTemplateMutation() {
  const invalidate = useInvalidateChecklists()
  return useMutation({
    mutationFn: ({
      clientId,
      createdBy,
    }: {
      clientId: string
      createdBy: string
    }) => checklistsApi.createClientTemplate(clientId, createdBy),
    onSuccess: invalidate,
  })
}

export function useCloneChecklistTemplateMutation() {
  const invalidate = useInvalidateChecklists()
  return useMutation({
    mutationFn: ({ clientId, siteId }: { clientId: string; siteId: string }) =>
      checklistsApi.cloneChecklistTemplate(clientId, siteId),
    onSuccess: invalidate,
  })
}

export function useCreateTemplateItemMutation() {
  const invalidate = useInvalidateChecklists()
  return useMutation({
    mutationFn: ({
      templateId,
      position,
      input,
      createdBy,
    }: {
      templateId: string
      position: number
      input: ChecklistItemInput
      createdBy: string
    }) =>
      checklistsApi.createTemplateItem(templateId, position, input, createdBy),
    onSuccess: invalidate,
  })
}

export function useUpdateTemplateItemMutation() {
  const invalidate = useInvalidateChecklists()
  return useMutation({
    mutationFn: ({
      id,
      input,
      updatedBy,
    }: {
      id: string
      input: ChecklistItemInput
      updatedBy: string
    }) => checklistsApi.updateTemplateItem(id, input, updatedBy),
    onSuccess: invalidate,
  })
}

export function useDeactivateTemplateItemMutation() {
  const invalidate = useInvalidateChecklists()
  return useMutation({
    mutationFn: ({ id, updatedBy }: { id: string; updatedBy: string }) =>
      checklistsApi.deactivateTemplateItem(id, updatedBy),
    onSuccess: invalidate,
  })
}

export function useReorderTemplateItemsMutation() {
  const invalidate = useInvalidateChecklists()
  return useMutation({
    mutationFn: ({
      items,
      updatedBy,
    }: {
      items: ChecklistTemplateItem[]
      updatedBy: string
    }) => checklistsApi.reorderTemplateItems(items, updatedBy),
    onSuccess: invalidate,
  })
}
