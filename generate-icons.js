/**
 * Generate PWA PNG icons from SVG using built-in Node.
 * Run: node generate-icons.js
 * 
 * Alternative: If sharp won't install on your machine, run this on the VPS:
 *   npm install sharp && node generate-icons.js
 * 
 * Or use any online SVG-to-PNG converter with the SVG below at 192x192 and 512x512.
 */
const fs = require('fs');
const path = require('path');

const iconSvg = `<svg width="512" height="512" viewBox="0 0 512 512" xmlns="http://www.w3.org/2000/svg">
  <rect width="512" height="512" rx="96" fill="#1a1a1a"/>
  <g transform="translate(96, 96) scale(10)">
    <rect x="4" y="6" width="24" height="20" rx="6" fill="#333"/>
    <line x1="16" y1="6" x2="16" y2="2" stroke="#444" stroke-width="2" stroke-linecap="round"/>
    <circle cx="16" cy="1.5" r="1.5" fill="#555"/>
    <circle cx="11" cy="15" r="2.5" fill="#e0e0e0"/>
    <circle cx="21" cy="15" r="2.5" fill="#e0e0e0"/>
    <circle cx="11.5" cy="15" r="1" fill="#1a1a1a"/>
    <circle cx="21.5" cy="15" r="1" fill="#1a1a1a"/>
    <path d="M11 21 Q16 24 21 21" stroke="#e0e0e0" stroke-width="1.5" stroke-linecap="round" fill="none"/>
    <rect x="1" y="13" width="3" height="6" rx="1.5" fill="#444"/>
    <rect x="28" y="13" width="3" height="6" rx="1.5" fill="#444"/>
  </g>
</svg>`;

async function generate() {
  try {
    const sharp = require('sharp');
    const buffer = Buffer.from(iconSvg);
    await sharp(buffer).resize(192, 192).png().toFile(path.join(__dirname, 'public', 'icon-192.png'));
    console.log('Created icon-192.png');
    await sharp(buffer).resize(512, 512).png().toFile(path.join(__dirname, 'public', 'icon-512.png'));
    console.log('Created icon-512.png');
    console.log('Done!');
  } catch (e) {
    console.log('sharp not available. Saving SVG icons as fallback...');
    // Save the SVG as icon files (browsers that support SVG icons will use them)
    const svg192 = iconSvg.replace('width="512" height="512"', 'width="192" height="192"');
    fs.writeFileSync(path.join(__dirname, 'public', 'icon-192.svg'), svg192);
    fs.writeFileSync(path.join(__dirname, 'public', 'icon-512.svg'), iconSvg);
    console.log('Saved SVG fallback icons. For PNG, install sharp on your VPS and re-run:');
    console.log('  npm install sharp && node generate-icons.js');
  }
}

generate();
