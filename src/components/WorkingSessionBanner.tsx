import { Wallet } from 'lucide-react';
import type { WorkingSession } from '../lib/workingSession';

/** Rappelle que la caisse est commune quand elle a été ouverte par quelqu'un d'autre. */
export default function WorkingSessionBanner({ session, userId }: { session: WorkingSession | null; options?: WorkingSession[]; userId: string; onChange?: () => void }) {
  if (!session || session.user_id === userId) return null;
  return (
    <div className="rounded-xl border border-primary-200 bg-primary-50 p-3 flex items-center gap-3 text-sm text-primary-800" role="status">
      <Wallet className="w-4 h-4 shrink-0" />
      <span>Caisse commune ouverte par <strong>{session.user_name || 'un autre utilisateur'}</strong>. Les soldes et les opérations concernent cette caisse.</span>
    </div>
  );
}
