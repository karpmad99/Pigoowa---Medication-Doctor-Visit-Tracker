import { useEffect } from 'react';

const APP_NAME = 'Pigoowa';

/**
 * Sets the browser tab title for the current page ("Leki – Pigoowa"). Single-page apps never
 * reload, so without this every page would keep the same title, which also matters to screen
 * reader users. Pass `null` for the home page, whose title is just the app name.
 */
export function usePageTitle(pageTitle: string | null): void {
  useEffect(() => {
    document.title = pageTitle === null ? APP_NAME : `${pageTitle} – ${APP_NAME}`;
  }, [pageTitle]);
}
