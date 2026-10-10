import { TgForm } from './form'

// Telegram Mini App checklist form. Token comes from ?t= (issued by the bot); everything else is client-side.
export default async function TgFormPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { t } = await searchParams
  return <TgForm token={typeof t === 'string' ? t : ''} />
}
