import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import zlib from "node:zlib";

const pngSignature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

const sheets = [
  {
    memberId: "marubayashi-yuto",
    source: "public/assets/members/source/marubayashi-yuto-sheet.png",
    poses: [
      "seated-laptop",
      "seated-back-laptop",
      "floor-laptop",
      "drink",
      "standing-laptop",
      "walking",
      "active",
      "standing"
    ]
  },
  {
    memberId: "taniguchi-kyoshiro",
    source: "public/assets/members/source/taniguchi-kyoshiro-sheet.png",
    poses: [
      "standing",
      "greeting",
      "meeting",
      "presenting",
      "active",
      "away",
      "walking",
      "seated"
    ]
  },
  {
    memberId: "miyabe-keishi",
    source: "public/assets/members/source/miyabe-keishi-sheet.png",
    poses: [
      "standing",
      "greeting",
      "meeting",
      "presenting",
      "active",
      "away",
      "walking",
      "seated"
    ]
  },
  {
    memberId: "kashima-sakuto",
    source: "public/assets/members/source/kashima-sakuto-sheet.png",
    poses: [
      "standing",
      "greeting",
      "meeting",
      "drink",
      "floor-laptop",
      "walking",
      "active",
      "away"
    ]
  },
  {
    memberId: "kajita-koki",
    source: "public/assets/members/source/kajita-koki-sheet.png",
    poses: [
      "standing",
      "greeting",
      "meeting",
      "walking-folder",
      "active",
      "floor-laptop",
      "drink",
      "away"
    ]
  },
  {
    memberId: "hachiro-motoki",
    source: "public/assets/members/source/hachiro-motoki-sheet.png",
    poses: [
      "active",
      "meeting",
      "seated",
      "floor-tablet",
      "standing",
      "greeting",
      "walking-laptop",
      "away"
    ]
  }
];

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let i = 0; i < 8; i += 1) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data = Buffer.alloc(0)) {
  const typeBuffer = Buffer.from(type);
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])), 0);
  return Buffer.concat([length, typeBuffer, data, crc]);
}

function paeth(left, up, upLeft) {
  const p = left + up - upLeft;
  const pa = Math.abs(p - left);
  const pb = Math.abs(p - up);
  const pc = Math.abs(p - upLeft);
  if (pa <= pb && pa <= pc) return left;
  if (pb <= pc) return up;
  return upLeft;
}

function readPng(buffer) {
  if (!buffer.subarray(0, 8).equals(pngSignature)) {
    throw new Error("Not a PNG file");
  }

  let offset = 8;
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = 0;
  let palette = null;
  let transparency = null;
  const idat = [];

  while (offset < buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.subarray(offset + 4, offset + 8).toString("ascii");
    const data = buffer.subarray(offset + 8, offset + 8 + length);
    offset += 12 + length;

    if (type === "IHDR") {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data[8];
      colorType = data[9];
      if (data[12] !== 0) {
        throw new Error("Interlaced PNG is not supported");
      }
    } else if (type === "PLTE") {
      palette = data;
    } else if (type === "tRNS") {
      transparency = data;
    } else if (type === "IDAT") {
      idat.push(data);
    } else if (type === "IEND") {
      break;
    }
  }

  if (bitDepth !== 8) {
    throw new Error(`Unsupported bit depth: ${bitDepth}`);
  }

  const channels = {
    0: 1,
    2: 3,
    3: 1,
    4: 2,
    6: 4
  }[colorType];

  if (!channels) {
    throw new Error(`Unsupported color type: ${colorType}`);
  }

  const inflated = zlib.inflateSync(Buffer.concat(idat));
  const rowBytes = width * channels;
  const raw = Buffer.alloc(width * height * channels);
  let inputOffset = 0;

  for (let y = 0; y < height; y += 1) {
    const filter = inflated[inputOffset];
    inputOffset += 1;
    const rowStart = y * rowBytes;
    const previousRowStart = rowStart - rowBytes;

    for (let x = 0; x < rowBytes; x += 1) {
      const value = inflated[inputOffset + x];
      const left = x >= channels ? raw[rowStart + x - channels] : 0;
      const up = y > 0 ? raw[previousRowStart + x] : 0;
      const upLeft = y > 0 && x >= channels ? raw[previousRowStart + x - channels] : 0;

      raw[rowStart + x] = {
        0: value,
        1: value + left,
        2: value + up,
        3: value + Math.floor((left + up) / 2),
        4: value + paeth(left, up, upLeft)
      }[filter] & 0xff;
    }
    inputOffset += rowBytes;
  }

  const rgba = Buffer.alloc(width * height * 4);
  for (let i = 0; i < width * height; i += 1) {
    const input = i * channels;
    const output = i * 4;

    if (colorType === 3) {
      const index = raw[input];
      rgba[output] = palette[index * 3] || 0;
      rgba[output + 1] = palette[index * 3 + 1] || 0;
      rgba[output + 2] = palette[index * 3 + 2] || 0;
      rgba[output + 3] = transparency?.[index] ?? 255;
    } else if (colorType === 6) {
      rgba[output] = raw[input];
      rgba[output + 1] = raw[input + 1];
      rgba[output + 2] = raw[input + 2];
      rgba[output + 3] = raw[input + 3];
    } else if (colorType === 2) {
      rgba[output] = raw[input];
      rgba[output + 1] = raw[input + 1];
      rgba[output + 2] = raw[input + 2];
      rgba[output + 3] = 255;
    } else if (colorType === 4) {
      rgba[output] = raw[input];
      rgba[output + 1] = raw[input];
      rgba[output + 2] = raw[input];
      rgba[output + 3] = raw[input + 1];
    } else {
      rgba[output] = raw[input];
      rgba[output + 1] = raw[input];
      rgba[output + 2] = raw[input];
      rgba[output + 3] = 255;
    }
  }

  return { width, height, rgba };
}

