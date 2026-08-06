import { mkdir, writeFile } from "fs/promises";
import path from "path";
import sharp from "sharp";

const outDir = path.join(process.cwd(), "public", "icons");

async function makeIcon(size, filename, { maskable = false } = {}) {
  const padding = maskable ? Math.round(size * 0.18) : Math.round(size * 0.18);
  const inner = size - padding * 2;
  const radius = Math.round(inner * 0.22);
  const fontSize = Math.round(inner * 0.42);

  const svg = `
<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" xmlns="http://www.w3.org/2000/svg">
  <rect width="${size}" height="${size}" fill="#2f5d50"/>
  <rect x="${padding}" y="${padding}" width="${inner}" height="${inner}" rx="${radius}" fill="#f7f7f5"/>
  <text x="50%" y="54%" text-anchor="middle" font-family="Georgia, serif" font-size="${fontSize}" fill="#2f5d50" font-weight="700">D</text>
</svg>`;

  const png = await sharp(Buffer.from(svg)).png().toBuffer();
  await writeFile(path.join(outDir, filename), png);
}

await mkdir(outDir, { recursive: true });
await makeIcon(192, "icon-192.png");
await makeIcon(512, "icon-512.png");
await makeIcon(512, "icon-512-maskable.png", { maskable: true });
await makeIcon(180, "apple-touch-icon.png");
console.log("Generated PNG icons in public/icons/");
