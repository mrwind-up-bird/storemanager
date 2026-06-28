import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it, expect } from 'vitest';

const root = resolve(__dirname, '..');
const tokens = readFileSync(resolve(root, 'src/styles/tokens.css'), 'utf8');
const globals = readFileSync(resolve(root, 'src/styles/globals.css'), 'utf8');

describe('tokens.css — primitive ramps (verbatim from handoff)', () => {
  it('contains coral ramp', () => {
    expect(tokens).toContain('--coral-50:#FDF1EC');
    expect(tokens).toContain('--coral-100:#FADCD0');
    expect(tokens).toContain('--coral-200:#F5B9A3');
    expect(tokens).toContain('--coral-300:#F0917A');
    expect(tokens).toContain('--coral-400:#EC6F50');
    expect(tokens).toContain('--coral-500:#E8552E');
    expect(tokens).toContain('--coral-600:#CB4220');
    expect(tokens).toContain('--coral-700:#A2351B');
    expect(tokens).toContain('--coral-800:#7B2916');
    expect(tokens).toContain('--coral-900:#561D11');
  });
  it('contains amber ramp', () => {
    expect(tokens).toContain('--amber-50:#FEF7EA');
    expect(tokens).toContain('--amber-100:#FBEAC6');
    expect(tokens).toContain('--amber-200:#F8D78D');
    expect(tokens).toContain('--amber-300:#F5C357');
    expect(tokens).toContain('--amber-400:#F2A93B');
    expect(tokens).toContain('--amber-500:#E08E18');
    expect(tokens).toContain('--amber-600:#BB7211');
    expect(tokens).toContain('--amber-700:#93590F');
  });
  it('contains full warm neutral ramp', () => {
    expect(tokens).toContain('--n-0:#FFFFFF');
    expect(tokens).toContain('--n-50:#FAF6F1');
    expect(tokens).toContain('--n-100:#F2EBE2');
    expect(tokens).toContain('--n-150:#EAE1D5');
    expect(tokens).toContain('--n-200:#E0D5C6');
    expect(tokens).toContain('--n-300:#CDBEAB');
    expect(tokens).toContain('--n-400:#AC9C86');
    expect(tokens).toContain('--n-500:#857968');
    expect(tokens).toContain('--n-600:#665C4E');
    expect(tokens).toContain('--n-700:#4C443A');
    expect(tokens).toContain('--n-800:#332D26');
    expect(tokens).toContain('--n-850:#26211B');
    expect(tokens).toContain('--n-900:#1B1712');
    expect(tokens).toContain('--n-950:#120F0B');
  });
  it('contains semantic feedback primitives', () => {
    expect(tokens).toContain('--green-500:#2F9E68');
    expect(tokens).toContain('--green-600:#1F7E51');
    expect(tokens).toContain('--green-50:#E8F5EE');
    expect(tokens).toContain('--red-500:#DC4B3E');
    expect(tokens).toContain('--red-600:#B6362C');
    expect(tokens).toContain('--red-50:#FCEDEB');
    expect(tokens).toContain('--blue-500:#3B82C4');
    expect(tokens).toContain('--blue-600:#2C6AA3');
    expect(tokens).toContain('--blue-50:#EAF2FA');
    expect(tokens).toContain('--honey-500:#E08E18');
    expect(tokens).toContain('--honey-50:#FEF3E0');
  });
  it('contains disc base tokens', () => {
    expect(tokens).toContain('--disc-base:#15110D');
    expect(tokens).toContain('--disc-groove-a:#1d1813');
    expect(tokens).toContain('--disc-groove-b:#2a221b');
  });
  it('contains disc-label token (pinned, not accent-tracked)', () => {
    expect(tokens).toContain('--disc-label:');
  });
});