function cropAndTrim(image, rect, padding = 10) {
  let minX = rect.x + rect.width;
  let minY = rect.y + rect.height;
  let maxX = rect.x;
  let maxY = rect.y;

  for (let y = rect.y; y < rect.y + rect.height; y += 1) {
    for (let x = rect.x; x < rect.x + rect.width; x += 1) {
      const alpha = image.rgba[(y * image.width + x) * 4 + 3];
      if (alpha > 0) {
        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x);
        maxY = Math.max(maxY, y);
      }
    }
  }

  if (minX > maxX || minY > maxY) {
    throw new Error("No visible pixels found in crop");
  }

  minX = Math.max(0, minX - padding);
  minY = Math.max(0, minY - padding);
  maxX = Math.min(image.width - 1, maxX + padding);
  maxY = Math.min(image.height - 1, maxY + padding);

  const width = maxX - minX + 1;
  const height = maxY - minY + 1;
  const rgba = Buffer.alloc(width * height * 4);

  for (let y = 0; y < height; y += 1) {
    const sourceStart = ((minY + y) * image.width + minX) * 4;
    const targetStart = y * width * 4;
    image.rgba.copy(rgba, targetStart, sourceStart, sourceStart + width * 4);
  }

  return { width, height, rgba };
}

function writePng(image) {
  const scanlines = Buffer.alloc((image.width * 4 + 1) * image.height);
  for (let y = 0; y < image.height; y += 1) {
    const rowStart = y * (image.width * 4 + 1);
    scanlines[rowStart] = 0;
    image.rgba.copy(scanlines, rowStart + 1, y * image.width * 4, (y + 1) * image.width * 4);
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(image.width, 0);
  ihdr.writeUInt32BE(image.height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  return Buffer.concat([
    pngSignature,
    chunk("IHDR", ihdr),
    chunk("IDAT", zlib.deflateSync(scanlines, { level: 9 })),
    chunk("IEND")
  ]);
}

function gridRect(index, width, height) {
  const col = index % 4;
  const row = Math.floor(index / 4);
  const lefts = [0, 313, 627, 940];
  const rights = [313, 627, 940, width];
  const tops = [0, Math.floor(height / 2)];
  const bottoms = [Math.floor(height / 2), height];
  return {
    x: lefts[col],
    y: tops[row],
    width: rights[col] - lefts[col],
    height: bottoms[row] - tops[row]
  };
}

for (const sheet of sheets) {
  const source = await readFile(sheet.source);
  const image = readPng(source);
  const outputDir = path.join("public", "assets", "members", sheet.memberId);
  await mkdir(outputDir, { recursive: true });

  for (let index = 0; index < sheet.poses.length; index += 1) {
    const pose = sheet.poses[index];
    const cropped = cropAndTrim(image, gridRect(index, image.width, image.height));
    await writeFile(path.join(outputDir, `${pose}.png`), writePng(cropped));
  }
}

console.log("Member sprites extracted.");
