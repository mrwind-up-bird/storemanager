//
// Gradient values verbatim from design handoff (with --disc-label replacing --accent for label ring):
//   logo    — Q-Records App.dc.html line 56   (sidebar aside disc, 36px)
//   card    — Q-Records App.dc.html line 192  (record card peeking disc)
//   display — Design System 2026.dc.html line 154 (hero disc, 300px, with highlight + spin)
//
// The label-ring color is var(--disc-label), NOT var(--accent).
// --disc-label is defined in tokens.css as var(--coral-500) — pinned brand element.

export type VinylDiscVariant = 'logo' | 'card' | 'display';

export interface VinylDiscProps {
  size?:     number;
  variant?:  VinylDiscVariant;
  spinning?: boolean;
  className?: string;
}

// Returns the gradient layers (without the base fill — that goes in backgroundColor)
// Using backgroundImage + backgroundColor split so jsdom can read CSS custom properties.
// Browsers see the same visual result; `background` shorthand ≡ `backgroundImage+backgroundColor`.
function gradientLayers(variant: VinylDiscVariant): string {
  switch (variant) {
    case 'logo':
      // 3 image layers · spindle #0a0a0a · label ring 7.5%–34% · groove 1.2 px / 2.6 px
      // Source: Q-Records App.dc.html line 56 (--accent replaced with --disc-label)
      return [
        'radial-gradient(circle at 50% 50%,#0a0a0a 0 7%,#0000 7.5%)',
        'radial-gradient(circle at 50% 50%,var(--disc-label) 7.5% 34%,#0000 34.5%)',
        'repeating-radial-gradient(circle at 50% 50%,var(--disc-groove-a) 0 1.2px,var(--disc-groove-b) 1.2px 2.6px)',
      ].join(',');

    case 'card':
      // 3 image layers · hole = var(--surface) · label ring 5.4%–30% · groove 1.5 px / 3.4 px
      // Source: Q-Records App.dc.html line 192 (--disc-label for label ring)
      return [
        'radial-gradient(circle at 50% 50%,var(--surface) 0 5%,#0000 5.4%)',
        'radial-gradient(circle at 50% 50%,var(--disc-label) 5.4% 30%,#0000 30.4%)',
        'repeating-radial-gradient(circle at 50% 50%,var(--disc-groove-a) 0 1.5px,var(--disc-groove-b) 1.5px 3.4px)',
      ].join(',');

    case 'display':
      // 5 image layers · hole = var(--bg) · dark spindle · label ring 5.4%–27% · specular highlight · groove 1.7 px / 3.8 px
      // Source: Design System 2026.dc.html line 154 (--disc-label for label ring)
      return [
        'radial-gradient(circle at 50% 50%,var(--bg) 0 4.5%,#0000 5%)',
        'radial-gradient(circle at 50% 50%,#0a0a0a 0 5%,#0000 5.4%)',
        'radial-gradient(circle at 50% 50%,var(--disc-label) 5.4% 27%,#0000 27.4%)',
        'radial-gradient(circle at 38% 34%,rgba(255,255,255,.14),#0000 60%)',
        'repeating-radial-gradient(circle at 50% 50%,var(--disc-groove-a) 0 1.7px,var(--disc-groove-b) 1.7px 3.8px)',
      ].join(',');
  }
}

export function VinylDisc({ size = 36, variant = 'logo', spinning = false, className }: VinylDiscProps) {
  return (
    <div
      aria-hidden="true"
      className={className}
      style={{
        width: size,
        height: size,
        borderRadius: '50%',
        flexShrink: 0,
        // Split background shorthand into backgroundImage + backgroundColor so that
        // CSS custom properties survive jsdom's CSS parser (jsdom rejects background
        // shorthand values containing var()). Visual output is identical in browsers.
        backgroundImage: gradientLayers(variant),
        backgroundColor: 'var(--disc-base)',
        boxShadow: variant !== 'logo' ? 'var(--shadow-2)' : undefined,
        // spin 9s matches Design System 2026.dc.html hero disc animation
        // tokens.css @media(prefers-reduced-motion) collapses dur to .001ms
        animation: spinning ? 'spin 9s linear infinite' : undefined,
      }}
    />
  );
}
