import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

// SVGs are the editable sources. Derive delivery formats without a font or a new dependency.
const file = (path) => fileURLToPath(new URL(path, import.meta.url));
const logo = await readFile(file("../public/brand/linkfav-logo.svg"), "utf8");
const symbol = await readFile(file("../public/brand/linkfav-symbol.svg"), "utf8");
const reverse = logo.replaceAll("#1d1d28", "#ffffff");
await writeFile(file("../public/brand/linkfav-logo-white.svg"), reverse);
await sharp(Buffer.from(logo)).resize(1758, 432).png().toFile(file("../public/brand/linkfav-logo.png"));
await sharp(Buffer.from(symbol)).resize(544, 512).png().toFile(file("../public/brand/linkfav-symbol.png"));

const artwork = symbol.slice(symbol.indexOf("</title>") + 8, symbol.lastIndexOf("</svg>"));
const icon = `<svg xmlns="http://www.w3.org/2000/svg" width="80" height="80" viewBox="0 0 80 80"><title>Linkfav</title><rect width="80" height="80" rx="18" fill="#f2f2fd"/><g transform="translate(6 8)">${artwork}</g></svg>\n`;
await writeFile(file("../src/app/icon.svg"), icon);
await sharp(Buffer.from(icon)).resize(180, 180).png().toFile(file("../src/app/apple-icon.png"));
for (const size of [192, 512]) {
  await sharp(Buffer.from(icon)).resize(size, size).png().toFile(file(`../public/brand/linkfav-icon-${size}.png`));
}

// ICO directory with PNG-encoded frames, supported by modern browsers and Windows.
const sizes = [16, 32, 48];
const frames = await Promise.all(sizes.map((size) => sharp(Buffer.from(icon)).resize(size, size).png().toBuffer()));
const directory = Buffer.alloc(6 + sizes.length * 16);
directory.writeUInt16LE(1, 2);
directory.writeUInt16LE(sizes.length, 4);
let offset = directory.length;
for (const [index, frame] of frames.entries()) {
  const entry = 6 + index * 16;
  directory[entry] = sizes[index];
  directory[entry + 1] = sizes[index];
  directory.writeUInt16LE(1, entry + 4);
  directory.writeUInt16LE(32, entry + 6);
  directory.writeUInt32LE(frame.length, entry + 8);
  directory.writeUInt32LE(offset, entry + 12);
  offset += frame.length;
}
await writeFile(file("../src/app/favicon.ico"), Buffer.concat([directory, ...frames]));
console.log("Brand assets generated from the source SVGs.");
