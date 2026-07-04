// One-shot App-Icon-Generierung (C11). PNGs werden EINGECHECKT — dieses Script
// läuft nur erneut, wenn sich das Motiv ändert:  node scripts/generate-icons.mjs
import sharp from 'sharp';
import { mkdir } from 'node:fs/promises';

const disc = (size, pad) =>
  Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}">
  <rect width="${size}" height="${size}" fill="#120F0B"/>
  <circle cx="${size / 2}" cy="${size / 2}" r="${size * (0.5 - pad)}" fill="#1B1712"
    stroke="#FF5A5F" stroke-width="${Math.max(2, size * 0.015)}"/>
  <circle cx="${size / 2}" cy="${size / 2}" r="${size * 0.16}" fill="#FF5A5F"/>
  <circle cx="${size / 2}" cy="${size / 2}" r="${size * 0.05}" fill="#120F0B"/>
</svg>`);

await mkdir('public/icons', { recursive: true });
await sharp(disc(192, 0.06)).png().toFile('public/icons/icon-192.png');
await sharp(disc(512, 0.06)).png().toFile('public/icons/icon-512.png');
// maskable: größere Safe-Zone (Motiv in den inneren 80 %)
await sharp(disc(512, 0.18)).png().toFile('public/icons/icon-maskable-512.png');
await sharp(disc(180, 0.06)).png().toFile('public/icons/apple-touch-icon.png');
console.log('icons written to public/icons/');
