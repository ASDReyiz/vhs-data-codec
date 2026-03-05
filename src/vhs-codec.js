// ─── vhs-codec.js  VHS Data Codec V14 ───────────────────────────────────────
// The brains of the operation. Pure functions, no React, no DOM crap
// (ok fine, canvas and blob helpers, sue me).
//
// If you're wondering "why VHS?"... because we can. And because 2GB on a
// tape you found in your grandma's attic is objectively hilarious.
//
// ── TO RUN LOCALLY ───────────────────────────────────────────────────────────
//   1. npm create vite@latest my-vhs -- --template react
//   2. cd my-vhs
//   3. Copy vhs-codec.js and VHSCodec.jsx into src/
//   4. Edit src/App.jsx:
//        import VHSCodec from './VHSCodec';
//        export default function App() { return <VHSCodec />; }
//   5. npm run dev  →  open http://localhost:5173
//
// ── OR DESKTOP APP (Electron) ────────────────────────────────────────────────
//   npm install && npm run dev:electron   → opens desktop app
//   npm run build:electron                → produces installer
// ─────────────────────────────────────────────────────────────────────────────

export const VERSION = "V14.0";
export const CW = 640;  // good old NTSC width. don't change this unless you hate yourself
export const CH = 480;  // ditto

// ─── LEGACY CONSTANT (kept for backward compat, no longer used for splitting) ─
// We used to split AVIs at this limit because browsers would choke.
// Now we use streaming Blob builder so this is just... here. Chilling.
export const MAX_AVI_FRAMES = 18000;

// ─── 4 PRESETS ──────────────────────────────────────────────────────────────
// Four presets from paranoid to reckless. Pick your poison.
// Smaller blocks = more data per frame but less room for error.
// Higher FPS = more throughput but VHS has to keep up.
//
// All presets include RS(255,223) ECC, guard bands, and VHS safety margins.
//
// Safety margins: sacrificial rows at top and bottom that VHS will
// absolutely destroy with tracking noise and head-switching garbage.
// We fill them with pretty alternating bars and pray. Data stays safe
// in the middle where the tape actually behaves itself.

export const PRESETS = {
  safe: {
    id: 1,
    blockSize: 8,
    fps: 10,
    mode: "single",
    panelCols: 1,
    panelRows: 1,
    strips: 1,
    guard: 1,
    margin: 2,
    label: "🛡️ SAFE",
    desc: "8px blocks — 10fps + guard + 16px margins — damaged / old tapes",
    tier: "SAFE",
    capacity: "~20 MB / T-160",
  },
  standard: {
    id: 2,
    blockSize: 4,
    fps: 30,
    mode: "single",
    panelCols: 1,
    panelRows: 1,
    strips: 1,
    guard: 1,
    margin: 5,
    label: "⚖️ STANDARD",
    desc: "4px blocks — 30fps + guard + 20px margins — reliable VHS decks",
    tier: "STANDARD",
    capacity: "~490 MB / T-160",
  },
  express: {
    id: 3,
    blockSize: 3,
    fps: 30,
    mode: "single",
    panelCols: 1,
    panelRows: 1,
    strips: 1,
    guard: 1,
    margin: 7,
    label: "⚡ EXPRESS",
    desc: "3px blocks — 30fps + guard + 21px margins — balanced throughput",
    tier: "DEFAULT",
    capacity: "~857 MB / T-160",
  },
  turbo: {
    id: 4,
    blockSize: 2,
    fps: 30,
    mode: "single",
    panelCols: 1,
    panelRows: 1,
    strips: 1,
    guard: 1,
    margin: 10,
    label: "🚀 TURBO",
    desc: "2px blocks — 30fps + guard + 20px margins — maximum density",
    tier: "MAXIMUM",
    capacity: "~1.97 GB / T-160",
  },
};

export function presetById(id) {
  return Object.values(PRESETS).find(p => p.id === id) || PRESETS.express;
}

// ─── UNIFIED LAYOUT ──────────────────────────────────────────────────────────
// Every frame region (whether full frame, vertical strip, or panel) has the
// same anatomy. Took forever to get this right, but it's beautiful now:
//
//   [GUARD_L] [SYNC ROW] [HEADER ×3] [DATA rows...] [FOOTER ROW] [GUARD_R]
//
// Guard columns = solid white pillars on both sides. They're like bumpers
// in bowling — keep the horizontal alignment from going off the rails.
// Sync row = alternating black/white. The decoder uses this to figure out
// what "black" and "white" even mean after VHS mangles the signal.
// Footer = inverted sync at bottom, because why not have a sanity check.
// Header = 3 rows of metadata crammed in there (frame number, total, CRC).

export function getRegionLayout(blockSize, regionW, regionH, guardCols, safeMargin = 0) {
  const COLS      = Math.floor(regionW / blockSize);
  const ROWS      = Math.floor(regionH / blockSize);
  const GUARD     = guardCols;                   // white pillars on each side
  const USABLE_COLS = COLS - 2 * GUARD;          // what we actually get to use
  const MARGIN    = safeMargin;                  // rows sacrificed to the VHS gods
  const SYNC_ROWS = 2;                           // top sync + bottom footer
  const HDR_ROWS  = 3;
  const D_START   = MARGIN + 1 + HDR_ROWS;      // where the good stuff starts
  const D_END     = ROWS - MARGIN - 1;           // where it ends (before footer eats it)
  const DATA_ROWS = Math.max(0, D_END - D_START);// actual usable rows. hopefully > 0 lol
  const BPF       = USABLE_COLS * DATA_ROWS;     // raw bits per frame
  const RAW_BYTES = Math.floor(BPF / 8);         // ^^^ but in bytes
  const RS_BLOCKS = Math.floor(RAW_BYTES / RS_N); // how many RS blocks we can cram in
  const BYTESPF   = RS_BLOCKS * RS_K;             // ACTUAL data bytes per frame (this is what matters)

  return {
    COLS, ROWS, GUARD, USABLE_COLS, MARGIN,
    HDR_ROWS, D_START, D_END, DATA_ROWS,
    BPF, RAW_BYTES, RS_BLOCKS, BYTESPF,
    blockSize, regionW, regionH,
  };
}

// Figure out the full layout for a preset. This is where it all comes together.
export function getPresetLayout(preset) {
  const { blockSize, fps, mode, panelCols, panelRows, strips, guard, margin } = preset;
  const safeMargin = margin || 0;

  if (mode === "panel" && (panelCols > 1 || panelRows > 1)) {
    const rw = Math.floor(CW / panelCols);
    const rh = Math.floor(CH / panelRows);
    const region = getRegionLayout(blockSize, rw, rh, guard, safeMargin);
    const numRegions = panelCols * panelRows;
    return {
      region, numRegions, mode,
      panelCols, panelRows, strips: 1,
      effectiveBPF: region.BPF,           // all panels show identical data (redundancy!)
      effectiveBYTESPF: region.BYTESPF,   // so effective throughput = just one panel's worth
      fps, blockSize, guard, margin: safeMargin,
    };
  }

  if (mode === "strip" && strips > 1) {
    const rw = Math.floor(CW / strips);
    const region = getRegionLayout(blockSize, rw, CH, guard, safeMargin);
    const numRegions = strips;
    return {
      region, numRegions, mode,
      panelCols: 1, panelRows: 1, strips,
      effectiveBPF: region.BPF * strips,
      effectiveBYTESPF: region.BYTESPF * strips,
      fps, blockSize, guard, margin: safeMargin,
    };
  }

  // Single frame
  const region = getRegionLayout(blockSize, CW, CH, guard, safeMargin);
  return {
    region, numRegions: 1, mode: "single",
    panelCols: 1, panelRows: 1, strips: 1,
    effectiveBPF: region.BPF,
    effectiveBYTESPF: region.BYTESPF,
    fps, blockSize, guard, margin: safeMargin,
  };
}

// ─── BIT UTILS ───────────────────────────────────────────────────────────────
// number-to-bits and bits-to-number. The bread and butter of bit twiddling.
export const n2b = (n, len) => Array.from({ length: len }, (_, i) => (n >> (len - 1 - i)) & 1);
export const b2n = bits => bits.reduce((a, b) => (a << 1) | b, 0);

// CRC-16 CCITT. Not the fanciest checksum, but it catches 99.998% of errors
// and fits in 2 bytes. Good enough for government work.
export function crc16(arr) {
  let crc = 0xFFFF;
  for (const b of arr) {
    crc ^= b << 8;
    for (let i = 0; i < 8; i++)
      crc = (crc & 0x8000) ? ((crc << 1) ^ 0x1021) & 0xFFFF : (crc << 1) & 0xFFFF;
  }
  return crc;
}

// ─── REED-SOLOMON RS(255,223) GF(2^8) ──────────────────────────────────────
// The real hero of this whole project. 32 parity bytes per 255-byte block,
// corrects up to 16 BYTE errors per block. That's insane.
// Battle-tested algorithm — been around since the 60s and still undefeated.
//
// Fair warning: the GF(2^8) arithmetic below looks like absolute gibberish.
// I promise it works. I spent way too many nights debugging this.
// Primitive poly: x^8 + x^4 + x^3 + x^2 + 1  (0x11D)
const GF_EXP = new Uint8Array(512);
const GF_LOG = new Uint8Array(256);
(function initGF() {
  let x = 1;
  for (let i = 0; i < 255; i++) { GF_EXP[i] = x; GF_LOG[x] = i; x = (x << 1) ^ (x & 0x80 ? 0x11D : 0); }
  for (let i = 255; i < 512; i++) GF_EXP[i] = GF_EXP[i - 255];
})();
const gfMul = (a, b) => (a === 0 || b === 0) ? 0 : GF_EXP[GF_LOG[a] + GF_LOG[b]];
const gfPow = (a, n) => a === 0 ? 0 : GF_EXP[(GF_LOG[a] * n) % 255];
const gfInv = (a) => GF_EXP[255 - GF_LOG[a]];

export const RS_N = 255;   // codeword length — the whole enchilada
export const RS_K = 223;   // data portion — what you actually care about
export const RS_NSYM = 32; // parity symbols — the error-fixing magic bytes

// Generator polynomial — product of (x - α^i) for i=0..31
// Don't ask me to explain this at a party. Please.
const RS_GEN = (() => {
  let g = [1];
  for (let i = 0; i < RS_NSYM; i++) {
    const ng = new Array(g.length + 1).fill(0);
    for (let j = g.length - 1; j >= 0; j--) { ng[j + 1] ^= g[j]; ng[j] ^= gfMul(GF_EXP[i], g[j]); }
    g = ng;
  }
  return g;
})();