describe('tokens.css — light semantic layer', () => {
  it('has bg/surface/border/text', () => {
    expect(tokens).toContain('--bg:var(--n-50)');
    expect(tokens).toContain('--surface:var(--n-0)');
    expect(tokens).toContain('--surface-2:var(--n-50)');
    expect(tokens).toContain('--surface-3:var(--n-100)');
    expect(tokens).toContain('--border:var(--n-200)');
    expect(tokens).toContain('--border-strong:var(--n-300)');
    expect(tokens).toContain('--text:var(--n-900)');
    expect(tokens).toContain('--text-2:var(--n-600)');
    expect(tokens).toContain('--text-3:var(--n-500)');
  });
  it('has default coral accent family', () => {
    expect(tokens).toContain('--accent:var(--coral-500)');
    expect(tokens).toContain('--accent-hover:var(--coral-600)');
    expect(tokens).toContain('--accent-press:var(--coral-700)');
    expect(tokens).toContain('--accent-soft:var(--coral-50)');
    expect(tokens).toContain('--accent-soft-border:var(--coral-200)');
    expect(tokens).toContain('--accent-ink:var(--coral-700)');
    expect(tokens).toContain('--on-accent:#FFFFFF');
  });
  it('has honey, focus, and feedback tokens', () => {
    expect(tokens).toContain('--honey:var(--amber-400)');
    expect(tokens).toContain('--honey-soft:var(--amber-50)');
    expect(tokens).toContain('--honey-ink:var(--amber-700)');
    expect(tokens).toContain('--focus:var(--coral-500)');
    expect(tokens).toContain('--ok:var(--green-600)');
    expect(tokens).toContain('--ok-soft:var(--green-50)');
    expect(tokens).toContain('--warn:var(--honey-600,#BB7211)');
    expect(tokens).toContain('--warn-soft:var(--amber-50)');
    expect(tokens).toContain('--bad:var(--red-600)');
    expect(tokens).toContain('--bad-soft:var(--red-50)');
    expect(tokens).toContain('--info:var(--blue-600)');
    expect(tokens).toContain('--info-soft:var(--blue-50)');
  });
  it('has spacing scale', () => {
    expect(tokens).toContain('--s1:4px');
    expect(tokens).toContain('--s2:8px');
    expect(tokens).toContain('--s3:12px');
    expect(tokens).toContain('--s4:16px');
    expect(tokens).toContain('--s5:24px');
    expect(tokens).toContain('--s6:32px');
    expect(tokens).toContain('--s7:48px');
    expect(tokens).toContain('--s8:64px');
    expect(tokens).toContain('--tap:44px');
  });
  it('has radius scale', () => {
    expect(tokens).toContain('--r-xs:6px');
    expect(tokens).toContain('--r-sm:10px');
    expect(tokens).toContain('--r-md:14px');
    expect(tokens).toContain('--r-lg:20px');
    expect(tokens).toContain('--r-xl:28px');
    expect(tokens).toContain('--r-pill:999px');
  });
  it('has shadow tokens (verbatim)', () => {
    expect(tokens).toContain('--shadow-1:0 1px 2px rgba(40,28,16,.06),0 1px 3px rgba(40,28,16,.08)');
    expect(tokens).toContain('--shadow-2:0 4px 10px -2px rgba(40,28,16,.10),0 2px 6px -2px rgba(40,28,16,.08)');
    expect(tokens).toContain('--shadow-3:0 16px 32px -8px rgba(40,28,16,.16),0 6px 14px -6px rgba(40,28,16,.10)');
  });
  it('has motion tokens', () => {
    expect(tokens).toContain('--ease:cubic-bezier(.2,.7,.2,1)');
    expect(tokens).toContain('--dur-1:120ms');
    expect(tokens).toContain('--dur-2:220ms');
    expect(tokens).toContain('--dur-3:380ms');
  });
  it('has font var declarations', () => {
    expect(tokens).toContain("--font-display:'Bricolage Grotesque'");
    expect(tokens).toContain("--font-body:'Hanken Grotesk'");
    expect(tokens).toContain("--font-mono:'Geist Mono'");
  });
});

