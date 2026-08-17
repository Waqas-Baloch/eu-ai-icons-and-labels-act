import { describe, expect, it } from "vitest";
import {
  classifyDigitalSourceType,
  identifyGenerator,
  isJpeg,
  isPng,
  isWebp,
  parseProvenance,
  readJpegSegments,
  readPngChunks,
  readWebpChunks,
} from "../app/lib/compliance/provenance";

// --- synthetic container builders -----------------------------------------
// CRCs are not validated by the walkers, so they are left zeroed.

const bytesOf = (s: string) => new Uint8Array([...s].map((c) => c.charCodeAt(0)));

function pngChunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  new DataView(out.buffer).setUint32(0, data.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  return out;
}

function buildPng(chunks: Uint8Array[]): Uint8Array {
  const sig = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const all = [sig, ...chunks, pngChunk("IEND", new Uint8Array(0))];
  const total = all.reduce((n, c) => n + c.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const c of all) {
    out.set(c, offset);
    offset += c.length;
  }
  return out;
}

function jpegSegment(marker: number, data: Uint8Array): Uint8Array {
  const length = data.length + 2;
  const out = new Uint8Array(4 + data.length);
  out[0] = 0xff;
  out[1] = marker;
  out[2] = (length >> 8) & 0xff;
  out[3] = length & 0xff;
  out.set(data, 4);
  return out;
}

function buildJpeg(segments: Uint8Array[]): Uint8Array {
  const soi = new Uint8Array([0xff, 0xd8]);
  const sos = new Uint8Array([0xff, 0xda, 0x00, 0x02]);
  const all = [soi, ...segments, sos];
  const total = all.reduce((n, c) => n + c.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const c of all) {
    out.set(c, offset);
    offset += c.length;
  }
  return out;
}

function buildWebp(chunks: Array<{ type: string; data: Uint8Array }>): Uint8Array {
  const parts: Uint8Array[] = [];
  for (const { type, data } of chunks) {
    const pad = data.length % 2;
    const chunk = new Uint8Array(8 + data.length + pad);
    for (let i = 0; i < 4; i++) chunk[i] = type.charCodeAt(i);
    new DataView(chunk.buffer).setUint32(4, data.length, true);
    chunk.set(data, 8);
    parts.push(chunk);
  }
  const body = parts.reduce((n, c) => n + c.length, 0);
  const out = new Uint8Array(12 + body);
  out.set(bytesOf("RIFF"), 0);
  new DataView(out.buffer).setUint32(4, 4 + body, true);
  out.set(bytesOf("WEBP"), 8);
  let offset = 12;
  for (const p of parts) {
    out.set(p, offset);
    offset += p.length;
  }
  return out;
}

const IPTC_NS = "http://cv.iptc.org/newscodes/digitalsourcetype/";

// --- vocabulary ------------------------------------------------------------

describe("classifyDigitalSourceType", () => {
  // The vocabulary terms nest as substrings, so match order decides
  // correctness. These three are the whole ballgame.
  it("reads a composite as AI-modified, not AI-generated", () => {
    const result = classifyDigitalSourceType(
      `${IPTC_NS}compositeWithTrainedAlgorithmicMedia`,
    );
    expect(result?.origin).toBe("ai_modified");
    expect(result?.token).toBe("compositewithtrainedalgorithmicmedia");
  });

  it("reads trained algorithmic media as AI-generated", () => {
    const result = classifyDigitalSourceType(`${IPTC_NS}trainedAlgorithmicMedia`);
    expect(result?.origin).toBe("ai_generated");
    expect(result?.token).toBe("trainedalgorithmicmedia");
  });

  it("does not mistake trainedAlgorithmicMedia for plain algorithmicMedia", () => {
    // "algorithmicMedia" is a suffix of "trainedAlgorithmicMedia"; a naive
    // ordering would clear a genuine AI image as non-AI.
    const result = classifyDigitalSourceType(`${IPTC_NS}trainedAlgorithmicMedia`);
    expect(result?.origin).not.toBe("not_ai");
  });

  it("treats untrained algorithmic media as non-AI", () => {
    const result = classifyDigitalSourceType(`${IPTC_NS}algorithmicMedia`);
    expect(result?.origin).toBe("not_ai");
    expect(result?.token).toBe("algorithmicmedia");
  });

  it("treats algorithmic enhancement as non-AI", () => {
    expect(classifyDigitalSourceType(`${IPTC_NS}algorithmicallyEnhanced`)?.origin).toBe(
      "not_ai",
    );
  });

  it("treats a digital capture as non-AI", () => {
    expect(classifyDigitalSourceType(`${IPTC_NS}digitalCapture`)?.origin).toBe("not_ai");
  });

  it("is case-insensitive", () => {
    expect(classifyDigitalSourceType("TRAINEDALGORITHMICMEDIA")?.origin).toBe(
      "ai_generated",
    );
  });

  it("returns null when no vocabulary term is present", () => {
    expect(classifyDigitalSourceType("Canon EOS R5, f/2.8, ISO 400")).toBeNull();
  });
});

