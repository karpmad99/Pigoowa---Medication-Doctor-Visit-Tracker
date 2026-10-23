import { describe, expect, it } from 'vitest';
import css from '../index.css?raw';

// Reads the colour tokens straight from index.css, so changing a colour there re-runs the check.
function readTokens(): Map<string, string> {
  const tokens = new Map<string, string>();
  for (const match of css.matchAll(/--color-([a-z0-9-]+):\s*(#[0-9a-fA-F]{6})\s*;/g)) {
    const [, name, hex] = match;
    if (name !== undefined && hex !== undefined) tokens.set(name, hex);
  }
  return tokens;
}

// WCAG 2.1 relative luminance and contrast ratio.
function luminance(hex: string): number {
  const [r = 0, g = 0, b = 0] = [1, 3, 5].map((start) => {
    const channel = parseInt(hex.slice(start, start + 2), 16) / 255;
    return channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(foreground: string, background: string): number {
  const [lighter = 0, darker = 0] = [luminance(foreground), luminance(background)].sort(
    (a, b) => b - a,
  );
  return (lighter + 0.05) / (darker + 0.05);
}

const tokens = readTokens();

function ratioOf(foreground: string, background: string): number {
  const fg = tokens.get(foreground);
  const bg = tokens.get(background);
  if (fg === undefined || bg === undefined) {
    throw new Error(`Unknown colour token: ${foreground} or ${background}`);
  }
  return contrast(fg, bg);
}

// [foreground token, background token] pairs that the components actually put together.
const textPairs: [string, string][] = [
  ['ink', 'canvas'],
  ['ink', 'surface'],
  ['ink-muted', 'canvas'],
  ['ink-muted', 'surface'],
  ['brand-700', 'surface'],
  ['brand-700', 'canvas'],
  ['brand-700', 'brand-50'],
  ['brand-700', 'brand-100'],
  ['ink', 'brand-50'], // the highlighted dose
  ['ink-muted', 'brand-50'], // the highlighted dose
  ['ink-muted', 'warning-50'], // a low-stock row
  ['warning-800', 'surface'],
  ['surface', 'brand-600'], // primary button
  ['surface', 'brand-700'], // primary button on hover
  ['surface', 'danger-600'], // danger button
  ['surface', 'danger-700'], // danger button on hover
  ['danger-700', 'surface'],
  ['danger-700', 'danger-50'],
  ['warning-800', 'warning-50'],
  ['success-800', 'success-50'],
  ['info-800', 'info-50'],
  ['neutral-800', 'neutral-100'],
];

// Borders of controls, focus ring and the active-page accent must reach 3:1 (WCAG 1.4.11).
const interfacePairs: [string, string][] = [
  ['line-strong', 'surface'],
  ['line-strong', 'canvas'],
  ['line-card', 'surface'], // the border of cards and rows
  ['line-card', 'canvas'],
  ['brand-700', 'brand-50'], // the border of the highlighted dose
  ['warning-800', 'warning-50'], // the border of a low-stock row
  ['brand-700', 'surface'], // focus ring
  ['brand-700', 'canvas'], // focus ring
  ['brand-600', 'surface'], // active navigation accent
  ['danger-600', 'surface'], // invalid control border
];

describe('design token contrast (WCAG AA)', () => {
  it('finds the tokens in index.css', () => {
    expect(tokens.size).toBeGreaterThan(15);
  });

  it.each(textPairs)('text %s on %s is at least 4.5:1', (foreground, background) => {
    expect(ratioOf(foreground, background)).toBeGreaterThanOrEqual(4.5);
  });

  it.each(interfacePairs)(
    'interface element %s on %s is at least 3:1',
    (foreground, background) => {
      expect(ratioOf(foreground, background)).toBeGreaterThanOrEqual(3);
    },
  );

  it('computes known reference ratios correctly', () => {
    expect(contrast('#000000', '#ffffff')).toBeCloseTo(21, 5);
    expect(contrast('#ffffff', '#ffffff')).toBeCloseTo(1, 5);
    expect(contrast('#777777', '#ffffff')).toBeCloseTo(4.48, 1);
  });
});