export function rsEncode(data) {
  const padded = new Uint8Array(RS_K);
  padded.set(data.length >= RS_K ? data.slice(0, RS_K) : data);
  const par = new Uint8Array(RS_NSYM);
  for (let i = 0; i < RS_K; i++) {
    const fb = padded[i] ^ par[0];
    for (let j = 0; j < RS_NSYM - 1; j++) par[j] = par[j + 1] ^ gfMul(fb, RS_GEN[RS_NSYM - 1 - j]);
    par[RS_NSYM - 1] = gfMul(fb, RS_GEN[0]);
  }
  const out = new Uint8Array(RS_N);
  out.set(padded); out.set(par, RS_K);
  return out;
}

export function rsDecode(block) {
  if (block.length !== RS_N) return null;
  // Step 1: Calculate syndromes. If all zero, data is perfect. Life is good.
  const synd = new Array(RS_NSYM);
  for (let i = 0; i < RS_NSYM; i++) {
    let s = 0;
    for (let j = 0; j < RS_N; j++) s = gfMul(s, GF_EXP[i]) ^ block[j];
    synd[i] = s;
  }
  if (synd.every(s => s === 0)) return block.slice(0, RS_K); // clean! no errors!

  // Step 2: Berlekamp-Massey — finds the error locator polynomial.
  // This algorithm is black magic and I refuse to pretend I fully understand it.
  let C = [1], B = [1], L = 0, m = 1, b = 1;
  for (let r = 0; r < RS_NSYM; r++) {
    let d = synd[r];
    for (let j = 1; j <= L; j++) d ^= gfMul(C[j] || 0, synd[r - j]);
    if (d === 0) { m++; continue; }
    const T = C.slice();
    const coef = gfMul(d, gfInv(b));
    while (C.length < B.length + m) C.push(0);
    for (let j = 0; j < B.length; j++) C[j + m] ^= gfMul(coef, B[j]);
    if (2 * L <= r) { L = r + 1 - L; B = T; b = d; m = 1; } else { m++; }
  }
  if (C.length - 1 > RS_NSYM / 2) return null; // too many errors, we're cooked

  // Step 3: Chien search — brute force find which positions have errors.
  // Not elegant, but O(n) on a fixed n=255, so who cares.
  const errPos = [];
  for (let i = 0; i < RS_N; i++) {
    let sum = 0;
    for (let j = 0; j < C.length; j++) sum ^= gfMul(C[j], gfPow(GF_EXP[255 - i], j));
    if (sum === 0) errPos.push(i);
  }
  if (errPos.length !== C.length - 1) return null; // positions don't add up. bail.

  // Step 4: Forney algorithm — now that we know WHERE the errors are,
  // figure out WHAT the correct values should be. Math is wild.
  const omega = new Array(C.length).fill(0);
  for (let i = 0; i < omega.length; i++)
    for (let j = 0; j < C.length && j <= i; j++)
      omega[i] ^= gfMul(synd[i - j], C[j]);

  const corrected = new Uint8Array(block);
  for (let k = 0; k < errPos.length; k++) {
    const p = errPos[k];
    const Xl = GF_EXP[p], XlInv = GF_EXP[255 - p];
    let num = 0;
    for (let j = 0; j < omega.length; j++) num ^= gfMul(omega[j], gfPow(XlInv, j));
    let den = 0;
    for (let j = 1; j < C.length; j += 2) den ^= gfMul(C[j], gfPow(XlInv, j - 1));
    if (den === 0) return null;
    corrected[RS_N - 1 - p] ^= gfMul(gfMul(Xl, num), gfInv(den));
  }

  // Sanity check: re-calculate syndromes on the "corrected" data.
  // If any are non-zero, our correction was garbage. Better to return null
  // than to return confidently wrong data.
  for (let i = 0; i < RS_NSYM; i++) {
    let s = 0;
    for (let j = 0; j < RS_N; j++) s = gfMul(s, GF_EXP[i]) ^ corrected[j];
    if (s !== 0) return null;
  }
  return corrected.slice(0, RS_K);
}

// ─── BIT INTERLEAVER ─────────────────────────────────────────────────────────
// Spreads bits across the frame so that a localized scratch or dropout
// on the tape doesn't nuke an entire RS block. Think of it like shuffling
// a deck of cards — damage gets distributed evenly.
// Without this, a single horizontal scratch = entire RS block gone = game over.
// With this, same scratch = 1 bit error spread across many blocks = RS fixes it.
function gcd(a,b){return b===0?a:gcd(b,a%b);}
function modInverse(a,m){let [or,r]=[a,m],[os,s]=[1,0];while(r!==0){const q=Math.floor(or/r);[or,r]=[r,or-q*r];[os,s]=[s,os-q*s];}return((os%m)+m)%m;}
function getStride(cols){let s=Math.floor(cols/2)+1;while(gcd(s,cols)!==1)s++;return s;}

export function interleave(bits,cols){
  const stride=getStride(cols),out=new Array(bits.length).fill(0);
  for(let i=0;i<bits.length;i++){const row=Math.floor(i/cols),col=i%cols;out[row*cols+(col*stride)%cols]=bits[i];}
  return out;
}
export function deinterleave(bits,cols){
  const stride=getStride(cols),inv=modInverse(stride,cols),out=new Array(bits.length).fill(0);
  for(let i=0;i<bits.length;i++){const row=Math.floor(i/cols),col=i%cols;out[row*cols+(col*inv)%cols]=bits[i];}
  return out;
}

// ─── FRAME ENCODING ──────────────────────────────────────────────────────────
// This is where data becomes pixels. Each virtual frame gets its chunk of
// the payload, RS-encoded, byte-interleaved, bit-interleaved, and spat out
// as an array of 1s and 0s ready to be painted onto a canvas.
export function getPayloadTotalVFrames(payloadLen, regionLayout) {
  if (regionLayout.BYTESPF <= 0) return 1; // degenerate case, shouldn't happen but hey
  return Math.ceil(payloadLen / regionLayout.BYTESPF);
}

export function getTotalRealFrames(payloadLen, presetLayout) {
  const totalVF = getPayloadTotalVFrames(payloadLen, presetLayout.region);
  if (presetLayout.mode === "strip") return Math.ceil(totalVF / presetLayout.strips);
  return totalVF; // panels and single mode: 1 real frame per virtual frame
}

export function encodeFrameAt(payload, vFrameIndex, regionLayout) {
  const { BPF, BYTESPF, RS_BLOCKS, RAW_BYTES, USABLE_COLS } = regionLayout;
  const dataStart = vFrameIndex * BYTESPF;

  // RS encode each block — this is where the error correction magic happens
  const rsBlocks = [];
  for (let b = 0; b < RS_BLOCKS; b++) {
    const chunkStart = dataStart + b * RS_K;
    const chunkEnd   = Math.min(chunkStart + RS_K, payload.length);
    const chunk = new Uint8Array(RS_K);
    if (chunkStart < payload.length) chunk.set(payload.slice(chunkStart, chunkEnd));
    rsBlocks.push(rsEncode(chunk));
  }

  // Byte-interleave across RS blocks (cross-interleave style):
  // Write column-major so a burst error hits 1 byte per block max,
  // instead of obliterating 255 consecutive bytes from one block.
  // This was a PAINFUL bug to find when it was missing in the decoder.
  // Took 3 days. Three. Days.
  const coded = new Uint8Array(RAW_BYTES);
  for (let col = 0; col < RS_N; col++) {
    for (let row = 0; row < RS_BLOCKS; row++) {
      const dstIdx = col * RS_BLOCKS + row;
      if (dstIdx < RAW_BYTES) coded[dstIdx] = rsBlocks[row][col];
    }
  }

  // Convert bytes to bits
  const bits = new Array(BPF).fill(0);
  for (let i = 0; i < RAW_BYTES; i++) {
    for (let bit = 7; bit >= 0; bit--) {
      const idx = i * 8 + (7 - bit);
      if (idx < BPF) bits[idx] = (coded[i] >> bit) & 1;
    }
  }
  return interleave(bits, USABLE_COLS);
}

// ─── COMPACT HEADER (3 rows × USABLE_COLS bits) ─────────────────────────────
// Every frame carries a tiny header so the decoder knows what's what.
// bits[ 0..15] = vFrameNum (16)    — which frame is this
// bits[16..29] = totalVF   (14)    — how many frames total (max 16383... should be enough lol)
// bits[30..31] = modeCode  (2)     — 00=single, 01=strip, 10=panel, 11=reserved
// bits[32..38] = CRC7      (7)     — just enough CRC to catch header corruption
// If the header CRC fails, we throw out the whole frame. No mercy.

function _encodeHeader(vFrameNum, totalVF, modeCode) {
  const totalVFc = Math.min(totalVF, 16383);
  const crcBytes = [vFrameNum&0xFF,(vFrameNum>>8)&0xFF,totalVFc&0xFF,(totalVFc>>8)&0xFF,modeCode];
  return [
    ...n2b(vFrameNum & 0xFFFF, 16),
    ...n2b(totalVFc, 14),
    ...n2b(modeCode & 3, 2),
    ...n2b(crc16(crcBytes) & 0x7F, 7),
  ];
}

function _decodeHeader(hdrBits) {
  const vFrameNum = b2n(hdrBits.slice(0,16));
  const totalVFc  = b2n(hdrBits.slice(16,30));
  const modeCode  = b2n(hdrBits.slice(30,32));
  const storedCrc = b2n(hdrBits.slice(32,39));
  const crcBytes  = [vFrameNum&0xFF,(vFrameNum>>8)&0xFF,totalVFc&0xFF,(totalVFc>>8)&0xFF,modeCode];
  const ok = (crc16(crcBytes) & 0x7F) === storedCrc;
  return { vFrameNum, totalVF: totalVFc, modeCode, crcOk: ok };
}

function _modeToCode(mode) {
  if (mode === "strip") return 1;
  if (mode === "panel") return 2;
  return 0;
}

