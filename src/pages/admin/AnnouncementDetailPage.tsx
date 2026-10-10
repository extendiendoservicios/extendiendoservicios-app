import { useParams } from 'react-router'
import { AnnouncementDetail } from '@/features/announcements/components/AnnouncementDetail'

/** `/admin/anuncios/:id`: detalle y «Quién lo leyó» (AJ2-03). */
export default function AnnouncementDetailPage() {
  const { id } = useParams<{ id: string }>()
  if (!id) {
    return null
  }
  return <AnnouncementDetail announcementId={id} />
}
