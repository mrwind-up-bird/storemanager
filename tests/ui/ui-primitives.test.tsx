// tests/ui/ui-primitives.test.tsx
// @vitest-environment jsdom

/// <reference types="@testing-library/jest-dom/vitest" />

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { StatusBadge } from '@/components/ui/StatusBadge';
import { ConditionPill } from '@/components/ui/ConditionPill';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { Textarea } from '@/components/ui/Textarea';
import { Sheet } from '@/components/ui/Sheet';
import { Modal } from '@/components/ui/Modal';
import { VinylDisc } from '@/components/ui/VinylDisc';
import { Toggle } from '@/components/ui/Toggle';
import { Checkbox } from '@/components/ui/Checkbox';
import { SegmentedControl } from '@/components/ui/SegmentedControl';

afterEach(cleanup);

// ── StatusBadge ────────────────────────────────────────────────────────────────

describe('StatusBadge', () => {
  it.each([
    ['verfuegbar', 'im Lager'],
    ['reserviert', 'Reserviert'],
    ['verkauft',   'Verkauft'],
    ['verliehen',  'Verliehen'],
  ] as const)('status=%s renders text label "%s"', (status, label) => {
    render(<StatusBadge status={status} />);
    expect(screen.getByText(label)).toBeInTheDocument();
  });

  it('renders an aria-hidden dot element beside the label', () => {
    const { container } = render(<StatusBadge status="verfuegbar" />);
    expect(container.querySelector('[aria-hidden="true"]')).toBeInTheDocument();
  });

  it('is never color-only: text label is always visible', () => {
    render(<StatusBadge status="verkauft" />);
    expect(screen.getByText('Verkauft')).toBeVisible();
  });
});

// ── ConditionPill ──────────────────────────────────────────────────────────────

describe('ConditionPill', () => {
  // jsdom normalizes hex colors to rgb() when reading el.style properties.
  // Expected rgb values are the direct jsdom-normalized form of the verbatim
  // hex stops from Design System 2026.dc.html (Zustand · Discogs-Skala section).
  it.each([
    [7, 'Mint', 'rgb(31, 138, 82)',  'rgb(255, 255, 255)'],
    [6, 'NM',   'rgb(47, 158, 104)', 'rgb(255, 255, 255)'],
    [5, 'VG+',  'rgb(155, 195, 74)', 'rgb(58, 36, 0)'],
    [4, 'VG',   'rgb(226, 192, 68)', 'rgb(58, 36, 0)'],
    [3, 'G+',   'rgb(239, 171, 59)', 'rgb(58, 36, 0)'],
    [2, 'G',    'rgb(224, 118, 46)', 'rgb(255, 255, 255)'],
    [1, 'Fair', 'rgb(214, 85, 50)',  'rgb(255, 255, 255)'],
    [0, 'Poor', 'rgb(182, 54, 44)',  'rgb(255, 255, 255)'],
  ] as const)('condition=%i → label "%s", bg %s, color %s', (condition, label, bg, fg) => {
    const { container } = render(<ConditionPill condition={condition} />);
    expect(screen.getByText(label)).toBeInTheDocument();
    const el = container.firstChild as HTMLElement;
    expect(el.style.background).toBe(bg);
    expect(el.style.color).toBe(fg);
  });

  it('is never color-only: text label always present', () => {
    render(<ConditionPill condition={5} />);
    expect(screen.getByText('VG+')).toBeVisible();
  });
});

// ── Button ─────────────────────────────────────────────────────────────────────

describe('Button', () => {
  it('renders a real <button type="button">', () => {
    render(<Button>Save</Button>);
    const btn = screen.getByRole('button', { name: /save/i });
    expect(btn.tagName).toBe('BUTTON');
    expect(btn).toHaveAttribute('type', 'button');
  });

  it('loading state: aria-busy=true and animated spinner present', () => {
    const { container } = render(<Button loading>Saving</Button>);
    const btn = container.querySelector('button') as HTMLButtonElement;
    expect(btn).toHaveAttribute('aria-busy', 'true');
    const spinner = btn.querySelector('[aria-hidden="true"]') as HTMLElement;
    expect(spinner).toBeInTheDocument();
    expect(spinner.style.animation).toMatch(/spin/);
  });

  it('disabled state: button has disabled attribute', () => {
    render(<Button disabled>Save</Button>);
    expect(screen.getByRole('button')).toBeDisabled();
  });

  it.each(['primary', 'secondary', 'ghost', 'danger', 'honey'] as const)(
    'variant=%s renders without error',
    (variant) => {
      render(<Button variant={variant}>Label</Button>);
      expect(screen.getByRole('button')).toBeInTheDocument();
    }
  );

  it.each(['sm36', 'md44', 'lg52'] as const)('size=%s renders without error', (size) => {
    render(<Button size={size}>Label</Button>);
    expect(screen.getByRole('button')).toBeInTheDocument();
  });
});

