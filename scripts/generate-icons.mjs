import { mkdir, access } from "fs/promises";
import path from "path";
import sharp from "sharp";

const outDir = path.join(process.cwd(), "public", "icons");
const avatarPath = path.join(process.cwd(), "public", "dina-avatar.jpg");

async function exists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function makeIcon(size, filename, { maskable = false } = {}) {
  const content = Math.round(size * (maskable ? 0.72 : 0.92));
  const offset = Math.round((size - content) / 2);
  const radius = content / 2;

  // Circular avatar on warm app background.
  const circleSvg = Buffer.from(`
<svg width="${content}" height="${content}" xmlns="http://www.w3.org/2000/svg">
  <circle cx="${radius}" cy="${radius}" r="${radius}" fill="#fff"/>
</svg>`);

  const avatar = await sharp(avatarPath)
    .resize(content, content, { fit: "cover", position: "centre" })
    .composite([{ input: circleSvg, blend: "dest-in" }])
    .png()
    .toBuffer();

  await sharp({
    create: {
      width: size,
      height: size,
      channels: 4,
      background: { r: 247, g: 247, b: 245, alpha: 1 },
    },
  })
    .composite([{ input: avatar, left: offset, top: offset }])
    .png()
    .toFile(path.join(outDir, filename));
}

async function makeFavicon() {
  const size = 256;
  const content = Math.round(size * 0.92);
  const offset = Math.round((size - content) / 2);
  const radius = content / 2;
  const circleSvg = Buffer.from(`
<svg width="${content}" height="${content}" xmlns="http://www.w3.org/2000/svg">
  <circle cx="${radius}" cy="${radius}" r="${radius}" fill="#fff"/>
</svg>`);

  const avatar = await sharp(avatarPath)
    .resize(content, content, { fit: "cover", position: "centre" })
    .composite([{ input: circleSvg, blend: "dest-in" }])
    .png()
    .toBuffer();

  const png = await sharp({
    create: {
      width: size,
      height: size,
      channels: 4,
      background: { r: 247, g: 247, b: 245, alpha: 1 },
    },
  })
    .composite([{ input: avatar, left: offset, top: offset }])
    .png()
    .toBuffer();

  await sharp(png)
    .resize(32, 32)
    .toFile(path.join(process.cwd(), "app", "favicon.ico"));
}

if (!(await exists(avatarPath))) {
  console.error("Missing public/dina-avatar.jpg — add Dina's portrait before generating icons.");
  process.exit(1);
}

await mkdir(outDir, { recursive: true });
await makeIcon(192, "icon-192.png");
await makeIcon(512, "icon-512.png");
await makeIcon(512, "icon-512-maskable.png", { maskable: true });
await makeIcon(180, "apple-touch-icon.png");
await makeFavicon();
console.log("Generated Dina portrait icons in public/icons/ and app/favicon.ico");