// ─── FRAME DRAWING ───────────────────────────────────────────────────────────
// Paints one region onto a canvas. This is where bits become actual pixels.
// Each "block" is a blockSize×blockSize square, either black (0) or white (1).
// The VCR doesn't know or care what these mean. It just records them.
function _drawOneRegion(ctx, dataBits, vFrameNum, totalVF, modeCode, layout, xPx, yPx) {
  const { COLS, ROWS, GUARD, USABLE_COLS, MARGIN, D_START, D_END, blockSize } = layout;
  const SYNC_ROW   = MARGIN;                    // sync row sits after top margin
  const HDR_START  = MARGIN + 1;                // header starts after sync
  const FOOTER_ROW = ROWS - MARGIN - 1;         // footer before bottom margin

  const blk = (c, r, v) => {
    ctx.fillStyle = v ? "#fff" : "#000";
    ctx.fillRect(xPx + c * blockSize, yPx + r * blockSize, blockSize, blockSize);
  };

  // Fill background black (the void from which data emerges)
  ctx.fillStyle = "#000";
  ctx.fillRect(xPx, yPx, COLS * blockSize, ROWS * blockSize);

  // Guard columns — solid white pillars, full height. The decoder's lighthouse.
  for (let r = 0; r < ROWS; r++) {
    for (let g = 0; g < GUARD; g++) {
      blk(g, r, 1);                       // left guard
      blk(COLS - 1 - g, r, 1);            // right guard
    }
  }

  // Top margin — alternating bars. These rows WILL get destroyed by VHS
  // tracking noise. That's fine. That's literally their job. They die so
  // the data rows can live. Thank you for your service, margin rows.
  for (let mr = 0; mr < MARGIN; mr++) {
    for (let c = 0; c < USABLE_COLS; c++) {
      blk(GUARD + c, mr, mr % 2 === 0 ? 1 : 0);
    }
  }

  // Sync row (at MARGIN offset) — alternating within usable area
  for (let c = 0; c < USABLE_COLS; c++) blk(GUARD + c, SYNC_ROW, c % 2);

  // Header rows (3 rows after sync)
  const hdr = _encodeHeader(vFrameNum, totalVF, modeCode);
  for (let row = HDR_START; row < HDR_START + 3; row++) {
    for (let c = 0; c < USABLE_COLS; c++) {
      const bi = (row - HDR_START) * USABLE_COLS + c;
      blk(GUARD + c, row, bi < hdr.length ? hdr[bi] : 0);
    }
  }

  // Data rows
  for (let i = 0; i < dataBits.length; i++) {
    const r = D_START + Math.floor(i / USABLE_COLS);
    const c = i % USABLE_COLS;
    if (r < D_END) blk(GUARD + c, r, dataBits[i]);
  }

  // Footer row (inverted sync, before bottom margin)
  for (let c = 0; c < USABLE_COLS; c++) blk(GUARD + c, FOOTER_ROW, (c + 1) % 2);

  // Bottom margin — alternating bars (sacrificial, absorbs head-switching noise)
  for (let mr = 0; mr < MARGIN; mr++) {
    const row = ROWS - MARGIN + mr;
    for (let c = 0; c < USABLE_COLS; c++) {
      blk(GUARD + c, row, mr % 2 === 0 ? 1 : 0);
    }
  }
}

// Draw a complete real frame for any mode.
export function drawRealFrame(canvas, payload, realFrameIndex, totalVF, presetLayout) {
  const { region, mode, strips, panelCols, panelRows } = presetLayout;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, CW, CH);

  const modeCode = _modeToCode(mode);

  if (mode === "strip" && strips > 1) {
    const stripW = Math.floor(CW / strips);
    for (let s = 0; s < strips; s++) {
      const vf = realFrameIndex * strips + s;
      if (vf >= totalVF) break;
      const bits = encodeFrameAt(payload, vf, region);
      _drawOneRegion(ctx, bits, vf, totalVF, modeCode, region, s * stripW, 0);
    }
    return;
  }

  if (mode === "panel" && (panelCols > 1 || panelRows > 1)) {
    const pw = Math.floor(CW / panelCols);
    const ph = Math.floor(CH / panelRows);
    const vf = realFrameIndex; // panels all carry same VF
    const bits = encodeFrameAt(payload, vf, region);
    for (let pr = 0; pr < panelRows; pr++)
      for (let pc = 0; pc < panelCols; pc++)
        _drawOneRegion(ctx, bits, vf, totalVF, modeCode, region, pc * pw, pr * ph);
    return;
  }

  // Single frame
  const vf = realFrameIndex;
  const bits = encodeFrameAt(payload, vf, region);
  _drawOneRegion(ctx, bits, vf, totalVF, modeCode, region, 0, 0);
}

// ─── PAD FRAMES (1 second black at start/end of AVI) ────────────────────────
// VCRs are mechanical beasts. They need a moment to get the tape up to speed
// before we throw data at them. These solid black frames at the start and end
// give the VCR time to stabilize. The decoder just skips them (no sync = ignored).
export function drawPadFrame(canvas) {
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, CW, CH);
}

// ─── LEADER / TRAILER FRAMES ────────────────────────────────────────────────
// 2 seconds of checkerboard calibration before data starts.
// The checkerboard helps the VCR stabilize tracking, and the countdown bar
// lets the decoder know "data is about to start, get ready."
// Also looks sick on screen. Very retro. Very aesthetic.

export function drawLeaderFrame(canvas, frameIndex, totalLeaderFrames) {
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, CW, CH);

  // Checkerboard background
  const bs = 16;
  for (let y = 0; y < CH; y += bs) {
    for (let x = 0; x < CW; x += bs) {
      const isWhite = ((x / bs) + (y / bs)) % 2 === 0;
      ctx.fillStyle = isWhite ? "#fff" : "#000";
      ctx.fillRect(x, y, bs, bs);
    }
  }

  // Countdown bar at bottom (shrinks as we approach data)
  const progress = (frameIndex + 1) / totalLeaderFrames;
  const barH = 40;
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, CH - barH, CW * (1 - progress), barH);

  // "LEADER" text area — thick white bars on left and right
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, 32, CH);          // left bar
  ctx.fillRect(CW - 32, 0, 32, CH);    // right bar
}

export function isLeaderFrame(imageData, W, H) {
  // Detect checkerboard pattern in center of frame
  const d = imageData.data;
  const lum = (x, y) => { const i=(y*W+x)*4; return d[i]*0.299+d[i+1]*0.587+d[i+2]*0.114; };
  const bs = 16;
  let match = 0, total = 0;
  for (let by = 2; by < 10; by++) {
    for (let bx = 4; bx < Math.floor(CW/bs) - 4; bx++) {
      const cx = bx * bs + bs/2, cy = by * bs + bs/2;
      if (cx >= W || cy >= H) continue;
      const expected = ((bx + by) % 2 === 0) ? 1 : 0;
      const actual = lum(cx, cy) > 128 ? 1 : 0;
      if (expected === actual) match++;
      total++;
    }
  }
  return total > 0 && match / total > 0.7;
}

// Detect solid-black pad frames (1s at start/end of AVI).
// We just check if the center of the frame is basically all black.
// If average luminance < 15, it's a pad. Simple, brutal, effective.
export function isPadFrame(imageData, W, H) {
  const d = imageData.data;
  let sum = 0, count = 0;
  const x0 = Math.floor(W * 0.2), x1 = Math.floor(W * 0.8);
  const y0 = Math.floor(H * 0.2), y1 = Math.floor(H * 0.8);
  const step = Math.max(1, Math.floor((x1 - x0) / 20));
  for (let y = y0; y < y1; y += step)
    for (let x = x0; x < x1; x += step) {
      const i = (y * W + x) * 4;
      sum += d[i] * 0.299 + d[i+1] * 0.587 + d[i+2] * 0.114;
      count++;
    }
  return count > 0 && sum / count < 15;
}

// ─── FRAME READING ───────────────────────────────────────────────────────────
// The decoder side. Takes a captured frame image and extracts the data bits.
// This is where things get hairy — VHS degrades everything. JPEG compresses it.
// The threshold calibration from the sync row is crucial here.
// Reads one region from imageData at pixel offset (xPx, yPx).
function _readOneRegion(imageData, W, H, regionLayout, xPx, yPx) {
  const { COLS, ROWS, GUARD, USABLE_COLS, MARGIN, D_START, D_END, blockSize } = regionLayout;
  const SYNC_ROW   = MARGIN;
  const HDR_START  = MARGIN + 1;
  const FOOTER_ROW = ROWS - MARGIN - 1;
  const d = imageData.data;

  const getLum = (px, py) => {
    if (px<0||py<0||px>=W||py>=H) return 128;
    const idx=(py*W+px)*4;
    return d[idx]*0.299+d[idx+1]*0.587+d[idx+2]*0.114;
  };

  const sampleBlock = (c, r) => {
    const bx = xPx + c * blockSize, by = yPx + r * blockSize;
    // For tiny blocks (2-3px), sample center pixel only
    if (blockSize <= 3) {
      const cx = bx + Math.floor(blockSize / 2);
      const cy = by + Math.floor(blockSize / 2);
      return (cx < W && cy < H) ? getLum(cx, cy) : 128;
    }
    const mx = Math.max(1, Math.floor(blockSize * 0.2));
    let sum = 0, count = 0;
    const step = Math.max(1, Math.floor((blockSize - 2*mx) / 2));
    for (let dy = mx; dy < blockSize-mx; dy += step)
      for (let dx = mx; dx < blockSize-mx; dx += step) {
        const sx = bx+dx, sy = by+dy;
        if (sx < W && sy < H) { sum += getLum(sx, sy); count++; }
      }
    return count > 0 ? sum/count : 128;
  };

  // Calculate threshold from sync row (at MARGIN offset)
  let syncSum = 0;
  for (let c = 0; c < USABLE_COLS; c++) syncSum += sampleBlock(GUARD + c, SYNC_ROW);
  const threshold = syncSum / USABLE_COLS;
  const getBlk = (c, r) => sampleBlock(c, r) > threshold ? 1 : 0;

  // Verify sync row
  let match = 0;
  for (let c = 0; c < USABLE_COLS; c++) if (getBlk(GUARD + c, SYNC_ROW) === (c % 2)) match++;
  if (match / USABLE_COLS < 0.55) return null;

  // Verify footer sync (inverted, at FOOTER_ROW)
  let footerMatch = 0;
  for (let c = 0; c < USABLE_COLS; c++) if (getBlk(GUARD + c, FOOTER_ROW) === ((c+1) % 2)) footerMatch++;
  // Footer is optional validation — don't reject if missing (might be cropped)

  // Read header (3 rows of USABLE_COLS bits, starting at HDR_START)
  const hdrBits = [];
  for (let row = HDR_START; row < HDR_START + 3; row++)
    for (let c = 0; c < USABLE_COLS; c++) hdrBits.push(getBlk(GUARD + c, row));

  const hdr = _decodeHeader(hdrBits);
  if (!hdr.crcOk) return null;
  if (hdr.totalVF === 0 || hdr.vFrameNum >= hdr.totalVF) return null;

  // Read data bits
  const frameBits = [];
  for (let r = D_START; r < D_END; r++)
    for (let c = 0; c < USABLE_COLS; c++) frameBits.push(getBlk(GUARD + c, r));

  return {
    vFrameNum: hdr.vFrameNum,
    totalVF:   hdr.totalVF,
    modeCode:  hdr.modeCode,
    frameBits: deinterleave(frameBits, USABLE_COLS),
    footerOk:  footerMatch / USABLE_COLS > 0.55,
  };
}

