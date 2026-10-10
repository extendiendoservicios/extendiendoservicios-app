import { useParams } from 'react-router'
import { AnnouncementForm } from '@/features/announcements/components/AnnouncementForm'

/** `/admin/anuncios/nuevo` y `/admin/anuncios/:id/editar` (AJ2-03). */
export default function AnnouncementFormPage() {
  const { id } = useParams<{ id: string }>()
  return <AnnouncementForm announcementId={id} />
}
