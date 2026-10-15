import { Icon } from '@/components/ui/Icon';

/**
 * The permanent reminder (PROJECT_SPEC §2) that Pigoowa organises information and is not a
 * medical authority. Shown in the footer of every page.
 */
export function SafetyNote() {
  return (
    <p className="flex gap-2 border-t border-line pt-4 text-sm text-ink-muted">
      <Icon name="info" className="mt-0.5 size-4" />
      <span>
        Pigoowa to narzędzie organizacyjne. Nie udziela porad medycznych i nie zastępuje zaleceń
        lekarza. Harmonogramy ustawiasz samodzielnie.
      </span>
    </p>
  );
}