// ── Input / Select / Textarea ──────────────────────────────────────────────────

describe('Input', () => {
  it('renders an <input>', () => {
    render(<Input placeholder="Search" />);
    expect(screen.getByPlaceholderText('Search')).toBeInTheDocument();
  });

  it('error prop sets aria-invalid="true"', () => {
    render(<Input aria-label="Field" error />);
    const input = screen.getByRole('textbox');
    expect(input).toHaveAttribute('aria-invalid', 'true');
  });

  it('no error prop: aria-invalid absent', () => {
    render(<Input aria-label="Field" />);
    const input = screen.getByRole('textbox');
    expect(input).not.toHaveAttribute('aria-invalid');
  });
});

describe('Select', () => {
  const opts = [{ value: 'a', label: 'Alpha' }, { value: 'b', label: 'Beta' }];
  it('renders a <select> with all options', () => {
    render(<Select options={opts} value="a" onChange={vi.fn()} aria-label="Pick" />);
    expect(screen.getByRole('combobox')).toBeInTheDocument();
    expect(screen.getByText('Alpha')).toBeInTheDocument();
    expect(screen.getByText('Beta')).toBeInTheDocument();
  });
});

describe('Textarea', () => {
  it('renders a <textarea>', () => {
    render(<Textarea placeholder="Notes" />);
    expect(screen.getByPlaceholderText('Notes')).toBeInTheDocument();
  });
});

// ── Sheet ──────────────────────────────────────────────────────────────────────

