import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';
import { Tabs } from './Tabs';
import { tabId, tabPanelId } from './tabIds';

const tabs = [
  { id: 'a', label: 'Pierwsza (2)' },
  { id: 'b', label: 'Druga (0)' },
  { id: 'c', label: 'Trzecia (5)' },
];

function Harness({ initial = 'a' }: { initial?: string }) {
  const [selected, setSelected] = useState(initial);
  return (
    <>
      <Tabs
        label="Przykład"
        tabs={tabs}
        selectedId={selected}
        onSelect={setSelected}
        idPrefix="t"
      />
      <div role="tabpanel" id={tabPanelId('t', selected)} aria-labelledby={tabId('t', selected)}>
        Panel {selected}
      </div>
    </>
  );
}

describe('Tabs', () => {
  it('is a labelled tablist whose tabs are named by their text, with exactly one selected', () => {
    render(<Harness />);

    expect(screen.getByRole('tablist', { name: 'Przykład' })).toBeVisible();
    expect(screen.getAllByRole('tab').map((tab) => tab.textContent)).toEqual([
      'Pierwsza (2)',
      'Druga (0)',
      'Trzecia (5)',
    ]);
    expect(screen.getByRole('tab', { name: 'Pierwsza (2)' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    expect(screen.getByRole('tab', { name: 'Druga (0)' })).toHaveAttribute(
      'aria-selected',
      'false',
    );
  });

  it('ties the tab to its panel in both directions', () => {
    render(<Harness initial="b" />);

    const tab = screen.getByRole('tab', { name: 'Druga (0)' });
    const panel = screen.getByRole('tabpanel', { name: 'Druga (0)' });
    expect(tab).toHaveAttribute('aria-controls', panel.id);
    expect(panel).toHaveAttribute('aria-labelledby', tab.id);
  });

  it('selects a tab on click', async () => {
    const user = userEvent.setup();
    render(<Harness />);

    await user.click(screen.getByRole('tab', { name: 'Trzecia (5)' }));

    expect(screen.getByRole('tab', { name: 'Trzecia (5)' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    expect(screen.getByRole('tabpanel')).toHaveTextContent('Panel c');
  });

  it('keeps only the selected tab in the Tab order', () => {
    render(<Harness initial="b" />);

    expect(screen.getByRole('tab', { name: 'Druga (0)' })).toHaveAttribute('tabindex', '0');
    expect(screen.getByRole('tab', { name: 'Pierwsza (2)' })).toHaveAttribute('tabindex', '-1');
  });

  it('moves with the arrow keys, wrapping around, and selects and focuses the new tab', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    screen.getByRole('tab', { name: 'Pierwsza (2)' }).focus();

    await user.keyboard('{ArrowRight}');
    expect(screen.getByRole('tab', { name: 'Druga (0)' })).toHaveFocus();
    expect(screen.getByRole('tabpanel')).toHaveTextContent('Panel b');

    await user.keyboard('{ArrowRight}{ArrowRight}');
    expect(screen.getByRole('tab', { name: 'Pierwsza (2)' })).toHaveFocus(); // wrapped

    await user.keyboard('{ArrowLeft}');
    expect(screen.getByRole('tab', { name: 'Trzecia (5)' })).toHaveFocus(); // wrapped back
    expect(screen.getByRole('tabpanel')).toHaveTextContent('Panel c');
  });

  it('jumps to the first and last tab with Home and End', async () => {
    const user = userEvent.setup();
    render(<Harness initial="b" />);
    screen.getByRole('tab', { name: 'Druga (0)' }).focus();

    await user.keyboard('{End}');
    expect(screen.getByRole('tab', { name: 'Trzecia (5)' })).toHaveFocus();
    await user.keyboard('{Home}');
    expect(screen.getByRole('tab', { name: 'Pierwsza (2)' })).toHaveFocus();
  });

  it('does not take over other keys', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    screen.getByRole('tab', { name: 'Pierwsza (2)' }).focus();

    await user.keyboard('x');

    expect(screen.getByRole('tab', { name: 'Pierwsza (2)' })).toHaveFocus();
    expect(screen.getByRole('tabpanel')).toHaveTextContent('Panel a');
  });
});