describe('tokens.css — dark theme overrides', () => {
  it('has [data-theme="dark"] block', () => {
    expect(tokens).toContain('[data-theme="dark"]');
  });
  it('has dark semantic bg/surface/border/text (verbatim)', () => {
    expect(tokens).toContain('--bg:var(--n-950)');
    expect(tokens).toContain('--surface:var(--n-900)');
    expect(tokens).toContain('--surface-2:var(--n-850)');
    expect(tokens).toContain('--surface-3:var(--n-800)');
    expect(tokens).toContain('--border:#352e26');
    expect(tokens).toContain('--border-strong:#4a4035');
    expect(tokens).toContain('--text-2:#c3b6a4');
    expect(tokens).toContain('--text-3:#9b8f7d');
  });
  it('has dark coral accent defaults (verbatim)', () => {
    expect(tokens).toContain('--accent:#F2734C');
    expect(tokens).toContain('--accent-hover:#F58A68');
    expect(tokens).toContain('--accent-press:#F7A085');
    expect(tokens).toContain('--accent-soft:#3a221880');
    expect(tokens).toContain('--accent-soft-border:#6e3a26');
    expect(tokens).toContain('--accent-ink:#F9B49C');
    expect(tokens).toContain('--on-accent:#2a0f06');
  });
  it('has dark honey/focus/feedback (verbatim)', () => {
    expect(tokens).toContain('--honey:#F5C357');
    expect(tokens).toContain('--honey-soft:#3a2e1580');
    expect(tokens).toContain('--honey-ink:#F8D78D');
    expect(tokens).toContain('--focus:#F58A68');
    expect(tokens).toContain('--ok:#4FC489');
    expect(tokens).toContain('--ok-soft:#16352580');
    expect(tokens).toContain('--warn:#F2A93B');
    expect(tokens).toContain('--warn-soft:#3a2e1580');
    expect(tokens).toContain('--bad:#F0786C');
    expect(tokens).toContain('--bad-soft:#3a1c1880');
    expect(tokens).toContain('--info:#6BA7DC');
    expect(tokens).toContain('--info-soft:#16283a80');
  });
  it('has dark disc tokens (verbatim)', () => {
    expect(tokens).toContain('--disc-base:#0a0805');
    expect(tokens).toContain('--disc-groove-a:#16110c');
    expect(tokens).toContain('--disc-groove-b:#231b14');
  });
  it('has dark shadow tokens (verbatim)', () => {
    expect(tokens).toContain('--shadow-1:0 1px 2px rgba(0,0,0,.4)');
    expect(tokens).toContain('--shadow-2:0 6px 16px -4px rgba(0,0,0,.5)');
    expect(tokens).toContain('--shadow-3:0 20px 40px -10px rgba(0,0,0,.6)');
  });
});

describe('tokens.css — accent families (authored; coral/indigo/forest × light/dark)', () => {
  it('has [data-accent="coral"] block', () => {
    expect(tokens).toContain('[data-accent="coral"]');
  });
  it('has [data-accent="indigo"] block with full 7-token family', () => {
    expect(tokens).toContain('[data-accent="indigo"]');
    const idx = tokens.indexOf('[data-accent="indigo"]');
    const block = tokens.slice(idx, idx + 600);
    expect(block).toContain('--accent:');
    expect(block).toContain('--accent-hover:');
    expect(block).toContain('--accent-press:');
    expect(block).toContain('--accent-soft:');
    expect(block).toContain('--accent-soft-border:');
    expect(block).toContain('--accent-ink:');
    expect(block).toContain('--on-accent:');
    expect(block).toContain('--focus:');
  });
  it('has [data-accent="forest"] block with full 7-token family', () => {
    expect(tokens).toContain('[data-accent="forest"]');
    const idx = tokens.indexOf('[data-accent="forest"]');
    const block = tokens.slice(idx, idx + 600);
    expect(block).toContain('--accent:');
    expect(block).toContain('--accent-soft:');
    expect(block).toContain('--on-accent:');
  });
  it('has dark variant combinators for each accent', () => {
    expect(tokens).toContain('[data-theme="dark"][data-accent="coral"]');
    expect(tokens).toContain('[data-theme="dark"][data-accent="indigo"]');
    expect(tokens).toContain('[data-theme="dark"][data-accent="forest"]');
  });
});

describe('globals.css structure', () => {
  it('imports tailwindcss v4', () => {
    expect(globals).toContain('@import "tailwindcss"');
  });
  it('imports tokens', () => {
    expect(globals).toContain('@import "./tokens.css"');
  });
  it('has @theme block', () => {
    expect(globals).toContain('@theme {');
  });
  it('has focus-ring-button utility with :focus-visible', () => {
    expect(globals).toContain('focus-ring-button');
    expect(globals).toContain(':focus-visible');
    expect(globals).toContain('outline: 3px solid var(--focus)');
    expect(globals).toContain('outline-offset: 2px');
  });
  it('has focus-ring-field utility', () => {
    expect(globals).toContain('focus-ring-field');
    expect(globals).toContain('border-color: var(--accent)');
    expect(globals).toContain('box-shadow: 0 0 0 3px var(--accent-soft)');
  });
  it('has prefers-reduced-motion block (verbatim from handoff)', () => {
    expect(globals).toContain('prefers-reduced-motion:reduce');
    expect(globals).toContain('animation-duration:.001ms!important');
    expect(globals).toContain('transition-duration:.001ms!important');
  });
});