// Read all regions from a real frame.
// For strips: returns array of strip results (different VFs).
// For panels: returns array of panel results (same VF, for voting).
// For single: returns array with one result.
export function readRealFrameFromImageData(imageData, W, H, presetLayout) {
  const { region, mode, strips, panelCols, panelRows } = presetLayout;

  if (mode === "strip" && strips > 1) {
    const stripW = Math.floor(CW / strips);
    return Array.from({ length: strips }, (_, s) =>
      _readOneRegion(imageData, W, H, region, s * stripW, 0));
  }

  if (mode === "panel" && (panelCols > 1 || panelRows > 1)) {
    const pw = Math.floor(CW / panelCols);
    const ph = Math.floor(CH / panelRows);
    const results = [];
    for (let pr = 0; pr < panelRows; pr++)
      for (let pc = 0; pc < panelCols; pc++)
        results.push(_readOneRegion(imageData, W, H, region, pc * pw, pr * ph));
    return results;
  }

  return [_readOneRegion(imageData, W, H, region, 0, 0)];
}

export function readRealFrameFromCanvas(canvas, presetLayout) {
  const W = canvas.width, H = canvas.height;
  const ctx = canvas.getContext("2d");
  const img = ctx.getImageData(0, 0, W, H);
  return readRealFrameFromImageData(img, W, H, presetLayout);
}

// ─── PATTERN SEARCH ENGINE ───────────────────────────────────────────────────
// For the brave souls who point a camera at their TV screen instead of
// using a proper capture card. This tries to find the VHS data region
// within a larger image by hunting for the sync pattern at various scales.
// It's like Where's Waldo but for alternating black/white blocks.
export function detectVhsRegion(imageData, W, H) {
  const d = imageData.data;
  const lum = (x, y) => { const i=(y*W+x)*4; return d[i]*0.299+d[i+1]*0.587+d[i+2]*0.114; };
  const blkLum = (xOff, yOff, bW, bH, c, r) => {
    const cx=xOff+c*bW+(bW>>1), cy=yOff+r*bH+(bH>>1);
    if (cx>=W||cy>=H) return 128;
    return lum(cx,cy);
  };
  const syncScore = (xOff, yOff, bW, bH) => {
    const COLS=Math.floor((W-xOff)/bW);
    if(COLS<8) return 0;
    const lums=Array.from({length:COLS},(_,c)=>blkLum(xOff,yOff,bW,bH,c,0));
    const avg=lums.reduce((a,v)=>a+v,0)/COLS;
    const bits=lums.map(v=>v>avg?1:0);
    let match=0;
    for(let c=0;c<COLS;c++) if(bits[c]===(c&1)) match++;
    return match/COLS;
  };

  const BW_MIN=6, BW_MAX=80;
  for (let bW=BW_MIN; bW<=BW_MAX; bW++) {
    const bH=bW, COLS=Math.floor(W/bW);
    if(COLS<8) continue;
    const rowStep=Math.max(1,bH>>2);
    const xOffMax=Math.min(bW,4);
    for (let xOff=0; xOff<xOffMax; xOff++) {
      for (let yOff=0; yOff<H-bH*4; yOff+=rowStep) {
        if(syncScore(xOff,yOff,bW,bH)>0.80) return {xOff,yOff,blockW:bW,blockH:bH};
      }
    }
  }
  return null;
}

// ─── BIT VOTING ──────────────────────────────────────────────────────────────
// When you have multiple captures of the same data, majority vote wins.
// If 2 out of 3 captures say a bit is 1, it's 1. Democracy for data.
export function mergeFrameVotes(votes) {

  const len=votes[0].length;
  return Array.from({length:len},(_,i)=>{
    const sum=votes.reduce((a,v)=>a+v[i],0);
    return sum>votes.length/2?1:0;
  });
}

// ─── ASSEMBLY ────────────────────────────────────────────────────────────────
// Takes the vote map (frame number → array of bit arrays) and reconstructs
// the original file. This is the moment of truth. RS decodes each block,
// reports errors, and we pray the CRC matches at the end.
export function assembleVFrames(voteMap, totalVF, payloadSize, regionLayout) {
  const { BPF, RS_BLOCKS, RAW_BYTES } = regionLayout;
  const outputChunks = [];
  const missing = [];
  let rsErrors = 0, rsFixed = 0, rsFailed = 0;

  for (let f = 0; f < totalVF; f++) {
    if (!voteMap[f] || voteMap[f].length === 0) {
      missing.push(f);
      outputChunks.push(new Uint8Array(regionLayout.BYTESPF)); // zeros
      continue;
    }
    const merged = voteMap[f].length > 1 ? mergeFrameVotes(voteMap[f]) : voteMap[f][0];

    // Convert bits to bytes
    const frameBytes = new Uint8Array(RAW_BYTES);
    for (let i = 0; i < RAW_BYTES; i++) {
      let byte = 0;
      for (let bit = 7; bit >= 0; bit--) {
        const idx = i * 8 + (7 - bit);
        if (idx < merged.length) byte |= (merged[idx] & 1) << bit;
      }
      frameBytes[i] = byte;
    }

    // De-interleave bytes back into RS blocks (reverse of CIRC-style encode)
    const frameData = new Uint8Array(regionLayout.BYTESPF);
    for (let b = 0; b < RS_BLOCKS; b++) {
      const block = new Uint8Array(RS_N);
      for (let col = 0; col < RS_N; col++) {
        const srcIdx = col * RS_BLOCKS + b;
        block[col] = srcIdx < RAW_BYTES ? frameBytes[srcIdx] : 0;
      }
      const decoded = rsDecode(block);
      if (decoded) {
        frameData.set(decoded, b * RS_K);
        // Quick check: did RS actually have to fix anything?
        // Compare data bytes — if any differ, errors were corrected.
        // (This used to recompute syndromes which was 35x slower. Why did I do that.)
        let hadErrors = false;
        for (let i = 0; i < RS_K; i++) {
          if (block[i] !== decoded[i]) { hadErrors = true; break; }
        }
        if (hadErrors) { rsErrors++; rsFixed++; }
      } else {
        // Uncorrectable — use raw data (best effort)
        frameData.set(block.slice(0, RS_K), b * RS_K);
        rsErrors++; rsFailed++;
      }
    }
    outputChunks.push(frameData);
  }

  // Flatten to payload
  const totalBytes = outputChunks.reduce((s, c) => s + c.length, 0);
  const bytes = new Uint8Array(Math.min(totalBytes, payloadSize));
  let offset = 0;
  for (const chunk of outputChunks) {
    const copy = Math.min(chunk.length, payloadSize - offset);
    if (copy <= 0) break;
    bytes.set(chunk.slice(0, copy), offset);
    offset += copy;
  }

  const parsed = parsePayload(bytes);
  return { ...parsed, rawPayload: bytes, missing, rsErrors, rsFixed, rsFailed };
}

// ─── PAYLOAD FORMAT V2 ───────────────────────────────────────────────────────
// Multi-file container. Each file gets a name, CRC, original size, and
// optional DEFLATE compression. Videos, ZIPs, and other already-compressed
// formats skip compression because DEFLATE on a JPEG is just a waste of CPU.
//
// Header: [0x56 'V'] [0x48 'H'] [flags: bit0=compressed] [numFiles]
// Per file: [nameLen(1)] [name] [crc16(2)] [origSize(4 LE)] [storedSize(4 LE)] [data]

// Formats that are already compressed — don't bother trying to DEFLATE these.
// Learned this the hard way when a 50MB MP4 took 10 seconds to "compress"
// into a 50.1MB output. Thanks, entropy.
const COMPRESSED_EXTS = new Set([
  "jpg","jpeg","png","gif","webp","mp4","mkv","avi","mov","webm","mp3","aac",
  "ogg","flac","zip","rar","7z","gz","bz2","xz","zst","br","lz4","pdf",
]);

export async function buildPayload(files, tryCompress = true) {
  const entries = [];
  for (const { name, data } of files) {
    const nameBytes = new TextEncoder().encode(name.slice(0, 255));
    const crc       = crc16(data);
    let stored      = data;
    let compressed  = false;
    const ext = name.split(".").pop().toLowerCase();
    const skipCompress = data.length > 20_000_000 || COMPRESSED_EXTS.has(ext);
    if (tryCompress && !skipCompress) {
      try {
        const comp = await compressBytes(data);
        if (comp.length < data.length) { stored = comp; compressed = true; }
      } catch (_) {}
    }
    entries.push({ nameBytes, crc, origSize: data.length, stored, compressed });
  }

  const compressedAny = entries.some(e => e.compressed);
  let total = 4;
  for (const e of entries)
    total += 1 + e.nameBytes.length + 2 + 4 + 4 + e.stored.length;

  const payload = new Uint8Array(total);
  let o = 0;
  payload[o++] = 0x56;
  payload[o++] = 0x48;
  payload[o++] = compressedAny ? 1 : 0;
  payload[o++] = entries.length;

  for (const e of entries) {
    payload[o++] = e.nameBytes.length;
    payload.set(e.nameBytes, o); o += e.nameBytes.length;
    payload[o++] = (e.crc >> 8) & 0xFF;
    payload[o++] = e.crc & 0xFF;
    const os = e.origSize;
    payload[o++]=os&0xFF; payload[o++]=(os>>8)&0xFF; payload[o++]=(os>>16)&0xFF; payload[o++]=(os>>24)&0xFF;
    const ss = e.stored.length;
    payload[o++]=ss&0xFF; payload[o++]=(ss>>8)&0xFF; payload[o++]=(ss>>16)&0xFF; payload[o++]=(ss>>24)&0xFF;
    payload.set(e.stored, o); o += e.stored.length;
  }

  const stats = entries.map(e => ({
    name: e.nameBytes ? new TextDecoder().decode(e.nameBytes) : '',
    origSize: e.origSize,
    storedSize: e.stored.length,
    compressed: e.compressed,
  }));

  return { payload, stats };
}

export function buildPayloadLegacy(fileBytes, filename) {
  const nameBytes = new TextEncoder().encode(filename.slice(0, 255));
  const checksum  = crc16(fileBytes);
  const payload   = new Uint8Array(2 + nameBytes.length + 2 + fileBytes.length);
  payload[0] = (nameBytes.length >> 8) & 0xFF;
  payload[1] = nameBytes.length & 0xFF;
  payload.set(nameBytes, 2);
  payload[2 + nameBytes.length] = (checksum >> 8) & 0xFF;
  payload[3 + nameBytes.length] = checksum & 0xFF;
  payload.set(fileBytes, 4 + nameBytes.length);
  return payload;
}