describe("identifyGenerator", () => {
  it.each([
    ["Midjourney v6.1", "Midjourney"],
    ["Created with DALL·E 3", "DALL·E (OpenAI)"],
    ["dall-e-3", "DALL·E (OpenAI)"],
    ["Adobe Firefly Image 3", "Adobe Firefly"],
    ["ComfyUI workflow", "ComfyUI"],
    ["Stable Diffusion XL", "Stable Diffusion"],
    ["Adobe Photoshop 26.0 Generative Fill", "Adobe Photoshop (Generative Fill)"],
    ["Ideogram 2.0", "Ideogram"],
  ])("identifies %s", (text, expected) => {
    expect(identifyGenerator(text)).toBe(expected);
  });

  it("returns undefined for ordinary camera software strings", () => {
    expect(identifyGenerator("Canon EOS R5 Firmware 1.8.1")).toBeUndefined();
  });
});

// --- container walkers -----------------------------------------------------

describe("format detection", () => {
  it("recognises each supported container", () => {
    expect(isPng(buildPng([]))).toBe(true);
    expect(isJpeg(buildJpeg([]))).toBe(true);
    expect(isWebp(buildWebp([]))).toBe(true);
  });

  it("does not confuse the formats with each other", () => {
    expect(isJpeg(buildPng([]))).toBe(false);
    expect(isPng(buildJpeg([]))).toBe(false);
    expect(isWebp(buildPng([]))).toBe(false);
  });

  it("tolerates truncated buffers", () => {
    expect(isPng(new Uint8Array([0x89, 0x50]))).toBe(false);
    expect(isWebp(new Uint8Array([0x52, 0x49]))).toBe(false);
  });
});

describe("readPngChunks", () => {
  it("extracts text and C2PA chunks and stops at IEND", () => {
    const png = buildPng([
      pngChunk("IHDR", new Uint8Array(13)),
      pngChunk("tEXt", bytesOf("parameters\0masterpiece, 8k")),
      pngChunk("caBX", bytesOf("c2pa manifest")),
    ]);
    const kinds = readPngChunks(png).map((s) => s.kind);
    expect(kinds).toContain("text");
    expect(kinds).toContain("c2pa");
  });

  it("returns nothing for a PNG with no metadata chunks", () => {
    expect(readPngChunks(buildPng([pngChunk("IHDR", new Uint8Array(13))]))).toEqual([]);
  });

  it("does not run past a chunk claiming more data than exists", () => {
    const truncated = buildPng([pngChunk("tEXt", bytesOf("hello"))]).slice(0, 20);
    expect(() => readPngChunks(truncated)).not.toThrow();
  });
});

describe("readJpegSegments", () => {
  it("distinguishes EXIF, XMP and C2PA APP segments", () => {
    const jpeg = buildJpeg([
      jpegSegment(0xe1, bytesOf("Exif\0\0MM*\0")),
      jpegSegment(0xe1, bytesOf("http://ns.adobe.com/xap/1.0/\0<x:xmpmeta/>")),
      jpegSegment(0xeb, bytesOf("JP  jumb c2pa")),
    ]);
    const kinds = readJpegSegments(jpeg).map((s) => s.kind);
    expect(kinds).toEqual(["exif", "xmp", "c2pa"]);
  });

  it("stops at the start of scan", () => {
    const jpeg = buildJpeg([jpegSegment(0xe1, bytesOf("Exif\0\0"))]);
    expect(readJpegSegments(jpeg)).toHaveLength(1);
  });

  it("tolerates a malformed segment length", () => {
    const bad = new Uint8Array([0xff, 0xd8, 0xff, 0xe1, 0x00, 0x00, 0x41]);
    expect(() => readJpegSegments(bad)).not.toThrow();
  });
});

describe("readWebpChunks", () => {
  it("extracts XMP and EXIF chunks", () => {
    const webp = buildWebp([
      { type: "VP8 ", data: new Uint8Array(10) },
      { type: "XMP ", data: bytesOf(`${IPTC_NS}trainedAlgorithmicMedia`) },
    ]);
    const kinds = readWebpChunks(webp).map((s) => s.kind);
    expect(kinds).toEqual(["xmp"]);
  });

  it("handles odd-length chunks with their pad byte", () => {
    const webp = buildWebp([
      { type: "XMP ", data: bytesOf("odd") },
      { type: "EXIF", data: bytesOf("Exif") },
    ]);
    expect(readWebpChunks(webp).map((s) => s.kind)).toEqual(["xmp", "exif"]);
  });
});

