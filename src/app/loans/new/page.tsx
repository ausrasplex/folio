import ScreenHost from '@/components/ScreenHost';
import { guard } from '@/lib/server/guard';

export const dynamic = 'force-dynamic';

export default async function Page() {
  await guard();
  return <ScreenHost name="Setup" />;
}
