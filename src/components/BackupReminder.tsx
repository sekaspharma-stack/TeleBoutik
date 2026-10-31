import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { DatabaseBackup, X } from 'lucide-react';
import { describeBackupAge, getLastBackupAt, isBackupOverdue, isBackupReminderSnoozed, snoozeBackupReminder } from '../lib/secureBackup';

/** Bandeau de rappel : visible uniquement pour le propriétaire / gérant quand la dernière sauvegarde dépasse 24 h. */
export default function BackupReminder({ role }: { role: string }) {
  const navigate = useNavigate();
  const [visible, setVisible] = useState(false);
  const [label, setLabel] = useState('');

  useEffect(() => {
    if (role !== 'owner' && role !== 'manager') return;
    const check = () => {
      const show = isBackupOverdue() && !isBackupReminderSnoozed();
      setVisible(show);
      if (show) setLabel(describeBackupAge(getLastBackupAt()));
    };
    check();
    const timer = window.setInterval(check, 5 * 60 * 1000);
    return () => window.clearInterval(timer);
  }, [role]);

  if (!visible) return null;
  return (
    <div role="alert" className="mb-4 flex items-start gap-3 rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
      <DatabaseBackup className="mt-0.5 h-5 w-5 shrink-0" />
      <div className="min-w-0 flex-1">
        <p className="font-semibold">Sauvegarde à faire</p>
        <p className="text-xs">{label}. Une panne ou un vol du téléphone ferait perdre les données non sauvegardées.</p>
        <button type="button" className="btn-primary mt-2" onClick={() => navigate('/settings?tab=backup')}>Sauvegarder maintenant</button>
      </div>
      <button type="button" aria-label="Me le rappeler dans 4 heures" title="Me le rappeler dans 4 h" className="rounded-lg p-1 hover:bg-amber-100" onClick={() => { snoozeBackupReminder(4); setVisible(false); }}><X className="h-4 w-4" /></button>
    </div>
  );
}
