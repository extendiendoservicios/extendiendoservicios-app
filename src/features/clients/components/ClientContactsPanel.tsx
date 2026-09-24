import { useState } from 'react'
import { toast } from 'sonner'
import { MoreHorizontal, Plus, Star, UserRound } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { IconButton } from '@/components/IconButton'
import { Skeleton } from '@/components/ui/skeleton'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { EmptyState } from '@/components/EmptyState'
import { SimpleConfirmDialog } from '@/features/settings/components/SimpleConfirmDialog'
import { isApiError } from '@/api/errors'
import type { ClientContact } from '@/api/clients'
import { useAuth } from '@/features/auth/AuthProvider'
import {
  useClientContactsQuery,
  useDeactivateClientContactMutation,
  useSetPrimaryClientContactMutation,
} from '@/features/clients/queries'
import { ClientContactFormDialog } from './ClientContactFormDialog'

/**
 * Pestaña "Contactos" de ADM-21 (CLIENT-004, CLIENT-005): lista de
 * contactos vigentes del cliente, con alta, edición, marcar principal y
 * baja lógica en línea (sin ruta propia, `05` línea 75).
 */
function ClientContactsPanel({ clientId }: { clientId: string }) {
  const auth = useAuth()
  const contactsQuery = useClientContactsQuery(clientId)
  const setPrimaryContact = useSetPrimaryClientContactMutation(clientId)
  const deactivateContact = useDeactivateClientContactMutation(clientId)

  const [editingContact, setEditingContact] = useState<ClientContact | null>(
    null,
  )
  const [isFormOpen, setFormOpen] = useState(false)
  const [contactToDeactivate, setContactToDeactivate] =
    useState<ClientContact | null>(null)

  function openNewContact() {
    setEditingContact(null)
    setFormOpen(true)
  }

  function openEditContact(contact: ClientContact) {
    setEditingContact(contact)
    setFormOpen(true)
  }

  async function handleSetPrimary(contact: ClientContact) {
    try {
      await setPrimaryContact.mutateAsync({
        contactId: contact.id,
        updatedBy: auth.userId as string,
      })
      toast.success(`Marcamos a ${contact.name} como contacto principal.`)
    } catch (error) {
      toast.error(
        isApiError(error) ? error.message : 'No pudimos cambiar el principal.',
      )
    }
  }

  async function handleDeactivate() {
    if (!contactToDeactivate) return
    try {
      await deactivateContact.mutateAsync({
        id: contactToDeactivate.id,
        updatedBy: auth.userId as string,
      })
      toast.success(`Dimos de baja a ${contactToDeactivate.name}.`)
      setContactToDeactivate(null)
    } catch (error) {
      toast.error(
        isApiError(error)
          ? error.message
          : 'No pudimos dar de baja el contacto.',
      )
    }
  }

  const contacts = contactsQuery.data ?? []

  return (
    <div className="flex flex-col gap-3">
      <div className="flex justify-end">
        <Button size="sm" icon={Plus} onClick={openNewContact}>
          Nuevo contacto
        </Button>
      </div>

      {contactsQuery.isLoading ? (
        <div className="flex flex-col gap-2">
          <Skeleton className="h-14" />
          <Skeleton className="h-14" />
        </div>
      ) : contacts.length === 0 ? (
        <EmptyState
          icon={UserRound}
          title="Todavía no hay contactos cargados"
          description='Agregá el primero con "Nuevo contacto".'
        />
      ) : (
        <ul className="flex flex-col gap-2">
          {contacts.map((contact) => (
            <li
              key={contact.id}
              className="flex items-start justify-between gap-3 rounded-lg border border-border bg-surface p-[14px]"
            >
              <div className="min-w-0">
                <p className="flex items-center gap-[6px] font-semibold text-text">
                  {contact.name}
                  {contact.isPrimary && (
                    <span
                      title="Contacto principal"
                      className="inline-flex items-center gap-1 rounded-full bg-secondary px-[7px] py-[2px] text-[10px] font-semibold text-primary-800"
                    >
                      <Star aria-hidden="true" className="size-[10px]" />
                      Principal
                    </span>
                  )}
                </p>
                {contact.roleTitle && (
                  <p className="text-[11px] text-text-3">{contact.roleTitle}</p>
                )}
                {(contact.phone || contact.email) && (
                  <p className="mt-1 text-[12px] text-text-2">
                    {[contact.phone, contact.email].filter(Boolean).join(' · ')}
                  </p>
                )}
              </div>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <IconButton
                    icon={MoreHorizontal}
                    aria-label={`Acciones para ${contact.name}`}
                  />
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onSelect={() => openEditContact(contact)}>
                    Editar
                  </DropdownMenuItem>
                  {!contact.isPrimary && (
                    <DropdownMenuItem
                      onSelect={() => void handleSetPrimary(contact)}
                    >
                      Marcar como principal
                    </DropdownMenuItem>
                  )}
                  <DropdownMenuItem
                    variant="destructive"
                    onSelect={() => setContactToDeactivate(contact)}
                  >
                    Dar de baja
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </li>
          ))}
        </ul>
      )}

      <ClientContactFormDialog
        clientId={clientId}
        contact={editingContact}
        open={isFormOpen}
        onOpenChange={setFormOpen}
      />

      <SimpleConfirmDialog
        open={contactToDeactivate != null}
        onOpenChange={(open) => !open && setContactToDeactivate(null)}
        title="Dar de baja este contacto"
        description={
          contactToDeactivate
            ? `${contactToDeactivate.name} deja de listarse entre los contactos del cliente.`
            : undefined
        }
        confirmLabel="Dar de baja"
        isLoading={deactivateContact.isPending}
        onConfirm={() => void handleDeactivate()}
      />
    </div>
  )
}

export { ClientContactsPanel }
