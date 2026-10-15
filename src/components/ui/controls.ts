// Shared look of text inputs, selects and textareas. 16 px text stops iOS Safari from zooming
// the page when a field gets focus. An invalid control (aria-invalid) gets a red border.
export const controlClasses =
  'block w-full min-h-11 rounded-control border border-line-strong bg-surface px-3 py-2 ' +
  'text-base text-ink placeholder:text-ink-muted ' +
  'aria-invalid:border-danger-600 aria-invalid:ring-1 aria-invalid:ring-danger-600 ' +
  'disabled:cursor-not-allowed disabled:bg-canvas disabled:opacity-70';
