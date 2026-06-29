// src/components/theme/AccentSwitch.tsx
'use client';

import { useTheme, type Accent } from './ThemeProvider';

const ACCENT_OPTIONS: Array<{ value: Accent; label: string; hex: string }> = [
  { value: 'coral',  label: 'Coral',  hex: '#E8552E' },
  { value: 'indigo', label: 'Indigo', hex: '#5B4FCF' },
  { value: 'forest', label: 'Forest', hex: '#2F6F4E' },
];

export function AccentSwitch() {
  const { accent, setAccent } = useTheme();

  return (
    <div
      role="radiogroup"
      aria-label="Akzentfarbe wählen"
      style={{ display: 'flex', gap: '6px', alignItems: 'center' }}
    >
      {ACCENT_OPTIONS.map((opt) => {
        const isActive = accent === opt.value;
        return (
          <button
            key={opt.value}
            type="button"
            role="radio"
            aria-checked={isActive}
            aria-label={opt.label}
            onClick={() => setAccent(opt.value)}
            className="focus-ring-button"
            style={{
              width: '22px',
              height: '22px',
              borderRadius: '50%',
              background: opt.hex,
              border: isActive ? `2px solid var(--border-strong)` : '2px solid transparent',
              // Active indicator via box-shadow, NOT outline — inline `outline:none`
              // would clobber the browser's :focus-visible ring on inactive swatches
              // (focus-ring-button restores it for keyboard users).
              boxShadow: isActive ? `0 0 0 2px var(--surface), 0 0 0 4px ${opt.hex}` : 'none',
              cursor: 'pointer',
              padding: 0,
              transition: 'box-shadow var(--dur-1) var(--ease)',
            }}
          />
        );
      })}
    </div>
  );
}
