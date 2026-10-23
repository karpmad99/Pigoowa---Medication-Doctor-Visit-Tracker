import { useCallback, useMemo, useState, type ReactNode } from 'react';
import {
  DemoChoiceContext,
  DependenciesContext,
  type AccountAppDependencies,
  type TabStorage,
} from './accountAppContext';

const DEMO_FLAG_KEY = 'pigoowa:session-mode';

function readDemoFlag(storage: TabStorage): boolean {
  try {
    return storage.getItem(DEMO_FLAG_KEY) === 'demo';
  } catch {
    return false;
  }
}

function writeDemoFlag(storage: TabStorage, isDemo: boolean): void {
  try {
    if (isDemo) storage.setItem(DEMO_FLAG_KEY, 'demo');
    else storage.removeItem(DEMO_FLAG_KEY);
  } catch {
    // The choice then lasts until the page is reloaded; nothing else depends on it.
  }
}

/**
 * Remembers, for this browser tab only (sessionStorage), that the user chose the demonstration, so that a
 * reload does not send them back to the sign-in page. Closing the tab forgets it. The demonstration's own
 * data is in localStorage and is not touched by this choice.
 */
export function AccountAppProvider({
  dependencies,
  tabStorage,
  children,
}: {
  dependencies: AccountAppDependencies;
  /** Storage that lasts as long as this tab (sessionStorage in the browser; a fake in tests). */
  tabStorage: TabStorage;
  children: ReactNode;
}) {
  const [isDemo, setIsDemo] = useState(() => readDemoFlag(tabStorage));
  const enterDemo = useCallback(() => {
    writeDemoFlag(tabStorage, true);
    setIsDemo(true);
  }, [tabStorage]);
  const leaveDemo = useCallback(() => {
    writeDemoFlag(tabStorage, false);
    setIsDemo(false);
  }, [tabStorage]);
  const choice = useMemo(() => ({ isDemo, enterDemo, leaveDemo }), [isDemo, enterDemo, leaveDemo]);
  return (
    <DependenciesContext value={dependencies}>
      <DemoChoiceContext value={choice}>{children}</DemoChoiceContext>
    </DependenciesContext>
  );
}
