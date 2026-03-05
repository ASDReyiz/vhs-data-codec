// ─── VHSCodec.jsx  VHS Data Codec V14 ───────────────────────────────────────
// The UI layer. All the actual codec logic lives in vhs-codec.js.
// This file is just buttons, dropzones, progress bars, and vibes.
// Built with React because I'm not a masochist (most days).
// ─────────────────────────────────────────────────────────────────────────────

import { useState, useRef, useEffect, useCallback } from "react";
import {
  VERSION, CW, CH, PRESETS, presetById,
  getPresetLayout, getPayloadTotalVFrames, getTotalRealFrames,
  encodeFrameAt, encodeTestFile,
  buildPayload, buildPayloadLegacy, parsePayload, finalizeAssembled,
  drawRealFrame, drawLeaderFrame, drawPadFrame, isLeaderFrame, isPadFrame,
  detectVhsRegion, readRealFrameFromImageData, readRealFrameFromCanvas,
  mergeFrameVotes, assembleVFrames,
  buildVhsdV5, vhsdV5ToPayload, readVhsdV5, mergeVhsdFiles, buildVhsdFromPayload,
  buildVhslManifest, parseVhslManifest,
  buildAviBlob, extractJpegsFromAvi, drawJpegToCanvas,
  demuxMP4, decodeMP4WithWebCodecs, detectAviPreset, detectPresetFromFrame,
  compressBytes, decompressBytes,
  triggerDownload, fmtBytes, crc16,
  getRegionLayout, deinterleave,
  AVI_QUALITY, formatDuration, estimateTapeUsage, estimateAviSize,
} from "./vhs-codec.js";

// ─── STYLE ───────────────────────────────────────────────────────────────────
// VT323 font + green-on-black = authentic terminal aesthetic.
// Yes, the entire stylesheet is a template literal. Fight me.
const css = `
  @import url('https://fonts.googleapis.com/css2?family=Share+Tech+Mono&family=VT323&display=swap');
  *{box-sizing:border-box;margin:0;padding:0;}
  :root{--green:#00ff55;--dim:#007722;--dark:#003311;--bg:#030803;--panel:#050f05;}
  body{background:var(--bg);}
  .app{min-height:100vh;background:var(--bg);color:var(--green);font-family:'Share Tech Mono',monospace;padding:16px;position:relative;}
  .app::before{content:'';position:fixed;inset:0;pointer-events:none;z-index:999;
    background:repeating-linear-gradient(0deg,transparent,transparent 2px,rgba(0,0,0,0.07) 2px,rgba(0,0,0,0.07) 4px);}
  .app::after{content:'';position:fixed;inset:0;pointer-events:none;z-index:998;
    background:radial-gradient(ellipse at center,transparent 60%,rgba(0,0,0,0.6) 100%);}
  .title{font-family:'VT323',monospace;font-size:42px;color:var(--green);
    text-shadow:0 0 15px var(--green),0 0 35px #00aa33;letter-spacing:4px;text-align:center;margin-bottom:2px;}
  .subtitle{text-align:center;color:#004d22;font-size:11px;letter-spacing:3px;margin-bottom:20px;}
  .tabs{display:flex;border-bottom:1px solid var(--dark);margin-bottom:16px;gap:2px;}
  .tab{padding:7px 18px;cursor:pointer;color:#005c1f;font-family:'VT323',monospace;font-size:18px;
    letter-spacing:1px;border:1px solid transparent;border-bottom:none;transition:all .15s;}
  .tab.active{color:var(--green);border-color:var(--dark);border-bottom:1px solid var(--bg);
    text-shadow:0 0 8px var(--green);background:var(--bg);}
  .tab:hover:not(.active){color:#00cc44;}
  .panel{max-width:860px;margin:0 auto;}
  .dropzone{border:1px dashed var(--dark);padding:32px;text-align:center;cursor:pointer;
    transition:all .2s;color:#005c1f;position:relative;min-width:200px;}
  .dropzone:hover,.dropzone.drag{border-color:#00aa44;color:#00cc44;background:#020d02;}
  .dropzone input{position:absolute;inset:0;opacity:0;cursor:pointer;width:100%;height:100%;}
  .dz-icon{font-size:28px;margin-bottom:6px;}
  .dz-text{font-size:12px;letter-spacing:1px;}
  .stats{border:1px solid var(--dark);padding:12px;margin:10px 0;font-size:11px;
    display:grid;grid-template-columns:1fr 1fr;gap:6px;}
  .stat{display:flex;justify-content:space-between;gap:12px;}
  .sl{color:#005c1f;}.sv{color:var(--green);}
  .sv.warn{color:#ffaa00;}.sv.err{color:#ff4400;}.sv.ok{color:#00ff55;}
  .canvas-wrap{border:1px solid var(--dark);display:inline-block;
    box-shadow:0 0 20px rgba(0,255,85,.06);margin:10px 0;position:relative;}
  canvas{display:block;width:640px;height:480px;image-rendering:pixelated;}
  .canvas-wrap:fullscreen,.canvas-wrap:-webkit-full-screen{
    background:#000;display:flex;align-items:center;justify-content:center;
    width:100vw;height:100vh;border:none;box-shadow:none;margin:0;padding:0;}
  .canvas-wrap:fullscreen canvas,.canvas-wrap:-webkit-full-screen canvas{
    width:auto;height:100vh;max-width:133.33vh;image-rendering:pixelated;}
  .fs-btn{position:absolute;top:6px;right:6px;background:rgba(0,0,0,.8);
    border:1px solid var(--dark);color:#005c1f;font-family:'Share Tech Mono',monospace;
    font-size:10px;padding:3px 7px;cursor:pointer;letter-spacing:1px;z-index:10;}
  .fs-btn:hover{border-color:var(--green);color:var(--green);}
  .ctrl{display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin:10px 0;}
  .btn{padding:7px 16px;background:transparent;border:1px solid var(--dark);color:#00bb44;
    cursor:pointer;font-family:'Share Tech Mono',monospace;font-size:11px;letter-spacing:1px;
    transition:all .15s;text-transform:uppercase;}
  .btn:hover{border-color:var(--green);color:var(--green);background:#020d02;box-shadow:0 0 8px rgba(0,255,85,.1);}
  .btn:disabled{opacity:.25;cursor:not-allowed;}
  .btn.primary{border-color:#00aa44;color:var(--green);}
  .btn.danger{border-color:#991a00;color:#ff4400;}
  .btn.warn{border-color:#aa5500;color:#ff8800;}
  .sel{background:#000;border:1px solid var(--dark);color:#00cc44;padding:5px 8px;
    font-family:'Share Tech Mono',monospace;font-size:11px;letter-spacing:1px;}
  .sel option{background:#000;}
  .num-in{background:#000;border:1px solid var(--dark);color:#00cc44;width:60px;padding:4px 8px;
    font-family:inherit;font-size:11px;text-align:center;}
  .bar-wrap{height:3px;background:var(--dark);margin:8px 0;}
  .bar{height:100%;background:var(--green);transition:width .1s;box-shadow:0 0 6px var(--green);}
  .fc{font-family:'VT323',monospace;font-size:26px;color:var(--green);
    text-shadow:0 0 8px var(--green);letter-spacing:2px;}
  .log{border:1px solid #001a09;padding:10px;font-size:10px;color:var(--dim);
    max-height:140px;overflow-y:auto;margin:10px 0;background:#020702;}
  .ll{margin:2px 0;}.ll.ok{color:#00aa44;}.ll.err{color:#cc2200;}.ll.warn{color:#cc8800;}
  .dl-btn{display:inline-block;padding:10px 24px;border:1px solid #00cc44;color:var(--green);
    background:#010801;cursor:pointer;font-family:'VT323',monospace;font-size:22px;
    letter-spacing:2px;text-shadow:0 0 8px var(--green);animation:pulse 2s infinite;margin:8px 4px 8px 0;}
  @keyframes pulse{0%,100%{box-shadow:0 0 8px rgba(0,255,85,.15);}50%{box-shadow:0 0 18px rgba(0,255,85,.4);}}
  .sec{color:#003d1a;font-size:10px;letter-spacing:3px;text-transform:uppercase;
    margin:14px 0 6px;border-bottom:1px solid #001a09;padding-bottom:3px;}
  .tip{font-size:11px;color:#004d22;line-height:1.7;border-left:2px solid #001a09;padding-left:10px;margin:8px 0;}
  .blink{animation:blink 1s step-end infinite;}
  @keyframes blink{0%,100%{opacity:1}50%{opacity:0}}
  .crc-ok{color:#00ff55;font-size:13px;text-shadow:0 0 8px #00ff55;}
  .crc-err{color:#ff4400;font-size:13px;}
  label{font-size:11px;color:var(--dim);letter-spacing:1px;}
  .preset-grid{display:flex;gap:8px;margin-bottom:10px;flex-wrap:wrap;}
  .preset-card{background:#020702;border:1px solid #003311;padding:10px 14px;color:#007722;
    font-size:11px;cursor:pointer;transition:all .15s;min-width:140px;flex:1;}
  .preset-card:hover,.preset-card.active{border-color:#00aa44;color:#00ff55;background:#030f03;}
  .preset-card .p-label{font-size:13px;font-family:'VT323',monospace;letter-spacing:1px;margin-bottom:2px;}
  .preset-card .p-tier{font-size:9px;color:#005500;letter-spacing:2px;text-transform:uppercase;}
  .preset-card .p-desc{font-size:9px;color:#004411;margin-top:4px;line-height:1.4;}
  .preset-card.active .p-tier{color:#00aa44;}
  .preset-card.active .p-desc{color:#007722;}
  .file-table{width:100%;border-collapse:collapse;font-size:10px;margin:8px 0;}
  .file-table th{text-align:left;color:#004d22;padding:4px 8px;border-bottom:1px solid #001a09;letter-spacing:1px;}
  .file-table td{padding:4px 8px;border-bottom:1px solid #001a09;color:#007722;}
  .file-table td.ok{color:#00ff55;}
  .file-table td.err{color:#ff4400;}
  .manifest-box{border:1px solid #003311;background:#020702;padding:12px;margin:10px 0;font-size:10px;
    color:#006622;max-height:200px;overflow-y:auto;font-family:'Share Tech Mono',monospace;white-space:pre-wrap;}
`;