export function parsePayload(payload) {
  if (payload[0] === 0x56 && payload[1] === 0x48) {
    const flags    = payload[2];
    const numFiles = payload[3];
    const files = [];
    let o = 4;
    for (let i = 0; i < numFiles && o < payload.length; i++) {
      const nameLen   = payload[o++];
      const name      = new TextDecoder().decode(payload.slice(o, o + nameLen)); o += nameLen;
      const storedCrc = (payload[o] << 8) | payload[o + 1]; o += 2;
      const origSize  = payload[o]|(payload[o+1]<<8)|(payload[o+2]<<16)|((payload[o+3]<<24)>>>0); o += 4;
      const storedSize= payload[o]|(payload[o+1]<<8)|(payload[o+2]<<16)|((payload[o+3]<<24)>>>0); o += 4;
      const fileBytes = payload.slice(o, o + storedSize); o += storedSize;
      files.push({ name, storedCrc, origSize, storedSize, fileBytes, compressed: storedSize !== origSize });
    }
    return { v2: true, files };
  }

  const nameLen = (payload[0] << 8) | payload[1];
  if (nameLen > 255) return { error: "Header decode failed — wrong block size or corrupt data" };
  const filename  = new TextDecoder().decode(payload.slice(2, 2 + nameLen));
  const storedCrc = (payload[2 + nameLen] << 8) | payload[3 + nameLen];
  const fileData  = payload.slice(4 + nameLen);
  const actualCrc = crc16(fileData);
  return { v1: true, filename, fileData, crcOk: storedCrc === actualCrc, storedCrc, actualCrc };
}

export async function finalizeAssembled(assembled) {
  if (assembled.error) return [{ error: assembled.error }];

  if (assembled.v1) {
    return [{ filename: assembled.filename, fileData: assembled.fileData, crcOk: assembled.crcOk }];
  }

  if (assembled.v2) {
    const results = [];
    for (const f of assembled.files) {
      let fileData = f.fileBytes;
      if (f.compressed) {
        try { fileData = await decompressBytes(f.fileBytes); }
        catch (e) {
          results.push({ filename: f.name, fileData: f.fileBytes, crcOk: false,
            error: `Decompression failed: ${e.message}` });
          continue;
        }
      }
      const actualCrc = crc16(fileData);
      results.push({ filename: f.name, fileData, crcOk: f.storedCrc === actualCrc });
    }
    return results;
  }

  return [{ error: "Unknown payload format" }];
}

// ─── VHSD V5 FORMAT ──────────────────────────────────────────────────────────
// Our custom binary format. 32-byte header + compressed payload.
// Everything the decoder needs is in the header — block size, FPS, margins,
// guard columns, preset ID, the works. No guessing required.
//
// Header layout (32 bytes):
//   [0..3]   "VHSD"         magic bytes — if you see these, it's one of ours
//   [4]      5              version (we're on v5 now, v4 was... a learning experience)
//   [5]      blockSize      pixels per block
//   [6]      fps            frames per second (1-30)
//   [7]      numFiles       how many files are packed in (1-255)
//   [8]      flags          bit0=outer deflate, bit1=has leader
//   [9]      numStrips      strip count (usually 1)
//   [10]     panelRows      panel layout (0=off)
//   [11]     panelCols      panel layout (0=off)
//   [12..15] origSize       original payload size, u32 LE
//   [16..19] dataSize       stored (possibly compressed) size, u32 LE
//   [20..21] frameWidth     u16 LE (640)
//   [22..23] frameHeight    u16 LE (480)
//   [24]     leaderSec      seconds of leader (0-10)
//   [25]     guardCols      guard columns per side (0-4)
//   [26]     presetId       which preset was used (1-4, 0=custom)
//   [27]     safeMargin     margin rows per edge (0-10)
//   [28..31] reserved       for future use. or never. who knows.

async function _wrapVhsd(rawPayload, preset, leaderSec, numFiles) {
  const { blockSize, fps, strips, panelCols, panelRows, guard, margin, id: presetId } = preset;

  let data = rawPayload;
  let compressed = false;
  if (rawPayload.length < 20_000_000) {
    try {
      const comp = await compressBytes(rawPayload);
      if (comp.length < rawPayload.length) { data = comp; compressed = true; }
    } catch (_) {}
  }

  const header = new Uint8Array(32);
  let o = 0;
  for (const c of "VHSD") header[o++] = c.charCodeAt(0);
  header[o++] = 5;                          // version
  header[o++] = blockSize;
  header[o++] = fps & 0xFF;
  header[o++] = (numFiles || 1) & 0xFF;
  header[o++] = (compressed ? 1 : 0) | (leaderSec > 0 ? 2 : 0); // flags
  header[o++] = (strips || 1) & 0xFF;
  header[o++] = (panelRows || 0) & 0xFF;
  header[o++] = (panelCols || 0) & 0xFF;
  const os = rawPayload.length;
  header[o++]=os&0xFF;header[o++]=(os>>8)&0xFF;header[o++]=(os>>16)&0xFF;header[o++]=(os>>24)&0xFF;
  const ds = data.length;
  header[o++]=ds&0xFF;header[o++]=(ds>>8)&0xFF;header[o++]=(ds>>16)&0xFF;header[o++]=(ds>>24)&0xFF;
  header[o++] = CW & 0xFF; header[o++] = (CW >> 8) & 0xFF;
  header[o++] = CH & 0xFF; header[o++] = (CH >> 8) & 0xFF;
  header[o++] = leaderSec & 0xFF;
  header[o++] = (guard || 0) & 0xFF;
  header[o++] = (presetId || 0) & 0xFF;
  header[o++] = (margin || 0) & 0xFF;
  // rest is reserved zeros

  const buf = new Uint8Array(32 + data.length);
  buf.set(header, 0);
  buf.set(data, 32);
  return { buf, compressed, originalSize: rawPayload.length, compressedSize: data.length };
}

export async function buildVhsdV5(files, preset, leaderSec = 2) {
  const { payload: rawPayload, stats } = await buildPayload(files, true);
  const numFiles = Math.min(255, files.length);
  const result = await _wrapVhsd(rawPayload, preset, leaderSec, numFiles);
  return { ...result, stats };
}

// Build VHSD from a raw captured payload (for the merge workflow).
// After you decode an MP4/AVI capture off tape, you can save the raw decoded
// payload as a .VHSD file. Then decode the tape again, save another .VHSD,
// and merge them together. Each capture votes on what the correct bits are.
// It's like asking 3 witnesses what they saw — majority rules.
export async function buildVhsdFromPayload(rawPayload, preset, leaderSec = 2) {
  const numFiles = (rawPayload.length >= 4 && rawPayload[0] === 0x56 && rawPayload[1] === 0x48)
    ? rawPayload[3] : 1;
  const result = await _wrapVhsd(rawPayload, preset, leaderSec, numFiles);
  return result.buf;
}

export async function vhsdV5ToPayload(buf) {
  if (buf.length < 32) return { error: "File too short" };
  const magic = String.fromCharCode(buf[0],buf[1],buf[2],buf[3]);
  if (magic !== "VHSD") return { error: "Not a VHSD file" };
  const version = buf[4];

  // Support v4 for backward compat
  if (version === 4) return _parseVhsdV4(buf);
  if (version !== 5) return { error: `VHSD v${version} not supported.` };

  const blockSize  = buf[5];
  const fps        = buf[6];
  const numFiles   = buf[7];
  const flags      = buf[8];
  const strips     = buf[9] || 1;
  const panelRows  = buf[10] || 0;
  const panelCols  = buf[11] || 0;
  const origSize   = buf[12]|(buf[13]<<8)|(buf[14]<<16)|((buf[15]<<24)>>>0);
  const dataSize   = buf[16]|(buf[17]<<8)|(buf[18]<<16)|((buf[19]<<24)>>>0);
  const frameW     = buf[20] | (buf[21] << 8);
  const frameH     = buf[22] | (buf[23] << 8);
  const leaderSec  = buf[24] || 0;
  const guardCols  = buf[25] || 0;
  const presetId   = buf[26] || 0;
  const safeMargin = buf[27] || 0;

  if (buf.length < 32 + dataSize) return { error: `File truncated` };

  let payload = buf.slice(32, 32 + dataSize);
  if (flags & 1) {
    try { payload = await decompressBytes(payload); }
    catch (e) { return { error: `Outer decompression failed: ${e.message}` }; }
  }
  if (payload.length !== origSize) return { error: `Size mismatch after decompression` };

  // Reconstruct preset-like object
  const mode = panelCols > 1 || panelRows > 1 ? "panel" : strips > 1 ? "strip" : "single";
  const pseudoPreset = {
    id: presetId, blockSize, fps, mode,
    panelCols: panelCols || 1, panelRows: panelRows || 1,
    strips, guard: guardCols, margin: safeMargin,
  };
  const presetLayout = getPresetLayout(pseudoPreset);
  const totalVF      = getPayloadTotalVFrames(payload.length, presetLayout.region);
  const totalFrames  = getTotalRealFrames(payload.length, presetLayout);

  return {
    payload, totalFrames, totalVF, payloadSize: payload.length,
    presetLayout, blockSize, fps, numFiles, frameW, frameH,
    strips, panelCols, panelRows, leaderSec, guardCols, presetId, safeMargin, mode,
  };
}

function _parseVhsdV4(buf) {
  // Backward compat shim for V4 files
  const blockSize = buf[5];
  const fps       = buf[6];
  const numFiles  = buf[7];
  const flags     = buf[8];
  const strips    = buf.length >= 10 ? (buf[9] || 1) : 1;
  const origSize  = buf[12]|(buf[13]<<8)|(buf[14]<<16)|((buf[15]<<24)>>>0);
  const dataSize  = buf[16]|(buf[17]<<8)|(buf[18]<<16)|((buf[19]<<24)>>>0);
  const hasExt    = buf.length >= 28;
  const frameW    = hasExt ? (buf[20]|(buf[21]<<8)) : CW;
  const frameH    = hasExt ? (buf[22]|(buf[23]<<8)) : CH;
  const dataStart = hasExt ? 28 : 20;

  // Build a v5-compatible result
  return (async () => {
    if (buf.length < dataStart + dataSize) return { error: `V4 file truncated` };
    let payload = buf.slice(dataStart, dataStart + dataSize);
    if (flags & 1) {
      try { payload = await decompressBytes(payload); }
      catch (e) { return { error: `V4 decompression failed: ${e.message}` }; }
    }
    if (payload.length !== origSize) return { error: `V4 size mismatch` };
    const mode = strips > 1 ? "strip" : "single";
    const pseudoPreset = { blockSize, fps, mode, panelCols: 1, panelRows: 1, strips, guard: 0, margin: 0 };
    const presetLayout = getPresetLayout(pseudoPreset);
    const totalVF      = getPayloadTotalVFrames(payload.length, presetLayout.region);
    const totalFrames  = getTotalRealFrames(payload.length, presetLayout);
    return {
      payload, totalFrames, totalVF, payloadSize: payload.length,
      presetLayout, blockSize, fps, numFiles, frameW, frameH,
      strips, panelCols: 1, panelRows: 1, leaderSec: 0, guardCols: 0, presetId: 0, mode,
    };
  })();
}

