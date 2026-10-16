import { useRef, type KeyboardEvent } from 'react';
import { cx } from '@/utils/cx';
import { tabId, tabPanelId } from './tabIds';

export interface TabItem {
  id: string;
  /** What the tab says. Put a count in it if it helps: the label is also its accessible name. */
  label: string;
}

interface TabsProps {
  /** Names the group of tabs for screen readers. */
  label: string;
  tabs: readonly TabItem[];
  selectedId: string;
  onSelect: (id: string) => void;
  /** Unique on the page; the panel must use `tabPanelId(idPrefix, id)` and `aria-labelledby={tabId(idPrefix, id)}`. */
  idPrefix: string;
}

/**
 * The tab buttons (the panel is rendered by the caller). Follows the WAI-ARIA tabs pattern:
 * only the selected tab is in the Tab order; the arrow keys move between tabs (wrapping), Home and
 * End jump to the first and last, and moving selects (the panel changes at once, there is
 * nothing slow to wait for). The selected tab is shown with a thick underline and bold text, so
 * the state is not told by colour alone.
 */
export function Tabs({ label, tabs, selectedId, onSelect, idPrefix }: TabsProps) {
  const buttons = useRef(new Map<string, HTMLButtonElement>());

  const moveTo = (index: number) => {
    const target = tabs[(index + tabs.length) % tabs.length];
    if (target === undefined) return;
    onSelect(target.id);
    buttons.current.get(target.id)?.focus();
  };

  const handleKeyDown = (event: KeyboardEvent, index: number) => {
    switch (event.key) {
      case 'ArrowRight':
        moveTo(index + 1);
        break;
      case 'ArrowLeft':
        moveTo(index - 1);
        break;
      case 'Home':
        moveTo(0);
        break;
      case 'End':
        moveTo(tabs.length - 1);
        break;
      default:
        return;
    }
    event.preventDefault();
  };

  return (
    <div role="tablist" aria-label={label} className="flex border-b border-line">
      {tabs.map((tab, index) => {
        const selected = tab.id === selectedId;
        return (
          <button
            key={tab.id}
            ref={(element) => {
              if (element === null) buttons.current.delete(tab.id);
              else buttons.current.set(tab.id, element);
            }}
            type="button"
            role="tab"
            id={tabId(idPrefix, tab.id)}
            aria-selected={selected}
            aria-controls={tabPanelId(idPrefix, tab.id)}
            tabIndex={selected ? 0 : -1}
            onClick={() => {
              onSelect(tab.id);
            }}
            onKeyDown={(event) => {
              handleKeyDown(event, index);
            }}
            className={cx(
              '-mb-px min-h-11 flex-1 border-b-4 px-3 py-2 text-sm sm:flex-none sm:px-5',
              selected
                ? 'border-brand-600 font-bold text-ink'
                : 'border-transparent font-medium text-ink-muted hover:bg-canvas hover:text-ink',
            )}
          >
            {tab.label}
          </button>
        );
      })}
    </div>
  );
}