// ─── MAIN ─────────────────────────────────────────────────────────────────────
// The app shell. Four tabs. That's it. That's the whole architecture.
export default function VHSCodec() {
  const [tab, setTab] = useState("encode");
  const isDesktop = typeof window !== "undefined" && window.electronAPI?.isElectron;
  return (
    <>
      <style>{css}</style>
      <div className="app">
        <div className="title">▶ VHS DATA CODEC ◀</div>
        <div className="subtitle">
          {VERSION} // VHSD v5 // RS(255,223) ECC // MULTI-PASS MERGE // GUARD BANDS // VHS MARGINS
          {isDesktop && <span style={{color:"#00aa44"}}> // DESKTOP</span>}
        </div>
        <div className="panel">
          <div className="tabs">
            {["encode","decode","test","info"].map(t => (
              <div key={t} className={`tab ${tab===t?"active":""}`} onClick={()=>setTab(t)}>
                {t==="encode"?"[ ENCODE → TAPE ]":t==="decode"?"[ TAPE → DECODE ]":t==="test"?"[ SELF TEST ]":"[ INFO ]"}
              </div>
            ))}
          </div>
          {tab==="encode" && <EncoderTab />}
          {tab==="decode" && <DecoderTab />}
          {tab==="test"   && <SelfTestTab />}
          {tab==="info"   && <InfoTab />}
        </div>
      </div>
    </>
  );
}

// ─── PRESET SELECTOR ─────────────────────────────────────────────────────────
// Four buttons. SAFE for grandma's tapes, TURBO for the fearless.
// Most people should use EXPRESS and call it a day.
function PresetSelector({ activeKey, onSelect, disabled }) {
  return (
    <div className="preset-grid">
      {Object.entries(PRESETS).map(([key, p]) => (
        <div key={key}
          className={`preset-card ${activeKey===key?"active":""} ${disabled?"":"clickable"}`}
          onClick={() => !disabled && onSelect(key)}
          style={disabled?{opacity:0.5,cursor:"not-allowed"}:{}}>
          <div className="p-label">{p.label}</div>
          <div className="p-tier">{p.tier} — {p.capacity}</div>
          <div className="p-desc">{p.desc}</div>
        </div>
      ))}
    </div>
  );
}

// ─── LAYOUT STATS ────────────────────────────────────────────────────────────
function LayoutStats({ presetLayout, preset }) {
  const { region, effectiveBYTESPF, mode, strips } = presetLayout;
  const throughput = (effectiveBYTESPF * preset.fps / 1024).toFixed(1);
  const marginPx = (preset.margin || 0) * preset.blockSize;

  return (
    <div className="stats" style={{gridTemplateColumns:"1fr 1fr 1fr 1fr"}}>
      <div className="stat"><span className="sl">BLOCK</span><span className="sv">{preset.blockSize}px</span></div>
      <div className="stat"><span className="sl">GRID</span><span className="sv">{region.USABLE_COLS}×{region.DATA_ROWS} ({mode}{strips>1?` ${strips}×`:""})</span></div>
      <div className="stat"><span className="sl">GUARD + MARGIN</span>
        <span className={`sv ${preset.margin?"ok":"warn"}`}>
          {preset.guard?`${preset.guard}col`:"off"} + {preset.margin?`${preset.margin}row (${marginPx}px)`:"off"}
        </span></div>
      <div className="stat"><span className="sl">THROUGHPUT</span><span className="sv ok">~{throughput} KB/s @ {preset.fps}fps</span></div>
    </div>
  );
}

// ─── FILE STRUCTURE TABLE ────────────────────────────────────────────────────
function FileStructureTable({ files, stats }) {
  if (!files || files.length === 0) return null;
  return (
    <table className="file-table">
      <thead>
        <tr>
          <th>#</th><th>FILENAME</th><th>TYPE</th><th>ORIGINAL</th><th>STORED</th><th>COMPRESSED</th><th>CRC16</th>
        </tr>
      </thead>
      <tbody>
        {files.map((f, i) => {
          const ext = f.name.split('.').pop().toUpperCase();
          const s = stats?.[i];
          return (
            <tr key={i}>
              <td>{i+1}</td>
              <td style={{color:"#00cc44"}}>{f.name}</td>
              <td>{ext}</td>
              <td>{fmtBytes(f.data ? f.data.length : f.size)}</td>
              <td>{s ? fmtBytes(s.storedSize) : "—"}</td>
              <td className={s?.compressed ? "ok" : ""}>{s ? (s.compressed ? "YES" : "NO") : "—"}</td>
              <td style={{fontFamily:"monospace"}}>{f.data ? "0x"+crc16(f.data).toString(16).padStart(4,'0').toUpperCase() : "—"}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

// ─── ENCODER TAB ─────────────────────────────────────────────────────────────
// Drop files → pick preset → encode → download .VHSD or generate AVI.
// The AVI goes on the tape. The .VHSD is the compact version for storage.
// This is where the magic happens. Well, the encoding magic anyway.
function EncoderTab() {
  const [files, setFiles]           = useState([]);
  const [fileDatas, setFileDatas]   = useState([]);
  const [presetKey, setPresetKey]   = useState("express");
  const [fileInfo, setFileInfo]     = useState(null);
  const [stats, setStats]           = useState(null);
  const [playing, setPlaying]       = useState(false);
  const [curFrame, setCur]          = useState(0);
  const [drag, setDrag]             = useState(false);
  const [genState, setGenState]     = useState(null);
  const [vhsdStats, setVhsdStats]   = useState(null);
  const [aviQuality, setAviQuality] = useState("standard");
  const [encLog, setEncLog]         = useState([]);
  const addLog = (msg, type="info") => setEncLog(p => [...p.slice(-30), {msg, type}]);

  const canvasRef   = useRef(null);
  const intervalRef = useRef(null);
  const abortRef    = useRef(false);
  const payloadRef  = useRef(null);

  const preset       = PRESETS[presetKey];
  const presetLayout = getPresetLayout(preset);
  const busy         = !!genState;

  const recompute = useCallback(async (datas, pk) => {
    if (!datas.length) return;
    const p  = PRESETS[pk];
    const pl = getPresetLayout(p);
    const { payload, stats: st } = await buildPayload(datas, true);
    payloadRef.current = payload;
    setStats(st);

    const totalVF     = getPayloadTotalVFrames(payload.length, pl.region);
    const totalFrames = getTotalRealFrames(payload.length, pl);
    const totalOrig   = datas.reduce((s, d) => s + d.data.length, 0);
    const leaderFrames = p.fps * 2; // 2 seconds of leader

    setFileInfo({ totalFrames, totalVF, payloadSize: payload.length, totalOrig, leaderFrames });
    setCur(0); setVhsdStats(null);

    setTimeout(() => {
      if (canvasRef.current && payload.length > 0) {
        drawRealFrame(canvasRef.current, payload, 0, totalVF, pl);
      }
    }, 50);
  }, []);

  const loadFiles = async (fileList) => {
    stopPlay();
    setFiles(fileList);
    addLog(`Loading ${fileList.length} file(s)...`, "info");
    const datas = [];
    for (let i = 0; i < fileList.length; i++) {
      const f = fileList[i];
      addLog(`Reading ${f.name} (${fmtBytes(f.size)})...`, "info");
      await new Promise(r => setTimeout(r, 0)); // yield to UI
      const buf = new Uint8Array(await f.arrayBuffer());
      datas.push({ name: f.name, data: buf });
    }
    setFileDatas(datas);
    addLog("Building payload...", "info");
    await new Promise(r => setTimeout(r, 0));
    await recompute(datas, presetKey);
    addLog("Ready.", "ok");
  };

  useEffect(() => {
    if (fileDatas.length) recompute(fileDatas, presetKey);
  }, [presetKey]); // eslint-disable-line

  const startPlay = useCallback(() => {
    const payload = payloadRef.current;
    if (!payload) return;
    setPlaying(true);
    const p  = PRESETS[presetKey];
    const pl = getPresetLayout(p);
    const totalVF     = getPayloadTotalVFrames(payload.length, pl.region);
    const totalFrames = getTotalRealFrames(payload.length, pl);
    let f = 0;
    intervalRef.current = setInterval(() => {
      if (!canvasRef.current) return;
      drawRealFrame(canvasRef.current, payload, f, totalVF, pl);
      setCur(f);
      f = (f + 1) % totalFrames;
    }, 1000 / p.fps);
  }, [presetKey]);

  const stopPlay = useCallback(() => {
    setPlaying(false);
    clearInterval(intervalRef.current);
  }, []);

  const generateAvi = async () => {
    const payload = payloadRef.current;
    if (!payload || busy) return;
    stopPlay(); abortRef.current = false;

    const p  = PRESETS[presetKey];
    const pl = getPresetLayout(p);
    const totalVF     = getPayloadTotalVFrames(payload.length, pl.region);
    const totalFrames = getTotalRealFrames(payload.length, pl);
    const padCount    = p.fps;       // 1 second black at start
    const leaderCount = p.fps * 2;   // 2 seconds checkerboard
    const padEndCount = p.fps;       // 1 second black at end
    const grandTotal  = padCount + leaderCount + totalFrames + padEndCount;
    const cvs = canvasRef.current;
    const baseName = files.length === 1 ? files[0].name : `vhs_archive_${files.length}files`;
    const quality = AVI_QUALITY[aviQuality].q;

    addLog(`AVI: ${grandTotal.toLocaleString()} frames (${padCount}pad + ${leaderCount}leader + ${totalFrames}data + ${padEndCount}pad) — single file`, "info");

    const jpegFrames = [];

    // ── Cache pad frame JPEG (identical for all pad frames) ──────────
    drawPadFrame(cvs);
    const padBlob = await new Promise(r => cvs.toBlob(r, "image/jpeg", quality));
    const padJpeg = new Uint8Array(await padBlob.arrayBuffer());

    // ── Cache leader frame JPEGs (each unique, but only fps*2 of them) ──
    const leaderJpegs = [];
    for (let i = 0; i < leaderCount; i++) {
      drawLeaderFrame(cvs, i, leaderCount);
      const blob = await new Promise(r => cvs.toBlob(r, "image/jpeg", quality));
      leaderJpegs.push(new Uint8Array(await blob.arrayBuffer()));
    }
    setGenState({ cur: padCount + leaderCount, total: grandTotal, phase: "LEADER CACHED" });
    await new Promise(r => setTimeout(r, 0));

    // ── Build frame array: pad → leader → data → pad ─────────────────
    // Pad start (reuse cached)
    for (let i = 0; i < padCount; i++) jpegFrames.push(padJpeg);

    // Leader (reuse cached)
    for (let i = 0; i < leaderCount; i++) jpegFrames.push(leaderJpegs[i]);

    // Data frames (unique, must render each)
    for (let i = 0; i < totalFrames; i++) {
      if (abortRef.current) { setGenState(null); addLog("Cancelled.", "warn"); return; }
      drawRealFrame(cvs, payload, i, totalVF, pl);
      const blob = await new Promise(r => cvs.toBlob(r, "image/jpeg", quality));
      jpegFrames.push(new Uint8Array(await blob.arrayBuffer()));

      if (i % 50 === 0) {
        setGenState({ cur: padCount + leaderCount + i + 1, total: grandTotal, phase: "RENDERING" });
        await new Promise(r => setTimeout(r, 0));
      }
    }

    // Pad end (reuse cached)
    for (let i = 0; i < padEndCount; i++) jpegFrames.push(padJpeg);

    // ── Build AVI blob (streaming — no monolithic copy) ──────────────
    setGenState({ cur: grandTotal, total: grandTotal, phase: "BUILDING AVI" });
    await new Promise(r => setTimeout(r, 0));
    const aviBlob = buildAviBlob(jpegFrames, p.fps, CW, CH);
    triggerDownload(aviBlob, `${baseName}_vhs.avi`, "video/avi");
    setGenState(null);
    addLog(`✓ ${fmtBytes(aviBlob.size)} AVI — single file, ${grandTotal.toLocaleString()} frames`, "ok");
  };

  const generateVhsd = async () => {
    const payload = payloadRef.current;
    if (!payload || busy || !fileDatas.length) return;
    setVhsdStats({ building: true });

    const result = await buildVhsdV5(fileDatas, preset, 2);
    setVhsdStats({
      compressed: result.compressed,
      originalSize: result.originalSize,
      compressedSize: result.compressedSize,
      stats: result.stats,
    });
    const baseName = files.length === 1 ? files[0].name : `vhs_archive_${files.length}files`;
    triggerDownload(result.buf, `${baseName}.vhsd`, "application/octet-stream");
  };

  const generateVhsl = () => {
    if (!fileInfo || !fileDatas.length) return;
    const manifest = buildVhslManifest(fileDatas, stats, preset, fileInfo.totalFrames, fileInfo.totalVF, fileInfo.payloadSize);
    const baseName = files.length === 1 ? files[0].name : `vhs_archive_${files.length}files`;
    triggerDownload(new TextEncoder().encode(manifest), `${baseName}.vhsl`, "application/json");
  };

  useEffect(() => () => { clearInterval(intervalRef.current); abortRef.current = true; }, []);

  const wrapRef = useRef(null);
  const toggleFS = () => {
    const el = wrapRef.current;
    if (!el) return;
    if (!document.fullscreenElement && !document.webkitFullscreenElement)
      (el.requestFullscreen || el.webkitRequestFullscreen).call(el);
    else (document.exitFullscreen || document.webkitExitFullscreen).call(document);
  };

  const genProgress = genState ? genState.cur / genState.total : 0;
  const saved = fileInfo && fileInfo.totalOrig > 0
    ? Math.round((1 - fileInfo.payloadSize / fileInfo.totalOrig) * 100) : 0;

  return (
    <div>
      <div className="sec">01 // SELECT PRESET (EXPRESS = DEFAULT)</div>
      <PresetSelector activeKey={presetKey} onSelect={setPresetKey} disabled={playing||busy} />

      <div className="sec">02 // LAYOUT STATS</div>
      <LayoutStats presetLayout={presetLayout} preset={preset} />

      <div className="sec">03 // SELECT FILE(S)</div>
      <div className="tip">
        Drop single or multiple files. Multi-file packs into one VHSD archive.
        Compressible files get DEFLATE'd automatically.
      </div>
      <div className={`dropzone ${drag?"drag":""}`}
        onDragOver={e=>{e.preventDefault();setDrag(true)}}
        onDragLeave={()=>setDrag(false)}
        onDrop={e=>{e.preventDefault();setDrag(false);const fs=[...e.dataTransfer.files];if(fs.length)loadFiles(fs);}}>
        <input type="file" multiple onChange={e=>{const fs=[...e.target.files];if(fs.length)loadFiles(fs);}} />
        <div className="dz-icon">📼</div>
        <div className="dz-text">
          {files.length === 0
            ? "DROP ANY FILE(S) or CLICK TO BROWSE"
            : files.length === 1
              ? `LOADED: ${files[0].name} (${fmtBytes(files[0].size)})`
              : `LOADED: ${files.length} files — ${fmtBytes(files.reduce((s,f)=>s+f.size,0))} total`}
        </div>
      </div>

      {fileDatas.length > 0 && stats && (
        <>
          <div className="sec">04 // FILE STRUCTURE</div>
          <FileStructureTable files={fileDatas} stats={stats} />
        </>
      )}

      {fileInfo && (
        <>
          <div className="sec">05 // ENCODE SUMMARY</div>
          {(() => {
            const dataSec = Math.ceil(fileInfo.totalFrames / preset.fps);
            const totalSec = dataSec + 4; // 1s pad + 2s leader + data + 1s pad
            const tape120 = estimateTapeUsage(totalSec, 120);
            const tape160 = estimateTapeUsage(totalSec, 160);
            const aviSize = estimateAviSize(fileInfo.totalFrames + preset.fps * 4, AVI_QUALITY[aviQuality].q);
            return <>
              <div className="stats" style={{gridTemplateColumns:"1fr 1fr 1fr"}}>
                <div className="stat"><span className="sl">FILES</span><span className="sv">{fileDatas.length}</span></div>
                <div className="stat"><span className="sl">ORIGINAL</span><span className="sv">{fmtBytes(fileInfo.totalOrig)}</span></div>
                <div className="stat"><span className="sl">PAYLOAD</span>
                  <span className={`sv ${saved>10?"ok":""}`}>{fmtBytes(fileInfo.payloadSize)}{saved>10?` (${saved}% smaller)`:""}</span></div>
                <div className="stat"><span className="sl">REAL FRAMES</span><span className="sv">{fileInfo.totalFrames.toLocaleString()}</span></div>
                <div className="stat"><span className="sl">VIRTUAL FRAMES</span><span className="sv">{fileInfo.totalVF.toLocaleString()}</span></div>
                <div className="stat"><span className="sl">DURATION</span>
                  <span className="sv ok">{formatDuration(dataSec)} data + 2s leader + 2s pad = {formatDuration(totalSec)}</span></div>
              </div>
              <div className="stats" style={{gridTemplateColumns:"1fr 1fr 1fr",marginTop:0}}>
                <div className="stat"><span className="sl">T-120 TAPE</span>
                  <span className={`sv ${tape120.fits?"ok":"err"}`}>
                    {tape120.fits ? `✓ ${tape120.pct}% used — ${formatDuration(tape120.remaining)} free` : `✗ ${tape120.pct}% — OVERFLOW`}
                  </span></div>
                <div className="stat"><span className="sl">T-160 TAPE</span>
                  <span className={`sv ${tape160.fits?"ok":"warn"}`}>
                    {tape160.fits ? `✓ ${tape160.pct}% used` : `✗ ${tape160.pct}% — OVERFLOW`}
                  </span></div>
                <div className="stat"><span className="sl">EST. AVI SIZE</span>
                  <span className={`sv ${aviSize>100*1024*1024?"err":aviSize>50*1024*1024?"warn":"ok"}`}>
                    ~{fmtBytes(aviSize)} ({AVI_QUALITY[aviQuality].label})
                  </span></div>
              </div>
            </>;
          })()}

          {vhsdStats && !vhsdStats.building && (
            <div className="stats" style={{gridTemplateColumns:"1fr 1fr 1fr",marginTop:0}}>
              <div className="stat"><span className="sl">OUTER COMPRESS</span>
                <span className={`sv ${vhsdStats.compressed?"ok":"warn"}`}>
                  {vhsdStats.compressed?"DEFLATE":"STORED RAW"}</span></div>
              <div className="stat"><span className="sl">VHSD SIZE</span>
                <span className="sv ok">{fmtBytes(vhsdStats.compressedSize+32)}</span></div>
              <div className="stat"><span className="sl">SAVED</span>
                <span className="sv ok">{vhsdStats.originalSize>0?`${Math.round((1-vhsdStats.compressedSize/vhsdStats.originalSize)*100)}%`:"0%"}</span></div>
            </div>
          )}

          <div className="sec">06 // EXPORT</div>
          <div className="ctrl" style={{alignItems:"flex-start"}}>
            <div style={{display:"flex",gap:6,flexDirection:"column"}}>
              <label>AVI QUALITY:</label>
              <div style={{display:"flex",gap:4}}>
                {Object.entries(AVI_QUALITY).map(([k, v]) => (
                  <button key={k}
                    className={`btn ${aviQuality===k?"primary":""}`}
                    style={{padding:"4px 10px",fontSize:"10px",
                      borderColor: aviQuality===k?"#00aa44":"#003311",
                      color: aviQuality===k?"#00ff55":"#005522"}}
                    onClick={() => setAviQuality(k)}
                    disabled={playing||busy}>
                    {v.label}
                  </button>
                ))}
              </div>
              <span style={{fontSize:"9px",color:"#004411"}}>{AVI_QUALITY[aviQuality].desc}</span>
            </div>
          </div>
          {(() => {
            const aviFrames = (fileInfo?.totalFrames || 0) + preset.fps * 4;
            return <>
              <div className="ctrl">
                {!playing && !busy && <>
                  <button className="btn primary" onClick={startPlay}>▶ PREVIEW</button>
                  <button className="btn primary" onClick={generateVhsd} style={{fontWeight:"bold"}}>💾 SAVE .VHSD</button>
                  <button className="btn primary" onClick={generateVhsl}>📋 .VHSL</button>
                  <button className="btn primary" onClick={generateAvi}>
                    🎥 GENERATE AVI
                  </button>
                </>}
                {playing && !busy && <button className="btn danger" onClick={stopPlay}>■ STOP</button>}
                {busy && <button className="btn danger" onClick={()=>{abortRef.current=true;}}>■ CANCEL</button>}
              </div>
            </>;
          })()}
          <div className="tip" style={{marginTop:4}}>
            <strong>.VHSD</strong> = compact binary (instant, any size). <strong>AVI</strong> = tape-ready video.
          </div>

          {playing && !busy && <>
            <div className="bar-wrap"><div className="bar" style={{width:`${((curFrame+1)/fileInfo.totalFrames)*100}%`}}/></div>
            <div className="fc">FRAME {String(curFrame+1).padStart(4,"0")} / {fileInfo.totalFrames.toLocaleString()} <span className="blink">●</span></div>
          </>}
          {busy && <>
            <div className="bar-wrap"><div className="bar" style={{width:`${genProgress*100}%`}}/></div>
            <div className="fc">
              {genState.phase} {genState.cur.toLocaleString()}/{genState.total.toLocaleString()}
              {genState.phase==="BUILDING AVI"?" — PLEASE WAIT":<span className="blink"> ●</span>}
            </div>
          </>}

          {encLog.length > 0 && (
            <div className="log" style={{maxHeight:"80px",overflow:"auto",margin:"4px 0"}}>
              {encLog.map((l,i) => <div key={i} className={`ll ${l.type}`}>{l.msg}</div>)}
            </div>
          )}

          <div className="canvas-wrap" ref={wrapRef}>
            <button className="fs-btn" onClick={toggleFS}>⛶ FULLSCREEN</button>
            <canvas ref={canvasRef} width={CW} height={CH} />
          </div>
        </>
      )}
    </div>
  );
}

// ─── DECODER TAB ─────────────────────────────────────────────────────────────
// The reverse journey. Drop a captured MP4/AVI from your VHS tape,
// and we'll extract your files from the pixel soup.
// Also handles .VHSD direct decode, .VHSL manifest loading,
// VHSD→AVI conversion, and multi-pass merge. It does a lot.
function DecoderTab() {
  const [log, setLog]         = useState([]);
  const [results, setResults] = useState(null);
  const [prog, setProg]       = useState(0);
  const [scanInfo, setScanInfo] = useState(null);
  const [busy, setBusy]       = useState(false);
  const [voteMap, setVMap]    = useState({});
  const [totalVF, setTotalVF] = useState(0);
  const [presetKey, setPresetKey] = useState("express");
  const [detectedInfo, setDetectedInfo] = useState(null);
  const [drag, setDrag]       = useState(false);
  const [showCanvas, setShowCanvas] = useState(true);
  const [mergeFiles, setMergeFiles] = useState([]);
  const [mergeDrag,  setMergeDrag]  = useState(false);
  const [vhsdAviFile, setVhsdAviFile] = useState(null);
  const [vhsdAviBusy, setVhsdAviBusy] = useState(false);
  const [vhsdAviProg, setVhsdAviProg] = useState(0);
  const [vhslData, setVhslData] = useState(null);
  const [aviQuality, setAviQuality] = useState("standard");
  const [capturedPayload, setCapturedPayload] = useState(null);
  const [capturedPresetKey, setCapturedPresetKey] = useState(null);
  const [sourceFilename, setSourceFilename] = useState("");

  const vhsdAviCanvas = useRef(null);
  const canvasRef = useRef(null);
  const videoRef  = useRef(null);
  const logRef    = useRef(null);

  const addLog = (msg, type="info") => setLog(p => [...p.slice(-150), {msg, type}]);

  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  });

  const preset = PRESETS[presetKey];
  const presetLayout = getPresetLayout(preset);

  // ── Virtual frame vote helpers ──────────────────────────────────────────
  // Each frame gets "votes" — if you have multiple captures of the same
  // frame, they all vote on what each bit should be. More votes = more confidence.
  const processVFrame = (res, localVotes, localState) => {
    if (!res || !res.frameBits) return;
    const fn = res.vFrameNum;
    const tv = res.totalVF;
    if (fn === undefined || tv === 0 || fn >= tv) return;
    if (!localVotes[fn]) {
      localVotes[fn] = [];
      if (!localState.totalVF) localState.totalVF = tv;
    }
    localVotes[fn].push(res.frameBits);
  };

  const finalize = async (localVotes, tvf, payloadSize, regionLayout, usedPresetKey) => {
    const found = Object.keys(localVotes).length;
    const totalVotes = Object.values(localVotes).reduce((a,v)=>a+v.length,0);
    addLog(`Scan complete — ${found}/${tvf} virtual frames, ${totalVotes} total votes`, "ok");

    if (found === 0 || tvf === 0) {
      addLog("No codec frames found. Try a different preset.", "err"); return;
    }
    const missing = Array.from({length:tvf},(_,i)=>i).filter(i=>!localVotes[i]);
    if (missing.length) {
      addLog(`Missing ${missing.length} VF(s): ${missing.slice(0,10).join(", ")}${missing.length>10?"…":""}`, "err");
      addLog("Zero-filling missing frames for partial recovery...", "warn");
      for (const f of missing) localVotes[f] = [new Array(regionLayout.BPF).fill(0)];
    }
    addLog("Running Reed-Solomon error correction...", "info");
    const assembled = assembleVFrames(localVotes, tvf, payloadSize, regionLayout);
    if (assembled.error) { addLog(`Assembly error: ${assembled.error}`, "err"); return; }

    // Save raw payload for VHSD capture export (merge workflow)
    if (assembled.rawPayload && usedPresetKey) {
      setCapturedPayload(assembled.rawPayload);
      setCapturedPresetKey(usedPresetKey);
    }

    if (assembled.rsErrors > 0) {
      addLog(`RS: ${assembled.rsFixed} blocks corrected, ${assembled.rsFailed} uncorrectable`, assembled.rsFailed > 0 ? "warn" : "ok");
    } else {
      addLog("RS: no errors detected — clean decode", "ok");
    }

    const fileResults = await finalizeAssembled(assembled);
    fileResults.forEach(r => {
      if (r.error) { addLog(`File error: ${r.error}`, "err"); return; }
      addLog(`✓ "${r.filename}" (${fmtBytes(r.fileData.length)}) | CRC ${r.crcOk?"PASS ✓":"FAIL ✗"}`, r.crcOk?"ok":"warn");
    });
    if (missing.length && fileResults.some(r => !r.crcOk))
      addLog(`CRC failed — ${missing.length} missing VF(s) caused corruption.`, "warn");

    // Suggest merge workflow if CRC fails
    if (fileResults.some(r => !r.crcOk)) {
      addLog("TIP: Save this capture as .VHSD, record the tape again, and merge multiple captures for error correction.", "info");
    }

    setResults(fileResults.filter(r => !r.error));
  };

  // ── PATH A: AVI ─────────────────────────────────────────────────────────
  // Our own AVI format. Extract JPEGs → decode frames → reconstruct data.
  // Auto-detects which preset was used. The easy path.
  const processAvi = async (file) => {
    addLog("AVI detected → extracting frames...", "info");
    const ab = await file.arrayBuffer();
    const jpegs = extractJpegsFromAvi(ab);
    if (!jpegs || jpegs.length === 0) {
      addLog("Could not extract frames from AVI.", "err"); setBusy(false); return;
    }
    addLog(`Extracted ${jpegs.length} JPEG frames`, "ok");

    // Auto-detect preset from first non-leader frame
    addLog("Auto-detecting preset...", "info");
    const detected = await detectAviPreset(ab);
    if (detected) {
      setPresetKey(detected.key);
      addLog(`Auto-detected preset: ${detected.key.toUpperCase()}`, "ok");
    } else {
      addLog("Could not auto-detect — using selected preset", "warn");
    }

    const pk = detected ? detected.key : presetKey;
    const p  = PRESETS[pk];
    const pl = getPresetLayout(p);
    const localVotes = {};
    const localState = { totalVF: 0 };
    let leaderSkipped = 0, padSkipped = 0;

    for (let i = 0; i < jpegs.length; i++) {
      try { await drawJpegToCanvas(jpegs[i], canvasRef.current); }
      catch { addLog(`JPEG ${i} failed — skipping`, "warn"); continue; }

      const ctx = canvasRef.current.getContext("2d");
      const img = ctx.getImageData(0, 0, CW, CH);

      // Skip pad frames (solid black at start/end)
      if (isPadFrame(img, CW, CH)) { padSkipped++; setProg(Math.round(((i+1)/jpegs.length)*100)); continue; }

      // Check for leader frame (only in first ~3 seconds worth of frames)
      const maxLeaderFrames = p.fps * 3;
      if (i < maxLeaderFrames + padSkipped) {
        if (isLeaderFrame(img, CW, CH)) {
          leaderSkipped++;
          setProg(Math.round(((i+1)/jpegs.length)*100));
          setScanInfo({ cur: i+1, total: jpegs.length, mode: "LEADER SKIP" });
          continue;
        }
      }
      const regionResults = readRealFrameFromImageData(img, CW, CH, pl);

      if (p.mode === "panel" && (p.panelCols > 1 || p.panelRows > 1)) {
        // Panel mode: all regions carry same VF — merge as votes
        for (const r of regionResults) processVFrame(r, localVotes, localState);
      } else if (p.mode === "strip" && p.strips > 1) {
        // Strip mode: each region carries different VF
        for (const r of regionResults) processVFrame(r, localVotes, localState);
      } else {
        // Single: one region
        processVFrame(regionResults[0], localVotes, localState);
      }

      setProg(Math.round(((i+1)/jpegs.length)*100));
      setScanInfo({ cur: i+1, total: jpegs.length, mode: `AVI ${p.mode.toUpperCase()}` });
      setVMap({...localVotes}); setTotalVF(localState.totalVF);
      await new Promise(r => setTimeout(r, 0));
    }

    if (leaderSkipped > 0 || padSkipped > 0)
      addLog(`Skipped ${padSkipped} pad + ${leaderSkipped} leader frames`, "info");
    const tvf = localState.totalVF;
    const payloadSize = tvf * pl.region.BYTESPF;
    await finalize(localVotes, tvf, payloadSize, pl.region, pk);
    setBusy(false);
  };

  // ── PATH B: MP4/MOV/WebM ────────────────────────────────────────────────
  // The real-world path. User records VHS playback with a capture card,
  // gets an MP4. We try WebCodecs first (fast, hardware-accelerated),
  // fall back to HTML5 <video> + canvas (slow but works everywhere).
  // Now with auto-detect! No more "wrong preset" frustration.
  const processVideoFile = async (file) => {
    addLog("Video file detected — trying WebCodecs...", "info");
    let detectedKey = null;
    let p  = PRESETS[presetKey];
    let pl = getPresetLayout(p);
    const localVotes = {};
    const localState = { totalVF: 0 };
    let frameIdx = 0, leaderSkipped = 0, padSkipped = 0;
    let autoDetectDone = false;

    const onFrame = async (img, W, H, progress) => {
      frameIdx++;

      // Skip pad frames (solid black)
      if (isPadFrame(img, W, H)) { padSkipped++; setProg(Math.round(progress*100)); return; }

      // Leader detection (first ~3 seconds worth)
      const maxLeaderCheck = Math.max(60, p.fps * 4);
      if (frameIdx <= maxLeaderCheck + padSkipped && isLeaderFrame(img, W, H)) {
        leaderSkipped++;
        setProg(Math.round(progress*100));
        return;
      }

      // Auto-detect preset from first data frame
      if (!autoDetectDone) {
        autoDetectDone = true;
        const det = detectPresetFromFrame(img, W, H);
        if (det && det.key !== presetKey) {
          detectedKey = det.key;
          p = det.preset;
          pl = getPresetLayout(p);
          setPresetKey(det.key);
          addLog(`Auto-detected preset: ${det.key.toUpperCase()}`, "ok");
        }
      }

      const regionResults = readRealFrameFromImageData(img, W, H, pl);
      for (const r of regionResults) processVFrame(r, localVotes, localState);

      setProg(Math.round(progress*100));
      setScanInfo({ cur: frameIdx, total: "?", mode: "WEBCODECS" });
      setVMap({...localVotes});
      setTotalVF(localState.totalVF);
    };

    const wcOk = await decodeMP4WithWebCodecs(file, canvasRef.current, addLog, onFrame);

    if (!wcOk) {
      addLog("Falling back to HTML5 video...", "warn");
      const url   = URL.createObjectURL(file);
      const video = videoRef.current;
      video.src = url; video.load();
      const metaOk = await Promise.race([
        new Promise(r => video.addEventListener("loadedmetadata",()=>r(true),{once:true})),
        new Promise(r => video.addEventListener("error",()=>r(false),{once:true})),
        new Promise(r => setTimeout(()=>r(false),10000)),
      ]);
      if (!metaOk||!video.duration||video.duration===Infinity) {
        addLog("HTML5 video failed","err");
        URL.revokeObjectURL(url); setBusy(false); return;
      }
      const vW=video.videoWidth||CW, vH=video.videoHeight||CH;
      addLog(`HTML5 video: ${vW}×${vH}, ${video.duration.toFixed(1)}s`,"info");
      canvasRef.current.width=vW; canvasRef.current.height=vH;
      const ctx=canvasRef.current.getContext("2d");
      const times=[];
      for(let t=0;t<video.duration;t+=0.1) times.push(+t.toFixed(2));
      for(let i=0;i<times.length;i++){
        video.currentTime=times[i];
        await new Promise(r=>{video.onseeked=r;});
        ctx.drawImage(video,0,0,vW,vH);
        await onFrame(ctx.getImageData(0,0,vW,vH),vW,vH,(i+1)/times.length);
        await new Promise(r=>setTimeout(r,0));
      }
      canvasRef.current.width=CW; canvasRef.current.height=CH;
      URL.revokeObjectURL(url);
    }

    if (leaderSkipped > 0 || padSkipped > 0)
      addLog(`Skipped ${padSkipped} pad + ${leaderSkipped} leader frames`, "info");
    const usedKey = detectedKey || presetKey;
    const tvf = localState.totalVF;
    const payloadSize = tvf * pl.region.BYTESPF;
    await finalize(localVotes, tvf, payloadSize, pl.region, usedKey);
    setBusy(false);
  };

  // ── PATH C: VHSD ───────────────────────────────────────────────────────
  // Direct decode from our binary format. Instant. No frame scanning needed.
  // This is what you get when you save a .VHSD from the encoder.
  const processVhsd = async (file) => {
    addLog("VHSD format detected", "info");
    const ab  = await file.arrayBuffer();
    const buf = new Uint8Array(ab);

    if (buf.length < 20 || String.fromCharCode(buf[0],buf[1],buf[2],buf[3]) !== "VHSD") {
      addLog("Invalid VHSD file", "err"); setBusy(false); return;
    }

    const version = buf[4];
    addLog(`VHSD v${version} detected`, "info");

    const enc = await vhsdV5ToPayload(buf);
    if (enc.error) { addLog(enc.error, "err"); setBusy(false); return; }

    // Auto-apply settings
    const detectedPresetKey = Object.entries(PRESETS).find(([,p]) => p.id === enc.presetId)?.[0];
    if (detectedPresetKey) {
      setPresetKey(detectedPresetKey);
      addLog(`Auto-applied preset: ${detectedPresetKey.toUpperCase()}`, "ok");
    }
    setDetectedInfo({
      blockSize: enc.blockSize, fps: enc.fps,
      strips: enc.strips, panelCols: enc.panelCols, panelRows: enc.panelRows,
      mode: enc.mode, leaderSec: enc.leaderSec, margin: enc.safeMargin || 0,
      frameW: enc.frameW, frameH: enc.frameH,
    });

    addLog(`blockSize=${enc.blockSize}px | mode=${enc.mode} | fps=${enc.fps} | margin=${enc.safeMargin||0} | ${enc.numFiles} file(s)`, "info");

    const fileResults = await readVhsdV5(buf);
    if (fileResults.error) { addLog(fileResults.error, "err"); setBusy(false); return; }
    const arr = Array.isArray(fileResults) ? fileResults : [fileResults];
    arr.forEach(r => {
      if (r.error) addLog(r.error, "err");
      else addLog(`✓ "${r.filename}" (${fmtBytes(r.fileData.length)}) | CRC ${r.crcOk?"PASS ✓":"FAIL ✗"}`, r.crcOk?"ok":"warn");
    });
    setResults(arr.filter(r => !r.error));
    setProg(100);
    setScanInfo({ cur: 1, total: 1, mode: `VHSD v${version}` });
    setBusy(false);
  };

  // ── PATH D: VHSD → AVI ─────────────────────────────────────────────────
  // Got a .VHSD but need a tape-ready AVI? This re-renders every frame
  // with pad frames, leader, data, and builds a fresh AVI.
  // Now with cached pad/leader JPEGs so we're not re-encoding the same
  // black frame 60 times like an idiot (which we used to do).
  const generateAviFromVhsd = async (file) => {
    setVhsdAviBusy(true); setVhsdAviProg(0);
    const ab  = await file.arrayBuffer();
    const buf = new Uint8Array(ab);
    const enc = await vhsdV5ToPayload(buf);
    if (enc.error) { addLog(enc.error, "err"); setVhsdAviBusy(false); return; }

    const { payload, payloadSize, presetLayout: pl, fps, totalFrames, totalVF, leaderSec } = enc;
    const padCount    = fps;                        // 1s black at start
    const leaderCount = (leaderSec || 2) * fps;     // leader checkerboard
    const padEndCount = fps;                        // 1s black at end
    const grandTotal  = padCount + leaderCount + totalFrames + padEndCount;

    const cvs = vhsdAviCanvas.current;
    cvs.width = CW; cvs.height = CH;
    const quality = AVI_QUALITY[aviQuality].q;
    const jpegFrames = [];

    // Cache pad frame JPEG (identical for all pad frames)
    drawPadFrame(cvs);
    const padBlob = await new Promise(r => cvs.toBlob(r, "image/jpeg", quality));
    const padJpeg = new Uint8Array(await padBlob.arrayBuffer());

    // Cache leader frame JPEGs
    const leaderJpegs = [];
    for (let i = 0; i < leaderCount; i++) {
      drawLeaderFrame(cvs, i, leaderCount);
      const blob = await new Promise(r => cvs.toBlob(r, "image/jpeg", quality));
      leaderJpegs.push(new Uint8Array(await blob.arrayBuffer()));
    }
    setVhsdAviProg(Math.round(((padCount + leaderCount) / grandTotal) * 80));

    // Pad start (reuse cached)
    for (let i = 0; i < padCount; i++) jpegFrames.push(padJpeg);
    // Leader (reuse cached)
    for (let i = 0; i < leaderCount; i++) jpegFrames.push(leaderJpegs[i]);

    // Data frames (unique, must render each)
    for (let i = 0; i < totalFrames; i++) {
      drawRealFrame(cvs, payload, i, totalVF, pl);
      const blob = await new Promise(r => cvs.toBlob(r, "image/jpeg", quality));
      jpegFrames.push(new Uint8Array(await blob.arrayBuffer()));
      if (i % 50 === 0) {
        setVhsdAviProg(Math.round(((padCount + leaderCount + i + 1) / grandTotal) * 80));
        await new Promise(r => setTimeout(r, 0));
      }
    }

    // Pad end (reuse cached)
    for (let i = 0; i < padEndCount; i++) jpegFrames.push(padJpeg);

    addLog("Building AVI blob...", "info");
    setVhsdAviProg(90); await new Promise(r => setTimeout(r, 0));
    const aviBlob = buildAviBlob(jpegFrames, fps, CW, CH);
    setVhsdAviProg(100);
    triggerDownload(aviBlob, file.name.replace(/\.vhsd$/i, "") + "_tape.avi", "video/avi");
    addLog(`✓ ${fmtBytes(aviBlob.size)} AVI single file (${padCount}pad + ${leaderCount}leader + ${totalFrames}data + ${padEndCount}pad)`, "ok");
    setVhsdAviBusy(false);
  };

  // ── PATH E: VHSL manifest ──────────────────────────────────────────────
  // Just loads the JSON manifest and shows what files to expect.
  // No actual decoding. It's a receipt, not a decoder.
  const processVhsl = async (file) => {
    addLog("VHSL manifest detected", "info");
    const text = await file.text();
    const manifest = parseVhslManifest(text);
    if (manifest.error) { addLog(manifest.error, "err"); setBusy(false); return; }
    setVhslData(manifest);
    addLog(`Manifest: ${manifest.files.length} file(s), preset=${manifest.preset?.name}, ${manifest.frame?.totalReal} real frames`, "ok");
    if (manifest.preset?.name && PRESETS[manifest.preset.name]) {
      setPresetKey(manifest.preset.name);
      addLog(`Auto-applied preset: ${manifest.preset.name.toUpperCase()}`, "ok");
    }
    setBusy(false);
  };

  // ── PATH F: VHSD merge ────────────────────────────────────────────────
  // Drop 2-3 .VHSD captures of the same tape. Majority vote + RS = resilience.
  // This is how TURBO preset survives real VHS tapes.
  const processMerge = async (files) => {
    setBusy(true); setResults(null); setVMap({}); setTotalVF(0); setProg(0); setScanInfo(null); setLog([]);
    setCapturedPayload(null); setCapturedPresetKey(null);
    addLog(`Merging ${files.length} VHSD files...`, "info");
    const result = await mergeVhsdFiles(files);
    if (result.error) { addLog(`Merge error: ${result.error}`, "err"); setBusy(false); return; }
    const { voteMap: lv, totalVF: tvf, payloadSize, region } = result;
    const totalVotes = Object.values(lv).reduce((a,v)=>a+v.length,0);
    addLog(`Merged — ${totalVotes} total votes across ${Object.keys(lv).length}/${tvf} frames`, "ok");
    setVMap(lv); setTotalVF(tvf);
    setProg(100); setScanInfo({ cur: tvf, total: tvf, mode: "VHSD MERGE" });
    await finalize(lv, tvf, payloadSize, region, presetKey);
    setBusy(false);
  };

  // ── SAVE CAPTURE AS .VHSD (for merge workflow) ─────────────────────────
  // After decoding an MP4/AVI, the user can save the raw decoded payload
  // as a .VHSD. Record the tape again → decode again → save again →
  // merge all captures. It's tedious but it works miraculously well.
  const saveCaptureAsVhsd = async () => {
    if (!capturedPayload || !capturedPresetKey) return;
    const p = PRESETS[capturedPresetKey];
    addLog("Building capture VHSD...", "info");
    const buf = await buildVhsdFromPayload(capturedPayload, p, 2);
    const filename = `${sourceFilename || "capture"}_${capturedPresetKey}.vhsd`;
    triggerDownload(buf, filename, "application/octet-stream");
    addLog(`✓ Saved ${filename} (${fmtBytes(buf.length)}) — use for merge with other captures`, "ok");
  };

  const processFile = async (file) => {
    setBusy(true);
    setResults(null); setVMap({});
    setTotalVF(0); setProg(0); setScanInfo(null); setLog([]); setVhslData(null);
    setCapturedPayload(null); setCapturedPresetKey(null);
    setSourceFilename(file.name.replace(/\.[^.]+$/, ""));
    addLog(`File: ${file.name} (${fmtBytes(file.size)})`, "info");
    const ext = file.name.split('.').pop().toLowerCase();
    if (ext==="vhsd")     await processVhsd(file);
    else if (ext==="vhsl") await processVhsl(file);
    else if (ext==="avi") await processAvi(file);
    else                  await processVideoFile(file);
  };

  const found      = Object.keys(voteMap).length;
  const totalVotes = Object.values(voteMap).reduce((a,v)=>a+v.length,0);
  const avgVotes   = (totalVotes/Math.max(1,found)).toFixed(1);

  return (
    <div>
      <div className="sec">01 // PRESET (auto-applied from VHSD/VHSL)</div>
      <PresetSelector activeKey={presetKey} onSelect={setPresetKey} disabled={busy} />

      {detectedInfo && (
        <div className="stats" style={{gridTemplateColumns:"1fr 1fr 1fr 1fr 1fr",margin:"4px 0"}}>
          <div className="stat"><span className="sl">MODE</span><span className="sv ok">{detectedInfo.mode}</span></div>
          <div className="stat"><span className="sl">BLOCK</span><span className="sv ok">{detectedInfo.blockSize}px</span></div>
          <div className="stat"><span className="sl">FPS</span><span className="sv ok">{detectedInfo.fps}</span></div>
          <div className="stat"><span className="sl">STRIPS</span><span className="sv ok">{detectedInfo.strips}×</span></div>
          <div className="stat"><span className="sl">MARGIN</span><span className={`sv ${detectedInfo.margin?"ok":"warn"}`}>{detectedInfo.margin||0} row/edge</span></div>
          <div className="stat"><span className="sl">LEADER</span><span className="sv ok">{detectedInfo.leaderSec||0}s</span></div>
        </div>
      )}

      {vhslData && (
        <>
          <div className="sec">EXPECTED FILES (from .VHSL manifest)</div>
          <table className="file-table">
            <thead><tr><th>#</th><th>FILENAME</th><th>TYPE</th><th>SIZE</th><th>CRC16</th><th>COMPRESSED</th></tr></thead>
            <tbody>
              {vhslData.files.map((f, i) => (
                <tr key={i}>
                  <td>{i+1}</td>
                  <td style={{color:"#00cc44"}}>{f.name}</td>
                  <td>{f.type?.toUpperCase()}</td>
                  <td>{fmtBytes(f.size)}</td>
                  <td style={{fontFamily:"monospace"}}>{f.crc16}</td>
                  <td>{f.compressed?"YES":"NO"}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="stats" style={{gridTemplateColumns:"1fr 1fr 1fr",margin:"4px 0"}}>
            <div className="stat"><span className="sl">PRESET</span><span className="sv">{vhslData.preset?.name?.toUpperCase()}</span></div>
            <div className="stat"><span className="sl">FRAMES</span><span className="sv">{vhslData.frame?.totalReal}</span></div>
            <div className="stat"><span className="sl">ENCODED</span><span className="sv">{vhslData.created?.split('T')[0]}</span></div>
          </div>
        </>
      )}

      <div className="sec">02 // DECODE CAPTURE</div>
      <div className="tip">
        <strong>.mp4 / .avi / video</strong> → decode VHS capture via WebCodecs / RIFF parse.<br/>
        <strong>.vhsd</strong> → instant decode from binary archive.<br/>
        <strong>.vhsl</strong> → load manifest to verify expected files before decoding.<br/>
        After decoding, save as .VHSD for merge workflow (record tape 2-3× → merge for error correction).
      </div>
      <div className={`dropzone ${drag?"drag":""}`}
        onDragOver={e=>{e.preventDefault();setDrag(true)}}
        onDragLeave={()=>setDrag(false)}
        onDrop={e=>{e.preventDefault();setDrag(false);const f=e.dataTransfer.files[0];if(f)processFile(f);}}>
        <input type="file" accept=".vhsd,.vhsl,.avi,video/*"
          onChange={e=>e.target.files[0]&&processFile(e.target.files[0])} disabled={busy} />
        <div className="dz-icon">{busy?"⏳":"📼"}</div>
        <div className="dz-text">
          {busy ? (scanInfo ? `[${scanInfo.mode}] ${scanInfo.cur}/${scanInfo.total}` : "LOADING...") : "DROP .VHSD / .VHSL / .AVI / VIDEO"}
        </div>
      </div>

      <div className="sec">03 // .VHSD → TAPE-READY AVI</div>
      <div className="tip">Drop a .vhsd to regenerate the AVI with leader frames, without re-encoding.</div>
      <div className="ctrl" style={{margin:"4px 0"}}>
        <label>AVI QUALITY:</label>
        {Object.entries(AVI_QUALITY).map(([k, v]) => (
          <button key={k}
            className={`btn ${aviQuality===k?"primary":""}`}
            style={{padding:"3px 8px",fontSize:"9px",
              borderColor: aviQuality===k?"#00aa44":"#003311",
              color: aviQuality===k?"#00ff55":"#005522"}}
            onClick={() => setAviQuality(k)}
            disabled={vhsdAviBusy}>
            {v.label}
          </button>
        ))}
      </div>
      <div className="dropzone" style={{minHeight:60,opacity:vhsdAviBusy?0.7:1}}
        onDragOver={e=>e.preventDefault()}
        onDrop={e=>{e.preventDefault();const f=e.dataTransfer.files[0];if(f&&f.name.toLowerCase().endsWith('.vhsd')){setVhsdAviFile(f);generateAviFromVhsd(f);}}}>
        <input type="file" accept=".vhsd" disabled={vhsdAviBusy}
          onChange={e=>{const f=e.target.files[0];if(f){setVhsdAviFile(f);generateAviFromVhsd(f);}}} />
        <div className="dz-icon">{vhsdAviBusy?"⏳":"📼"}</div>
        <div className="dz-text">{vhsdAviBusy?`RENDERING AVI... ${vhsdAviProg}%`:"DROP .VHSD → TAPE-READY AVI"}</div>
      </div>
      {vhsdAviBusy && <div className="bar-wrap"><div className="bar" style={{width:`${vhsdAviProg}%`}}/></div>}
      <canvas ref={vhsdAviCanvas} width={CW} height={CH} style={{display:"none"}} />

      <div className="sec">04 // MULTI-PASS MERGE (ERROR CORRECTION)</div>
      <div className="tip">
        <strong>Merge workflow:</strong> Record same tape 2-3 times → decode each capture → save each as .VHSD → drop all .VHSD files here.<br/>
        Majority-vote across captures corrects dropout errors that RS alone cannot fix. Essential for TURBO preset on real tapes.
      </div>
      <div className={`dropzone ${mergeDrag?"drag":""}`} style={{minHeight:60}}
        onDragOver={e=>{e.preventDefault();setMergeDrag(true)}}
        onDragLeave={()=>setMergeDrag(false)}
        onDrop={e=>{
          e.preventDefault();setMergeDrag(false);
          const files=[...e.dataTransfer.files].filter(f=>f.name.toLowerCase().endsWith('.vhsd'));
          if(files.length>=2){setMergeFiles(files);processMerge(files);}
          else addLog("Drop 2+ .vhsd files for merge","err");
        }}>
        <input type="file" accept=".vhsd" multiple disabled={busy}
          onChange={e=>{const files=[...e.target.files];if(files.length>=2){setMergeFiles(files);processMerge(files);}else addLog("Select 2+ .vhsd files for merge","err");}} />
        <div className="dz-icon">⊕</div>
        <div className="dz-text">{mergeFiles.length>=2?`MERGED: ${mergeFiles.map(f=>f.name).join(" + ")}`:"DROP 2+ CAPTURE .VHSD FILES TO MERGE"}</div>
      </div>

      {showCanvas ? (
        <div style={{margin:"10px 0"}}>
          <div className="sec" style={{marginBottom:4}}>
            LIVE FRAME PREVIEW
            {scanInfo&&<span style={{color:"#00ff55",marginLeft:8,fontSize:"11px"}}>[{scanInfo.mode}]</span>}
            <button className="btn" onClick={()=>setShowCanvas(false)}
              style={{float:"right",padding:"2px 8px",fontSize:"9px",marginTop:-2}}>HIDE</button>
          </div>
          <div style={{border:"1px solid var(--dark)",display:"inline-block",position:"relative"}}>
            <canvas ref={canvasRef} width={CW} height={CH}
              style={{display:"block",width:320,height:240,imageRendering:"pixelated"}} />
            {busy&&<div style={{position:"absolute",bottom:4,right:6,fontFamily:"'VT323',monospace",fontSize:"16px",
              color:"#00ff55",textShadow:"0 0 6px #00ff55",background:"rgba(0,0,0,0.7)",padding:"2px 6px"}}>
              SCANNING {prog}%</div>}
          </div>
        </div>
      ) : (
        <>
          <canvas ref={canvasRef} width={CW} height={CH} style={{display:"none"}} />
          <button className="btn" onClick={()=>setShowCanvas(true)} style={{fontSize:"9px",margin:"6px 0"}}>SHOW PREVIEW</button>
        </>
      )}

      <video ref={videoRef} preload="auto" playsInline muted
        style={{position:"fixed",top:"-9999px",left:"-9999px",width:"1px",height:"1px",opacity:0,pointerEvents:"none"}} />

      {busy && <>
        <div className="bar-wrap"><div className="bar" style={{width:`${prog}%`}}/></div>
        <div className="fc">
          {scanInfo?.mode||"LOADING"} — {prog}%
          {found>0&&<span style={{fontSize:"16px",marginLeft:12,color:"#00cc44"}}>{found}/{totalVF||"?"} VF</span>}
          <span className="blink"> ●</span>
        </div>
      </>}

      {totalVF > 0 && (
        <div className="stats" style={{gridTemplateColumns:"1fr 1fr 1fr"}}>
          <div className="stat"><span className="sl">TOTAL VF</span><span className="sv">{totalVF}</span></div>
          <div className="stat"><span className="sl">FOUND</span>
            <span className={`sv ${found===totalVF?"ok":"warn"}`}>{found}</span></div>
          <div className="stat"><span className="sl">MISSING</span>
            <span className={`sv ${totalVF-found>0?"err":"ok"}`}>{totalVF-found}</span></div>
          <div className="stat"><span className="sl">VOTES</span><span className="sv">{totalVotes}</span></div>
          <div className="stat"><span className="sl">AVG VOTES</span>
            <span className={`sv ${parseFloat(avgVotes)>=1?"ok":"warn"}`}>{avgVotes}×</span></div>
          <div className="stat"><span className="sl">STATUS</span>
            <span className={`sv ${found===totalVF?"ok":"err"}`}>{found===totalVF?"COMPLETE":"INCOMPLETE"}</span></div>
        </div>
      )}

      {log.length > 0 && <>
        <div className="sec">05 // DECODE LOG</div>
        <div className="log" ref={logRef}>
          {log.map((l,i)=><div key={i} className={`ll ${l.type}`}>&gt; {l.msg}</div>)}
        </div>
      </>}

      {results && results.length > 0 && <>
        <div className="sec">06 // RESULT{results.length>1?"S":""}</div>
        {results.map((r, i) => (
          <div key={i}>
            <div className="stats">
              <div className="stat"><span className="sl">FILENAME</span><span className="sv">{r.filename}</span></div>
              <div className="stat"><span className="sl">SIZE</span><span className="sv">{fmtBytes(r.fileData.length)}</span></div>
              <div className="stat"><span className="sl">CRC16</span>
                <span className={r.crcOk?"crc-ok":"crc-err"}>
                  {r.crcOk?"✓ PASS — FILE INTACT":"✗ FAIL — DATA CORRUPTED"}</span></div>
              <div className="stat"><span className="sl">TYPE</span>
                <span className="sv">{r.filename.split(".").pop().toUpperCase()}</span></div>
            </div>
            {!r.crcOk&&<div className="tip" style={{borderColor:"#441100",color:"#884400",margin:"4px 0"}}>
              CRC failed — uncorrectable errors. Save as .VHSD, record again, and merge multiple captures.</div>}
            <button className="dl-btn" onClick={()=>triggerDownload(r.fileData,r.filename,"application/octet-stream")}>
              ▼ DOWNLOAD {r.filename.toUpperCase()}
            </button>
          </div>
        ))}

        {capturedPayload && capturedPresetKey && (
          <div style={{margin:"12px 0",padding:"12px",border:"1px solid #005522",background:"#010d01"}}>
            <div style={{fontSize:"11px",color:"#00aa44",marginBottom:8,letterSpacing:"1px"}}>
              💾 SAVE THIS CAPTURE AS .VHSD FOR MULTI-PASS MERGE
            </div>
            <div className="tip" style={{margin:"0 0 8px",fontSize:"10px"}}>
              Record the same tape 2-3 times, decode each MP4, save each as .VHSD, then merge all captures above for majority-vote error correction.
            </div>
            <button className="dl-btn" style={{fontSize:"18px",padding:"8px 20px"}} onClick={saveCaptureAsVhsd}>
              💾 SAVE CAPTURE .VHSD ({capturedPresetKey.toUpperCase()})
            </button>
          </div>
        )}
      </>}
    </div>
  );
}

// ─── SELF TEST TAB ───────────────────────────────────────────────────────────
// Paranoia mode. Encodes 256 bytes, draws frames with noise, reads them back,
// RS-decodes, and checks every single byte. If this passes, the codec works.
// If it doesn't, something is catastrophically wrong and I need more coffee.
function SelfTestTab() {
  const [status, setStatus]     = useState(null);
  const [busy, setBusy]         = useState(false);
  const [log, setLog]           = useState([]);
  const [presetKey, setPresetKey] = useState("express");
  const [noiseLevel, setNoise]  = useState(30);
  const [allResults, setAllResults] = useState(null);
  const canvasRef = useRef(null);
  const addLog = (msg, type="info") => setLog(p => [...p, {msg, type}]);

  const runSingleTest = async (pk, noise, addLogFn) => {
    const preset = PRESETS[pk];
    const pl     = getPresetLayout(preset);
    const { region } = pl;

    const testData = new Uint8Array(256);
    for (let i = 0; i < 256; i++) testData[i] = i;
    const testName = "selftest_allbytes.bin";

    addLogFn(`[${pk.toUpperCase()}] Encoding 256 bytes | block=${region.blockSize}px | mode=${preset.mode} | guard=${preset.guard} | noise=±${noise}`, "info");
    const encoded = encodeTestFile(testData, testName, region);
    addLogFn(`→ ${encoded.totalVF} virtual frames (${region.BYTESPF} bytes/VF)`, "ok");

    const canvas = canvasRef.current;
    const ctx    = canvas.getContext("2d");
    const voteMap = {};
    let failedReads = 0;

    for (let f = 0; f < encoded.totalVF; f++) {
      drawRealFrame(canvas, encoded.payload, f, encoded.totalVF, pl);

      if (noise > 0) {
        const imgData = ctx.getImageData(0, 0, CW, CH);
        for (let i = 0; i < imgData.data.length; i += 4) {
          const n = (Math.random() - 0.5) * noise * 2;
          imgData.data[i]   = Math.max(0, Math.min(255, imgData.data[i]   + n));
          imgData.data[i+1] = Math.max(0, Math.min(255, imgData.data[i+1] + n));
          imgData.data[i+2] = Math.max(0, Math.min(255, imgData.data[i+2] + n));
        }
        ctx.putImageData(imgData, 0, 0);
      }

      const results = readRealFrameFromCanvas(canvas, pl);
      let gotAny = false;
      for (const r of results) {
        if (r) {
          if (!voteMap[r.vFrameNum]) voteMap[r.vFrameNum] = [];
          voteMap[r.vFrameNum].push(r.frameBits);
          gotAny = true;
        }
      }
      if (!gotAny) failedReads++;
      await new Promise(r => setTimeout(r, 0));
    }

    if (failedReads > 0) addLogFn(`${failedReads} frame(s) unreadable`, "warn");

    const assembled = assembleVFrames(voteMap, encoded.totalVF, encoded.payloadSize, region);
    if (assembled.error) { addLogFn(`Assembly error: ${assembled.error}`, "err"); return false; }

    let bytesOk = false, crcOk = false;
    if (assembled.v1) {
      const lenOk = assembled.fileData.length === testData.length;
      bytesOk = lenOk && assembled.fileData.every((b,i) => b === testData[i]);
      crcOk = assembled.crcOk;
    }

    if (bytesOk && crcOk) {
      addLogFn(`[${pk.toUpperCase()}] ✓ ALL 256 BYTES + CRC PASS`, "ok");
      return true;
    } else {
      if (assembled.v1 && assembled.fileData) {
        const bad = assembled.fileData.reduce((n,b,i) => n+(b!==testData[i]?1:0), 0);
        addLogFn(`[${pk.toUpperCase()}] ✗ ${bad}/256 bytes wrong, CRC ${crcOk?"PASS":"FAIL"}`, "err");
      }
      return false;
    }
  };

  const runTest = async () => {
    setBusy(true); setStatus(null); setLog([]); setAllResults(null);
    const result = await runSingleTest(presetKey, noiseLevel, addLog);
    setStatus(result ? "pass" : "fail");
    setBusy(false);
  };

  const runAllTests = async () => {
    setBusy(true); setStatus(null); setLog([]); setAllResults(null);
    const results = {};
    for (const [pk] of Object.entries(PRESETS)) {
      addLog(`━━━ TESTING ${pk.toUpperCase()} ━━━`, "info");
      results[pk] = await runSingleTest(pk, noiseLevel, addLog);
      await new Promise(r => setTimeout(r, 50));
    }
    setAllResults(results);
    const allPass = Object.values(results).every(v => v);
    setStatus(allPass ? "pass" : "fail");
    addLog(allPass ? "━━━ ALL 4 PRESETS PASSED ✓ ━━━" : "━━━ SOME PRESETS FAILED ✗ ━━━", allPass?"ok":"err");
    setBusy(false);
  };

  return (
    <div>
      <div className="sec">CODEC SELF TEST</div>
      <div className="tip">
        Full pipeline: encode 256 bytes (0x00–0xFF), draw with guard bands + footer sync + all modes (panel/strip/single), add noise, read back, RS-decode, verify every byte and CRC.
      </div>
      <div className="ctrl">
        <label>PRESET:</label>
        <select className="sel" value={presetKey} onChange={e=>setPresetKey(e.target.value)} disabled={busy}>
          {Object.entries(PRESETS).map(([k,p]) => (
            <option key={k} value={k}>{p.label}</option>
          ))}
        </select>
        <label>NOISE ±:</label>
        <input className="num-in" type="number" value={noiseLevel} min={0} max={80}
          onChange={e=>setNoise(Math.max(0,Math.min(80,parseInt(e.target.value)||0)))} disabled={busy} />
        <button className="btn primary" onClick={runTest} disabled={busy}>
          {busy?"RUNNING...":"▶ RUN SINGLE TEST"}
        </button>
        <button className="btn" onClick={runAllTests} disabled={busy}
          style={{borderColor:"#005522",color:"#00aa44"}}>
          ▶▶ TEST ALL 4 PRESETS
        </button>
      </div>
      <canvas ref={canvasRef} width={CW} height={CH} style={{display:"none"}} />
      {log.length > 0 && <>
        <div className="sec">TEST LOG</div>
        <div className="log" style={{maxHeight:"200px"}}>
          {log.map((l,i)=><div key={i} className={`ll ${l.type}`}>&gt; {l.msg}</div>)}
        </div>
      </>}
      {status && (
        <div style={{margin:"16px 0",padding:"16px",
          border:`1px solid ${status==="pass"?"#004422":"#441100"}`,
          background:status==="pass"?"#010801":"#080101"}}>
          {status==="pass"
            ? <span className="crc-ok" style={{fontSize:"18px"}}>✓ ALL TESTS PASSED — CODEC WORKING CORRECTLY</span>
            : <span className="crc-err" style={{fontSize:"18px"}}>✗ TEST FAILED — SEE LOG</span>}
        </div>
      )}
      {allResults && (
        <div className="stats" style={{gridTemplateColumns:"1fr 1fr 1fr 1fr",marginTop:4}}>
          {Object.entries(PRESETS).map(([pk, p]) => (
            <div key={pk} className="stat" style={{flexDirection:"column",alignItems:"center",gap:4}}>
              <span style={{fontSize:"10px",color:"#005522"}}>{p.label}</span>
              <span className={allResults[pk]?"crc-ok":"crc-err"} style={{fontSize:"14px"}}>
                {allResults[pk]?"✓ PASS":"✗ FAIL"}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── INFO TAB ────────────────────────────────────────────────────────────────
// Capacity tables, how-to guide, format specs. The "README" of the app.
function InfoTab() {
  return (
    <div style={{lineHeight:"1.8",fontSize:"12px",color:"#007722"}}>
      <div className="sec">CAPACITY TABLE (T-160 / SP MODE)</div>
      <div className="tip">
        {Object.entries(PRESETS).map(([pk, p]) => {
          const pl = getPresetLayout(p);
          const kbs = (pl.effectiveBYTESPF * p.fps / 1024).toFixed(1);
          return (
            <span key={pk}>
              <strong>{p.label}:</strong> {p.blockSize}px | {p.fps}fps | ~{kbs} KB/s | {p.capacity}<br/>
            </span>
          );
        })}
        <br/>
        <strong>Error correction:</strong> Reed-Solomon RS(255,223) — corrects up to 16 byte errors per 255-byte block.<br/>
        <strong>Bit interleaving:</strong> Spreads data across frame so burst errors don't kill whole RS blocks.<br/>
        <strong>Multi-pass merge:</strong> Record tape 2-3× → majority vote across captures for extra resilience.
      </div>

      <div className="sec">HOW TO USE</div>
      <div className="tip">
        1. ENCODE → drop file(s) → choose preset → SAVE .VHSD<br/>
        2. Generate AVI → play on TV via media player → record to VHS tape<br/>
        3. Play back tape → capture with USB capture card → save as MP4<br/>
        4. DECODE → drop MP4 → download recovered files
      </div>

      <div className="sec">MULTI-PASS MERGE (for damaged tapes or TURBO)</div>
      <div className="tip">
        1. Record the same tape 2-3 times on your capture card → save each as separate MP4<br/>
        2. DECODE each MP4 → click "SAVE CAPTURE .VHSD" for each<br/>
        3. Drop all .VHSD files into MERGE section → majority-vote error correction<br/>
        This combines RS(255,223) block-level correction with frame-level voting across captures.
      </div>

      <div className="sec">RUN LOCALLY (BROWSER)</div>
      <div className="tip" style={{fontFamily:"monospace",color:"#007722"}}>
        npm create vite@latest vhs -- --template react && cd vhs<br/>
        <span style={{color:"#005500"}}># Copy vhs-codec.js + VHSCodec.jsx → src/</span><br/>
        npm run dev
      </div>

      <div className="sec">RUN AS DESKTOP APP (ELECTRON)</div>
      <div className="tip" style={{fontFamily:"monospace",color:"#007722"}}>
        <span style={{color:"#005500"}}># All scaffolding files included — just install and run:</span><br/>
        npm install<br/>
        npm run dev:electron <span style={{color:"#005500"}}># → opens desktop app with dev tools</span><br/>
        npm run build:electron <span style={{color:"#005500"}}># → produces installer in release/</span>
      </div>
      <div className="tip" style={{fontSize:"10px",color:"#004411"}}>
        Desktop advantages: native save dialogs (no blob limits), files &gt;2 GB work,
        no browser tab memory pressure, Windows/Mac/Linux installers.
      </div>

      <div className="sec">VHSD v5 HEADER (32 bytes)</div>
      <div className="tip">
        [0..3] "VHSD" | [4] ver=5 | [5] blockSize | [6] fps | [7] numFiles<br/>
        [8] flags | [9] strips | [10] panelRows | [11] panelCols<br/>
        [12..19] origSize + dataSize u32 LE | [20..23] frameW×H<br/>
        [24] leaderSec | [25] guard | [26] presetId | [27] margin
      </div>
    </div>
  );
}