// --- end to end ------------------------------------------------------------

describe("parseProvenance", () => {
  it("reports unknown for an image with no metadata at all", () => {
    const result = parseProvenance(buildPng([pngChunk("IHDR", new Uint8Array(13))]));
    expect(result.origin).toBe("unknown");
    expect(result.source).toBe("none");
  });

  it("reports unknown — never not_ai — for camera metadata with no AI signal", () => {
    // The safety property the whole workflow rests on: ordinary EXIF proves a
    // camera profile was written, not that no generative step followed.
    const jpeg = buildJpeg([
      jpegSegment(0xe1, bytesOf("Exif\0\0Canon EOS R5  2026:03:14 10:22:31")),
    ]);
    const result = parseProvenance(jpeg);
    expect(result.origin).toBe("unknown");
    expect(result.origin).not.toBe("not_ai");
  });

  it("reads a C2PA manifest as authoritative", () => {
    const jpeg = buildJpeg([
      jpegSegment(0xeb, bytesOf(`JP  jumb c2pa ${IPTC_NS}trainedAlgorithmicMedia`)),
    ]);
    const result = parseProvenance(jpeg);
    expect(result.source).toBe("c2pa");
    expect(result.origin).toBe("ai_generated");
  });

  it("prefers a C2PA manifest over a contrary XMP block", () => {
    const jpeg = buildJpeg([
      jpegSegment(0xe1, bytesOf(`http://ns.adobe.com/xap/1.0/\0${IPTC_NS}digitalCapture`)),
      jpegSegment(
        0xeb,
        bytesOf(`JP  jumb c2pa ${IPTC_NS}compositeWithTrainedAlgorithmicMedia`),
      ),
    ]);
    const result = parseProvenance(jpeg);
    expect(result.source).toBe("c2pa");
    expect(result.origin).toBe("ai_modified");
  });

  it("reads IPTC DigitalSourceType from XMP when there is no C2PA manifest", () => {
    const jpeg = buildJpeg([
      jpegSegment(
        0xe1,
        bytesOf(
          `http://ns.adobe.com/xap/1.0/\0<Iptc4xmpExt:DigitalSourceType>${IPTC_NS}trainedAlgorithmicMedia</Iptc4xmpExt:DigitalSourceType>`,
        ),
      ),
    ]);
    const result = parseProvenance(jpeg);
    expect(result.source).toBe("iptc");
    expect(result.origin).toBe("ai_generated");
  });

  it("falls back to a generator fingerprint and marks the confidence as low", () => {
    const png = buildPng([
      pngChunk("tEXt", bytesOf("parameters\0Steps: 30, Model: Stable Diffusion XL")),
    ]);
    const result = parseProvenance(png);
    expect(result.origin).toBe("ai_generated");
    expect(result.generatorName).toBe("Stable Diffusion");
    expect(result.raw?.confidence).toBe("low");
  });

  it("extracts a creation date for the 2 August 2026 cutoff", () => {
    const jpeg = buildJpeg([
      jpegSegment(
        0xe1,
        bytesOf(`http://ns.adobe.com/xap/1.0/\0${IPTC_NS}trainedAlgorithmicMedia 2026-05-01T09:00:00Z`),
      ),
    ]);
    const result = parseProvenance(jpeg);
    expect(result.contentCreatedAt?.toISOString()).toBe("2026-05-01T09:00:00.000Z");
  });

  it("parses EXIF-style colon dates", () => {
    const png = buildPng([
      pngChunk("tEXt", bytesOf("Software\0Midjourney  2026:09:03 14:05:00")),
    ]);
    expect(parseProvenance(png).contentCreatedAt?.toISOString()).toBe(
      "2026-09-03T14:05:00.000Z",
    );
  });

  it("returns unknown for an unsupported container rather than throwing", () => {
    const result = parseProvenance(bytesOf("GIF89a not really an image"));
    expect(result.origin).toBe("unknown");
    expect(result.source).toBe("none");
  });

  it("honours an explicit non-AI declaration in a C2PA manifest", () => {
    const png = buildPng([
      pngChunk("caBX", bytesOf(`c2pa ${IPTC_NS}digitalCapture Canon`)),
    ]);
    expect(parseProvenance(png).origin).toBe("not_ai");
  });
});