export async function readVhsdV5(buf) {
  const result = await vhsdV5ToPayload(buf);
  if (result.error) return { error: result.error };
  const parsed = parsePayload(result.payload);
  return await finalizeAssembled(parsed);
}

// ─── VHSL MANIFEST FORMAT ───────────────────────────────────────────────────
// A human-readable JSON receipt (.vhsl) that describes what's on the tape.
// "Hey future-me, here's what you encoded 6 months ago and forgot about."
// Saved alongside the VHSD/AVI so you know what to expect on decode.

export function buildVhslManifest(files, stats, preset, totalFrames, totalVF, payloadSize) {
  const manifest = {
    format: "VHSL",
    version: 1,
    created: new Date().toISOString(),
    encoder: VERSION,
    preset: {
      name: Object.entries(PRESETS).find(([,p]) => p.id === preset.id)?.[0] || "custom",
      id: preset.id,
      blockSize: preset.blockSize,
      fps: preset.fps,
      mode: preset.mode,
      strips: preset.strips || 1,
      panelCols: preset.panelCols || 1,
      panelRows: preset.panelRows || 1,
      guard: preset.guard || 0,
    },
    frame: {
      width: CW,
      height: CH,
      totalReal: totalFrames,
      totalVirtual: totalVF,
    },
    payload: {
      totalSize: payloadSize,
      totalOriginalSize: files.reduce((s, f) => s + f.data.length, 0),
    },
    files: files.map((f, i) => ({
      name: f.name,
      size: f.data.length,
      type: f.name.split('.').pop().toLowerCase(),
      crc16: "0x" + crc16(f.data).toString(16).padStart(4, '0'),
      compressed: stats[i]?.compressed || false,
      storedSize: stats[i]?.storedSize || f.data.length,
    })),
    duration: {
      dataSeconds: Math.ceil(totalFrames / preset.fps),
      leaderSeconds: 2,
      padSeconds: 2,
      totalSeconds: Math.ceil(totalFrames / preset.fps) + 4,
    },
  };
  return JSON.stringify(manifest, null, 2);
}

export function parseVhslManifest(jsonStr) {
  try {
    const m = JSON.parse(jsonStr);
    if (m.format !== "VHSL") return { error: "Not a VHSL manifest" };
    return m;
  } catch (e) {
    return { error: `Invalid JSON: ${e.message}` };
  }
}

// ─── VHSD MULTI-FILE MERGE ───────────────────────────────────────────────────
// The nuclear option for data recovery. Record the same tape 2-3 times,
// decode each capture into a .VHSD, then merge them here. Each capture's
// bits get re-encoded to frame bits and stored as votes. Assembly then
// uses majority voting before RS decode. Belt AND suspenders AND a parachute.
export async function mergeVhsdFiles(files) {
  let merged = null;

  for (const file of files) {
    const ab  = await file.arrayBuffer();
    const buf = new Uint8Array(ab);
    const enc = await vhsdV5ToPayload(buf);
    if (enc.error) return { error: `${file.name}: ${enc.error}` };

    const { payload, presetLayout, totalVF } = enc;
    const { region } = presetLayout;
    const { BPF, USABLE_COLS } = region;

    if (!merged) {
      merged = { totalVF, payloadSize: payload.length, region, voteMap: {} };
    } else if (merged.totalVF !== totalVF || merged.payloadSize !== payload.length) {
      return { error: `${file.name}: frame count or payload size mismatch` };
    }

    // Re-encode payload to frame bits for voting
    for (let f = 0; f < totalVF; f++) {
      const frameBits = encodeFrameAt(payload, f, region);
      // Deinterleave for storage in voteMap (assembly will work on deinterleaved bits)
      if (!merged.voteMap[f]) merged.voteMap[f] = [];
      merged.voteMap[f].push(deinterleave(frameBits, USABLE_COLS));
    }
  }

  return merged || { error: "No files provided" };
}

// ─── COMPRESSION ─────────────────────────────────────────────────────────────
// DEFLATE via the browser's built-in CompressionStream API.
// No third-party libraries needed. Thank you, modern browsers.
// (Except for the streaming interface which is... verbose. But it works.)
export async function compressBytes(bytes) {
  const cs=new CompressionStream("deflate-raw");
  const writer=cs.writable.getWriter();
  writer.write(bytes); writer.close();
  const chunks=[], reader=cs.readable.getReader();
  while(true){const{done,value}=await reader.read();if(done)break;chunks.push(value);}
  const total=chunks.reduce((s,c)=>s+c.length,0);
  const out=new Uint8Array(total);
  let o=0; for(const c of chunks){out.set(c,o);o+=c.length;}
  return out;
}

export async function decompressBytes(bytes) {
  const ds=new DecompressionStream("deflate-raw");
  const writer=ds.writable.getWriter();
  writer.write(bytes); writer.close();
  const chunks=[], reader=ds.readable.getReader();
  while(true){const{done,value}=await reader.read();if(done)break;chunks.push(value);}
  const total=chunks.reduce((s,c)=>s+c.length,0);
  const out=new Uint8Array(total);
  let o=0; for(const c of chunks){out.set(c,o);o+=c.length;}
  return out;
}

// ─── AVI MJPEG BUILDER (STREAMING BLOB) ─────────────────────────────────────
// Builds an AVI file from an array of JPEG frames. Returns a Blob.
//
// Why Blob instead of Uint8Array? Because a 100k frame AVI is ~3GB.
// Allocating a 3GB contiguous buffer is a great way to crash a browser tab.
// Blob parts reference the JPEG arrays directly — zero copy, ~1× memory.
//
// I learned this the hard way when the browser went "aw snap" on a 1.5GB AVI.
// Never again.
//
// The AVI format itself is ancient (1992!) but dead simple: RIFF container,
// MJPEG frames in a 'movi' list, idx1 index at the end. VLC, ffmpeg, and
// every media player on earth can play it.

export function buildAviBlob(jpegFrames, fps, w, h) {
  const cc  = (buf,o,s) => { for(let i=0;i<4;i++) buf[o+i]=s.charCodeAt(i); return o+4; };
  const u32 = (buf,o,v) => { buf[o]=v>>>0&0xFF;buf[o+1]=v>>>8&0xFF;buf[o+2]=v>>>16&0xFF;buf[o+3]=v>>>24&0xFF;return o+4; };
  const u16 = (buf,o,v) => { buf[o]=v&0xFF;buf[o+1]=v>>8&0xFF;return o+2; };

  const uSecPF=Math.round(1000000/fps), n=jpegFrames.length;
  const avihSz=56, strhSz=56, strfSz=40;
  const strlContent=4+8+strhSz+8+strfSz;
  const hdrlContent=4+8+avihSz+8+strlContent;
  const padSz=f=>f.length+(f.length&1);
  const moviFramesSz=jpegFrames.reduce((s,f)=>s+8+padSz(f),0);
  const moviContent=4+moviFramesSz;
  const idx1Sz=16*n;
  const riffContent=4+8+hdrlContent+8+moviContent+8+idx1Sz;

  // Build header (RIFF + hdrl + strl + movi list header)
  const hdrSize=8+4+8+hdrlContent+8+4; // RIFF(8)+AVI(4)+LIST(8)+hdrl+LIST(8)+movi(4)
  const hdr=new Uint8Array(hdrSize);
  let o=0;
  o=cc(hdr,o,'RIFF');o=u32(hdr,o,riffContent);o=cc(hdr,o,'AVI ');
  o=cc(hdr,o,'LIST');o=u32(hdr,o,hdrlContent);o=cc(hdr,o,'hdrl');
  o=cc(hdr,o,'avih');o=u32(hdr,o,avihSz);
  o=u32(hdr,o,uSecPF);o=u32(hdr,o,0);o=u32(hdr,o,0);o=u32(hdr,o,0x10);
  o=u32(hdr,o,n);o=u32(hdr,o,0);o=u32(hdr,o,1);o=u32(hdr,o,0);
  o=u32(hdr,o,w);o=u32(hdr,o,h);
  o=u32(hdr,o,0);o=u32(hdr,o,0);o=u32(hdr,o,0);o=u32(hdr,o,0);
  o=cc(hdr,o,'LIST');o=u32(hdr,o,strlContent);o=cc(hdr,o,'strl');
  o=cc(hdr,o,'strh');o=u32(hdr,o,strhSz);
  o=cc(hdr,o,'vids');o=cc(hdr,o,'MJPG');
  o=u32(hdr,o,0);o=u16(hdr,o,0);o=u16(hdr,o,0);o=u32(hdr,o,0);
  o=u32(hdr,o,1);o=u32(hdr,o,fps);o=u32(hdr,o,0);o=u32(hdr,o,n);
  o=u32(hdr,o,0);o=u32(hdr,o,0xFFFFFFFF);o=u32(hdr,o,0);
  o=u16(hdr,o,0);o=u16(hdr,o,0);o=u16(hdr,o,w);o=u16(hdr,o,h);
  o=cc(hdr,o,'strf');o=u32(hdr,o,strfSz);
  o=u32(hdr,o,strfSz);o=u32(hdr,o,w);o=u32(hdr,o,h);
  o=u16(hdr,o,1);o=u16(hdr,o,24);o=cc(hdr,o,'MJPG');
  o=u32(hdr,o,w*h*3);o=u32(hdr,o,0);o=u32(hdr,o,0);o=u32(hdr,o,0);o=u32(hdr,o,0);
  o=cc(hdr,o,'LIST');o=u32(hdr,o,moviContent);o=cc(hdr,o,'movi');

  // Build movi body + idx1 as Blob parts (zero-copy references to JPEG arrays).
  // Single allocation for ALL chunk headers (8 bytes × N), then subarray views.
  const parts = [hdr];
  const padByte = new Uint8Array([0]);
  let moviOff = 4; // offset within movi (starts after 'movi' fourcc)

  // Pre-allocate all "00dc" chunk headers in one buffer
  const allChunkHdrs = new Uint8Array(8 * n);
  for (let i = 0; i < n; i++) {
    const o = i * 8;
    cc(allChunkHdrs, o, '00dc');
    u32(allChunkHdrs, o + 4, jpegFrames[i].length);
  }

  // idx1 index
  const idx1 = new Uint8Array(8 + idx1Sz);
  let io = 0;
  io=cc(idx1,io,'idx1'); io=u32(idx1,io,idx1Sz);

  for (let i = 0; i < n; i++) {
    const f = jpegFrames[i];
    parts.push(allChunkHdrs.subarray(i * 8, i * 8 + 8)); // zero-copy view
    parts.push(f);
    if (f.length & 1) parts.push(padByte);

    // idx1 entry
    io=cc(idx1,io,'00dc'); io=u32(idx1,io,0x10); io=u32(idx1,io,moviOff); io=u32(idx1,io,f.length);
    moviOff += 8 + padSz(f);
  }
  parts.push(idx1);

  return new Blob(parts, { type: "video/avi" });
}

