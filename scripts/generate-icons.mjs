import { mkdir, access } from "fs/promises";
import path from "path";
import sharp from "sharp";

const ASSISTANTS = [
  {
    key: "dina",
    src: path.join(process.cwd(), "public", "dina-avatar.jpg"),
    outDir: path.join(process.cwd(), "public", "icons"),
  },
  {
    key: "nora",
    src: path.join(process.cwd(), "public", "assistants", "nora-avatar.png"),
    outDir: path.join(process.cwd(), "public", "icons", "nora"),
  },
  {
    key: "mac",
    src: path.join(process.cwd(), "public", "assistants", "mac-avatar.png"),
    outDir: path.join(process.cwd(), "public", "icons", "mac"),
  },
  {
    key: "penny",
    src: path.join(process.cwd(), "public", "assistants", "penny-avatar.png"),
    outDir: path.join(process.cwd(), "public", "icons", "penny"),
  },
  {
    key: "addie",
    src: path.join(process.cwd(), "public", "assistants", "addie-avatar.png"),
    outDir: path.join(process.cwd(), "public", "icons", "addie"),
  },
  {
    key: "nate",
    src: path.join(process.cwd(), "public", "assistants", "nate-avatar.png"),
    outDir: path.join(process.cwd(), "public", "icons", "nate"),
  },
];

async function exists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function makeIcon(avatarPath, outDir, size, filename, { maskable = false } = {}) {
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

async function makeFavicon(avatarPath) {
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

for (const assistant of ASSISTANTS) {
  if (!(await exists(assistant.src))) {
    console.error(`Missing ${assistant.src} — add the portrait before generating icons.`);
    process.exit(1);
  }

  await mkdir(assistant.outDir, { recursive: true });
  await makeIcon(assistant.src, assistant.outDir, 192, "icon-192.png");
  await makeIcon(assistant.src, assistant.outDir, 512, "icon-512.png");
  await makeIcon(assistant.src, assistant.outDir, 512, "icon-512-maskable.png", {
    maskable: true,
  });
  await makeIcon(assistant.src, assistant.outDir, 180, "apple-touch-icon.png");

  if (assistant.key === "dina") {
    await makeFavicon(assistant.src);
  }

  console.log(`Generated ${assistant.key} icons in ${path.relative(process.cwd(), assistant.outDir)}`);
}