describe('Sheet', () => {
  it('when closed: no dialog in DOM', () => {
    render(
      <Sheet open={false} onClose={vi.fn()} title="Side Panel">
        <button>OK</button>
      </Sheet>
    );
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('when open: role=dialog and aria-modal=true', () => {
    render(
      <Sheet open={true} onClose={vi.fn()} title="Side Panel">
        <button>OK</button>
      </Sheet>
    );
    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveAttribute('aria-modal', 'true');
  });

  it('ESC key calls onClose', async () => {
    const onClose = vi.fn();
    const user = userEvent.setup();
    render(
      <Sheet open={true} onClose={onClose} title="Side Panel">
        <button>Action</button>
      </Sheet>
    );
    await user.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('focuses first focusable element on open', async () => {
    render(
      <Sheet open={true} onClose={vi.fn()} title="Side Panel">
        <button data-testid="first">First</button>
      </Sheet>
    );
    await waitFor(() => {
      expect(document.activeElement).not.toBe(document.body);
    });
  });

  it('Tab key traps focus inside the dialog (wraps last → first)', async () => {
    const user = userEvent.setup();
    render(
      <Sheet open={true} onClose={vi.fn()} title="Side Panel">
        <button>Alpha</button>
        <button>Beta</button>
      </Sheet>
    );
    await waitFor(() => expect(document.activeElement).not.toBe(document.body));
    const initialFocus = document.activeElement;
    // Tab through all focusable until we cycle back
    let attempts = 0;
    do {
      await user.tab();
      attempts++;
    } while (document.activeElement !== initialFocus && attempts < 10);
    expect(attempts).toBeLessThan(10);
  });
});

// ── Modal ──────────────────────────────────────────────────────────────────────

describe('Modal', () => {
  it('when open: role=dialog + aria-modal=true in portal', () => {
    render(
      <Modal open={true} onClose={vi.fn()} title="Confirm">
        <button>Yes</button>
      </Modal>
    );
    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(screen.getByText('Confirm')).toBeInTheDocument();
  });

  it('when closed: no dialog', () => {
    render(
      <Modal open={false} onClose={vi.fn()} title="Confirm">
        <p>Content</p>
      </Modal>
    );
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('ESC calls onClose', async () => {
    const onClose = vi.fn();
    const user = userEvent.setup();
    render(
      <Modal open={true} onClose={onClose} title="Confirm">
        <button>Yes</button>
      </Modal>
    );
    await user.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledOnce();
  });
});

// ── VinylDisc ──────────────────────────────────────────────────────────────────

describe('VinylDisc', () => {
  it('is aria-hidden (always decorative)', () => {
    const { container } = render(<VinylDisc />);
    expect(container.firstChild as HTMLElement).toHaveAttribute('aria-hidden', 'true');
  });

  it('background uses --disc-label NOT --accent', () => {
    const { container } = render(<VinylDisc />);
    // jsdom rejects background shorthand with CSS custom properties; VinylDisc
    // uses backgroundImage so CSS vars survive the jsdom CSS parser.
    const bg = (container.firstChild as HTMLElement).style.backgroundImage;
    expect(bg).toContain('--disc-label');
    expect(bg).not.toContain('var(--accent)');
  });

  it('display variant includes specular highlight rgba layer', () => {
    const { container } = render(<VinylDisc variant="display" size={300} />);
    const bg = (container.firstChild as HTMLElement).style.backgroundImage;
    expect(bg).toContain('rgba(255,255,255,.14)');
  });

  it('spinning prop adds animation style referencing spin keyframe', () => {
    const { container } = render(<VinylDisc spinning />);
    expect((container.firstChild as HTMLElement).style.animation).toMatch(/spin/);
  });
});

// ── Toggle ─────────────────────────────────────────────────────────────────────

describe('Toggle', () => {
  it('renders role=switch with aria-checked reflecting state', () => {
    render(<Toggle checked={true} onChange={vi.fn()} label="On" />);
    expect(screen.getByRole('switch')).toHaveAttribute('aria-checked', 'true');
  });

  it('calls onChange with toggled value on click', async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<Toggle checked={false} onChange={onChange} label="Enable" />);
    await user.click(screen.getByRole('switch'));
    expect(onChange).toHaveBeenCalledWith(true);
  });

  it('label wrapper carries focus-ring-within class (keyboard focus guard)', () => {
    const { container } = render(<Toggle checked={false} onChange={vi.fn()} label="Enable" />);
    const label = container.querySelector('label');
    expect(label).toHaveClass('focus-ring-within');
  });
});

// ── Checkbox ───────────────────────────────────────────────────────────────────

describe('Checkbox', () => {
  it('renders a checkbox', () => {
    render(<Checkbox checked={false} onChange={vi.fn()} label="Accept" />);
    expect(screen.getByRole('checkbox')).toBeInTheDocument();
  });

  it('calls onChange on click', async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<Checkbox checked={false} onChange={onChange} label="Accept" />);
    await user.click(screen.getByRole('checkbox'));
    expect(onChange).toHaveBeenCalledWith(true);
  });

  it('label wrapper carries focus-ring-within class (keyboard focus guard)', () => {
    const { container } = render(<Checkbox checked={false} onChange={vi.fn()} label="Accept" />);
    const label = container.querySelector('label');
    expect(label).toHaveClass('focus-ring-within');
  });
});

// ── SegmentedControl ───────────────────────────────────────────────────────────

describe('SegmentedControl', () => {
  const opts = [{ value: 'list', label: 'Liste' }, { value: 'grid', label: 'Kacheln' }];

  it('renders a radiogroup with one radio per option', () => {
    render(<SegmentedControl options={opts} value="list" onChange={vi.fn()} aria-label="View" />);
    expect(screen.getByRole('radiogroup')).toBeInTheDocument();
    expect(screen.getAllByRole('radio')).toHaveLength(2);
  });

  it('the radio matching value is checked', () => {
    render(<SegmentedControl options={opts} value="grid" onChange={vi.fn()} aria-label="View" />);
    expect(screen.getByRole('radio', { name: 'Kacheln' })).toBeChecked();
  });

  it('every option label carries focus-ring-within class (keyboard focus guard)', () => {
    const { container } = render(<SegmentedControl options={opts} value="list" onChange={vi.fn()} aria-label="View" />);
    const labels = container.querySelectorAll('label');
    expect(labels.length).toBe(2);
    labels.forEach((label) => expect(label).toHaveClass('focus-ring-within'));
  });
});