// Legacy monolithic AVI builder — kept around for small files and tests.
// For anything over a few thousand frames, use buildAviBlob above.
export function buildAvi(jpegFrames, fps, w, h) {
  const cc  = (buf,o,s) => { for(let i=0;i<4;i++) buf[o+i]=s.charCodeAt(i); return o+4; };
  const u32 = (buf,o,v) => { buf[o]=v>>>0&0xFF;buf[o+1]=v>>>8&0xFF;buf[o+2]=v>>>16&0xFF;buf[o+3]=v>>>24&0xFF;return o+4; };
  const u16 = (buf,o,v) => { buf[o]=v&0xFF;buf[o+1]=v>>8&0xFF;return o+2; };

  const uSecPF=Math.round(1000000/fps), n=jpegFrames.length;
  const avihSz=56, strhSz=56, strfSz=40;
  const strlContent=4+8+strhSz+8+strfSz;
  const hdrlContent=4+8+avihSz+8+strlContent;
  const padSz=f=>f.length+(f.length&1);
  const moviFramesSz=jpegFrames.reduce((s,f)=>s+8+padSz(f),0);
  const moviContent=4+moviFramesSz;
  const idx1Sz=16*n;
  const riffContent=4+8+hdrlContent+8+moviContent+8+idx1Sz;
  const buf=new Uint8Array(8+riffContent);
  let o=0;

  o=cc(buf,o,'RIFF');o=u32(buf,o,riffContent);o=cc(buf,o,'AVI ');
  o=cc(buf,o,'LIST');o=u32(buf,o,hdrlContent);o=cc(buf,o,'hdrl');
  o=cc(buf,o,'avih');o=u32(buf,o,avihSz);
  o=u32(buf,o,uSecPF);o=u32(buf,o,0);o=u32(buf,o,0);o=u32(buf,o,0x10);
  o=u32(buf,o,n);o=u32(buf,o,0);o=u32(buf,o,1);o=u32(buf,o,0);
  o=u32(buf,o,w);o=u32(buf,o,h);
  o=u32(buf,o,0);o=u32(buf,o,0);o=u32(buf,o,0);o=u32(buf,o,0);
  o=cc(buf,o,'LIST');o=u32(buf,o,strlContent);o=cc(buf,o,'strl');
  o=cc(buf,o,'strh');o=u32(buf,o,strhSz);
  o=cc(buf,o,'vids');o=cc(buf,o,'MJPG');
  o=u32(buf,o,0);o=u16(buf,o,0);o=u16(buf,o,0);o=u32(buf,o,0);
  o=u32(buf,o,1);o=u32(buf,o,fps);o=u32(buf,o,0);o=u32(buf,o,n);
  o=u32(buf,o,0);o=u32(buf,o,0xFFFFFFFF);o=u32(buf,o,0);
  o=u16(buf,o,0);o=u16(buf,o,0);o=u16(buf,o,w);o=u16(buf,o,h);
  o=cc(buf,o,'strf');o=u32(buf,o,strfSz);
  o=u32(buf,o,strfSz);o=u32(buf,o,w);o=u32(buf,o,h);
  o=u16(buf,o,1);o=u16(buf,o,24);o=cc(buf,o,'MJPG');
  o=u32(buf,o,w*h*3);o=u32(buf,o,0);o=u32(buf,o,0);o=u32(buf,o,0);o=u32(buf,o,0);
  o=cc(buf,o,'LIST');o=u32(buf,o,moviContent);
  const moviStart=o; o=cc(buf,o,'movi');
  const offsets=[];
  for(const f of jpegFrames){
    offsets.push(o-moviStart);
    o=cc(buf,o,'00dc');o=u32(buf,o,f.length);
    buf.set(f,o);o+=f.length;
    if(f.length&1){buf[o]=0;o++;}
  }
  o=cc(buf,o,'idx1');o=u32(buf,o,idx1Sz);
  for(let i=0;i<n;i++){
    o=cc(buf,o,'00dc');o=u32(buf,o,0x10);o=u32(buf,o,offsets[i]);o=u32(buf,o,jpegFrames[i].length);
  }
  return buf;
}

// ─── AVI RIFF PARSER ─────────────────────────────────────────────────────────
// Rips JPEG frames out of an AVI MJPEG file. Walks the RIFF chunk tree
// to find the 'movi' list, then extracts every '00dc'/'00db' chunk.
// If your AVI is non-standard or from some obscure tool, this might miss frames.
// But for our own AVI output, it works perfectly.
export function extractJpegsFromAvi(arrayBuffer) {
  const buf=new Uint8Array(arrayBuffer);
  const r32=o=>buf[o]|buf[o+1]<<8|buf[o+2]<<16|(buf[o+3]<<24)>>>0;
  const fcc=o=>String.fromCharCode(buf[o],buf[o+1],buf[o+2],buf[o+3]);
  if(buf.length<12||fcc(0)!=="RIFF"||fcc(8)!=="AVI ") return null;
  let moviStart=-1, moviEnd=-1, o=12;
  while(o+8<=buf.length){
    const id=fcc(o), sz=r32(o+4);
    if(id==="LIST"&&o+12<=buf.length&&fcc(o+8)==="movi"){moviStart=o+12;moviEnd=o+8+sz;break;}
    o+=8+Math.max(0,sz)+(sz&1);
    if(sz===0) break;
  }
  if(moviStart<0) return null;
  const jpegs=[]; o=moviStart;
  while(o+8<=Math.min(moviEnd,buf.length)){
    const id=fcc(o), sz=r32(o+4);
    if(id==="00dc"||id==="00db") jpegs.push(buf.slice(o+8,o+8+sz));
    o+=8+sz+(sz&1);
    if(sz===0) break;
  }
  return jpegs;
}

export async function drawJpegToCanvas(jpegBytes, canvas) {
  if(jpegBytes.length<4||jpegBytes[0]!==0xFF||jpegBytes[1]!==0xD8)
    throw new Error(`Not a valid JPEG`);
  const blob=new Blob([jpegBytes],{type:"image/jpeg"});
  if(typeof createImageBitmap!=="undefined"){
    const bitmap=await createImageBitmap(blob);
    canvas.getContext("2d").drawImage(bitmap,0,0,canvas.width,canvas.height);
    bitmap.close(); return;
  }
  await new Promise((res,rej)=>{
    const url=URL.createObjectURL(blob), img=new Image();
    img.onload=()=>{canvas.getContext("2d").drawImage(img,0,0,canvas.width,canvas.height);URL.revokeObjectURL(url);res();};
    img.onerror=()=>{URL.revokeObjectURL(url);rej(new Error("Image load failed"));};
    img.src=url;
  });
}

// ─── MP4 DEMUXER ─────────────────────────────────────────────────────────────
// Hand-rolled MP4 box parser. Why not use a library? Because I don't want
// to depend on 500KB of npm packages for something that's basically just
// "read 4 bytes, read 4 bytes, find the box" repeated forever.
//
// Parses: moov → trak → mdia → minf → stbl → {stsd, stts, stsz, stco/co64, stsc, stss}
// Extracts: H.264 codec string, avcC description, sample data + timestamps
//
// Every null check in here is the result of a real user's MP4 crashing the app.
// "Cannot read properties of null" haunts my dreams.
export function demuxMP4(arrayBuffer) {
  const buf=new Uint8Array(arrayBuffer);
  const view=new DataView(arrayBuffer);
  const r32=o=>view.getUint32(o,false);
  const fcc=o=>String.fromCharCode(buf[o],buf[o+1],buf[o+2],buf[o+3]);

  function* iterBoxes(start,end){
    let o=start;
    while(o+8<=end){
      let size=r32(o);const type=fcc(o+4);let dataStart=o+8;
      if(size===1){size=Number(view.getBigUint64(o+8,false));dataStart=o+16;}
      else if(size===0){size=end-o;}
      if(size<8) break;
      yield{type,start:o,dataStart,end:Math.min(o+size,end)};
      o+=size;
    }
  }
  const findBox=(s,e,t)=>{for(const b of iterBoxes(s,e))if(b.type===t)return b;return null;};

  const moov=findBox(0,buf.length,'moov');
  if(!moov) return null;
  let videoTrak=null;
  for(const trak of iterBoxes(moov.dataStart,moov.end)){
    if(trak.type!=='trak') continue;
    const mdia=findBox(trak.dataStart,trak.end,'mdia');
    if(!mdia) continue;
    const hdlr=findBox(mdia.dataStart,mdia.end,'hdlr');
    if(hdlr&&fcc(hdlr.dataStart+8)==='vide'){videoTrak=trak;break;}
  }
  if(!videoTrak) return null;

  const mdia=findBox(videoTrak.dataStart,videoTrak.end,'mdia');
  if(!mdia) return null;
  const minf=findBox(mdia.dataStart,mdia.end,'minf');
  if(!minf) return null;
  const stbl=findBox(minf.dataStart,minf.end,'stbl');
  if(!stbl) return null;
  const mdhd=findBox(mdia.dataStart,mdia.end,'mdhd');
  if(!mdhd) return null;
  const mdhdV=buf[mdhd.dataStart];
  const timescale=mdhdV===1?r32(mdhd.dataStart+20):r32(mdhd.dataStart+12);
  const stsd=findBox(stbl.dataStart,stbl.end,'stsd');
  if(!stsd) return null;
  const eStart=stsd.dataStart+8;
  const codecFCC=fcc(eStart+4);
  const eWidth=view.getUint16(eStart+32,false), eHeight=view.getUint16(eStart+34,false);
  const avcC=findBox(eStart+86,stsd.end,'avcC');
  let description=null, codec='avc1.42E01E';
  if(avcC){
    description=buf.slice(avcC.dataStart,avcC.end);
    if(description.length>=4)
      codec=`avc1.${description[1].toString(16).padStart(2,'0')}${description[2].toString(16).padStart(2,'0')}${description[3].toString(16).padStart(2,'0')}`;
  }
  const stts=findBox(stbl.dataStart,stbl.end,'stts');
  if(!stts) return null;
  const sampleTimestamps=[];
  {let t=0,o=stts.dataStart+8,n=r32(stts.dataStart+4);
   for(let i=0;i<n;i++,o+=8){const count=r32(o),dur=r32(o+4);for(let j=0;j<count;j++){sampleTimestamps.push(t);t+=dur;}}}
  const stsz=findBox(stbl.dataStart,stbl.end,'stsz');
  if(!stsz) return null;
  const defSz=r32(stsz.dataStart+4), sampleCount=r32(stsz.dataStart+8);
  const sampleSizes=defSz?Array(sampleCount).fill(defSz):Array.from({length:sampleCount},(_,i)=>r32(stsz.dataStart+12+i*4));
  const stco=findBox(stbl.dataStart,stbl.end,'stco');
  const co64=findBox(stbl.dataStart,stbl.end,'co64');
  const chunkOffsets=[];
  if(stco){const n=r32(stco.dataStart+4);for(let i=0;i<n;i++)chunkOffsets.push(r32(stco.dataStart+8+i*4));}
  else if(co64){const n=r32(co64.dataStart+4);for(let i=0;i<n;i++)chunkOffsets.push(Number(view.getBigUint64(co64.dataStart+8+i*8,false)));}
  else return null;
  const stsc=findBox(stbl.dataStart,stbl.end,'stsc');
  if(!stsc) return null;
  const stscN=r32(stsc.dataStart+4);
  const stscE=Array.from({length:stscN},(_,i)=>({firstChunk:r32(stsc.dataStart+8+i*12),spc:r32(stsc.dataStart+12+i*12)}));
  const chunkSPC=new Array(chunkOffsets.length).fill(1);
  for(let ei=0;ei<stscE.length;ei++){
    const next=ei+1<stscE.length?stscE[ei+1].firstChunk:chunkOffsets.length+1;
    for(let ci=stscE[ei].firstChunk;ci<next;ci++)chunkSPC[ci-1]=stscE[ei].spc;
  }
  const stss=findBox(stbl.dataStart,stbl.end,'stss');
  const keySet=new Set();
  if(stss){const n=r32(stss.dataStart+4);for(let i=0;i<n;i++)keySet.add(r32(stss.dataStart+8+i*4)-1);}
  const samples=[];
  let si=0;
  for(let ci=0;ci<chunkOffsets.length;ci++){
    let byteOff=chunkOffsets[ci];
    for(let s=0;s<chunkSPC[ci]&&si<sampleCount;s++,si++){
      samples.push({data:buf.slice(byteOff,byteOff+sampleSizes[si]),timestamp:Math.round((sampleTimestamps[si]||0)/timescale*1e6),isKey:keySet.size===0||keySet.has(si)});
      byteOff+=sampleSizes[si];
    }
  }
  return {codec,description,width:eWidth,height:eHeight,samples};
}

