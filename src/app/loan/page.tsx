import ScreenHost from '@/components/ScreenHost';
import { guard } from '@/lib/server/guard';

export const dynamic = 'force-dynamic';

export default async function Page({ searchParams }: { searchParams: Promise<{ id?: string }> }) {
  await guard();
  const sp = await searchParams;
  return <ScreenHost name="Main" params={{ id: sp.id || '' }} />;
}