export async function decodeMP4WithWebCodecs(file, cvs, addLog, onFrame) {
  if(typeof VideoDecoder==='undefined'){addLog("WebCodecs not available","warn");return false;}
  const ab=await file.arrayBuffer();
  let demuxed;
  try { demuxed=demuxMP4(ab); } catch(e) { addLog(`MP4 demux error: ${e.message}`,"err"); return false; }
  if(!demuxed||!demuxed.samples.length){addLog("MP4 demux failed — unsupported format","err");return false;}
  const{codec,description,width,height,samples}=demuxed;
  addLog(`WebCodecs: ${samples.length} frames, ${width}×${height}, codec=${codec}`,"ok");
  cvs.width=width; cvs.height=height;
  const ctx=cvs.getContext("2d");
  const frameQueue=[];let decodeErr=null;
  const decoder=new VideoDecoder({output:f=>frameQueue.push(f),error:e=>{decodeErr=e;}});
  try{
    const cfg={codec,hardwareAcceleration:"no-preference"};
    if(description)cfg.description=description;
    decoder.configure(cfg);
  }catch(e){addLog(`WebCodecs configure: ${e.message}`,"err");return false;}
  for(let i=0;i<samples.length&&!decodeErr;i++){
    while(decoder.decodeQueueSize>16)await new Promise(r=>setTimeout(r,2));
    const s=samples[i];
    decoder.decode(new EncodedVideoChunk({type:s.isKey?'key':'delta',timestamp:s.timestamp,data:s.data}));
    while(frameQueue.length){
      const frame=frameQueue.shift();
      ctx.drawImage(frame,0,0,width,height);frame.close();
      await onFrame(ctx.getImageData(0,0,width,height),width,height,i/samples.length);
    }
    if(i%30===0)await new Promise(r=>setTimeout(r,0));
  }
  if(!decodeErr){
    await decoder.flush();
    while(frameQueue.length){
      const frame=frameQueue.shift();
      ctx.drawImage(frame,0,0,width,height);frame.close();
      await onFrame(ctx.getImageData(0,0,width,height),width,height,1);
    }
  }
  try{decoder.close();}catch(_){}
  cvs.width=CW;cvs.height=CH;
  if(decodeErr){addLog(`WebCodecs error: ${decodeErr.message}`,"err");return false;}
  return true;
}

// ─── AVI BLOCK SIZE AUTO-DETECT ──────────────────────────────────────────────
// When someone drops an AVI file for decoding, we don't want them to
// manually pick the preset. We try each preset on a few frames past
// the leader and see which one produces valid header CRCs. Lazy but smart.
export async function detectAviPreset(aviBuffer) {
  const jpegs = extractJpegsFromAvi(aviBuffer);
  if (!jpegs || jpegs.length === 0) return null;

  const canvas = document.createElement("canvas");
  canvas.width = CW; canvas.height = CH;

  // Skip potential leader frames (first few frames might be checkerboard)
  const startIdx = Math.min(10, jpegs.length - 1);
  for (let j = startIdx; j < Math.min(startIdx + 5, jpegs.length); j++) {
    try { await drawJpegToCanvas(jpegs[j], canvas); }
    catch { continue; }

    const ctx = canvas.getContext("2d");
    const img = ctx.getImageData(0, 0, CW, CH);

    for (const [presetKey, preset] of Object.entries(PRESETS)) {
      const pl = getPresetLayout(preset);
      const results = readRealFrameFromImageData(img, CW, CH, pl);
      if (results.some(r => r !== null)) return { key: presetKey, preset };
    }
  }
  return null;
}

// ─── PRESET AUTO-DETECT FROM ANY FRAME ──────────────────────────────────────
// Tries all 4 presets against a single frame. First one that decodes wins.
// Brute force? Yes. Fast enough? Also yes. There are only 4 presets.
export function detectPresetFromFrame(imageData, W, H) {
  for (const [key, preset] of Object.entries(PRESETS)) {
    const pl = getPresetLayout(preset);
    const results = readRealFrameFromImageData(imageData, W, H, pl);
    if (results.some(r => r !== null)) return { key, preset };
  }
  return null;
}

// ─── SELF TEST ───────────────────────────────────────────────────────────────
// Quick encode/decode round-trip test. If this fails, something is very wrong
// and you should probably panic.
export function encodeTestFile(fileBytes, filename, regionLayout) {
  const payload     = buildPayloadLegacy(fileBytes, filename);
  const totalVF     = getPayloadTotalVFrames(payload.length, regionLayout);
  const frames      = Array.from({length:totalVF},(_,f)=>encodeFrameAt(payload,f,regionLayout));
  return { frames, totalVF, payloadSize: payload.length, payload };
}

// ─── DOWNLOAD ───────────────────────────────────────────────────────────────
// In Electron: pops up a native save dialog (no size limits, feels proper).
// In browser: creates a blob URL and fakes a click on a hidden <a> tag.
// The browser method has a ~2GB limit on some browsers. Electron doesn't care.
export async function triggerDownload(data, filename, mimeType) {
  // Electron: use native save dialog (no browser size limits)
  if (typeof window !== "undefined" && window.electronAPI?.saveFile) {
    try {
      // Electron needs ArrayBuffer — convert Blob if needed
      const ab = data instanceof Blob ? await data.arrayBuffer() : data;
      const result = await window.electronAPI.saveFile(ab, filename, mimeType);
      if (!result.canceled) return result;
    } catch (_) {} // fall through to browser method
  }
  // Browser: blob URL download
  const blob = data instanceof Blob ? data : new Blob([data], { type: mimeType });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement("a");
  a.href = url; a.download = filename;
  a.style.display = "none";
  document.body.appendChild(a); a.click();
  setTimeout(() => { document.body.removeChild(a); URL.revokeObjectURL(url); }, 2000);
}

export function fmtBytes(b) {
  if (b < 1024) return `${b} B`;
  if (b < 1048576) return `${(b/1024).toFixed(1)} KB`;
  if (b < 1073741824) return `${(b/1048576).toFixed(2)} MB`;
  return `${(b/1073741824).toFixed(2)} GB`;
}

// ─── AVI JPEG QUALITY PRESETS ────────────────────────────────────────────────
// 0.10 was the original default. Looked like someone smeared vaseline on the lens.
// Destroyed pixel edges, corrupted decodes. Absolutely terrible. What was I thinking.
// VHS itself degrades the image way more than JPEG at 0.80+, so STANDARD is fine.
export const AVI_QUALITY = {
  compact:  { q: 0.70, label: "COMPACT",  desc: "~15 KB/frame — smallest AVI, slight edge blur" },
  standard: { q: 0.85, label: "STANDARD", desc: "~30 KB/frame — sweet spot for real VHS playback" },
  maximum:  { q: 0.95, label: "MAXIMUM",  desc: "~55 KB/frame — pixel-perfect, chonky files" },
};

// ─── DURATION / TAPE / AVI SIZE UTILITIES ────────────────────────────────────
// All the boring-but-necessary math for UI display.
export function formatDuration(seconds) {
  if (!seconds || seconds <= 0) return "0s";
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.ceil(seconds % 60);
  if (h > 0) return `${h}h ${String(m).padStart(2, "0")}m ${String(s).padStart(2, "0")}s`;
  if (m > 0) return `${m}m ${String(s).padStart(2, "0")}s`;
  return `${s}s`;
}

export function estimateTapeUsage(totalSeconds, tapeMins = 120) {
  const tapeSec = tapeMins * 60;
  const pct = Math.round((totalSeconds / tapeSec) * 1000) / 10;
  return { pct, fits: totalSeconds <= tapeSec, tapeMins, remaining: Math.max(0, tapeSec - totalSeconds) };
}

// Rough AVI size estimate based on empirical JPEG sizes for 640×480 B/W block patterns
export function estimateAviSize(totalFrames, quality = 0.85) {
  const kbPerFrame = quality < 0.75 ? 15 : quality < 0.90 ? 30 : quality < 0.96 ? 55 : 80;
  return totalFrames * kbPerFrame * 1024;
}
