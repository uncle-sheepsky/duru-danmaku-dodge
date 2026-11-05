// 탄막 리메이크 렌더 — 구간을 워커 N개로 나눠 시크 → JPEG → ffmpeg 파이프. 판정 = 페이지 안 원시 픽셀 해시.
// 사용: node render.mjs [--workers 6] [--pass a] [--from 0 --to 480] [--sha-only] [--crf 16] [--out out/v.mp4]
//       node render.mjs --stills 0,100,200 --out-dir out/stills
import http from 'http';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { spawn } from 'child_process';
import { fileURLToPath, pathToFileURL } from 'url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SERVE = path.resolve(HERE, '..');
const pw = await import('playwright');
const { chromium } = pw.default ?? pw;
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const PASS = arg('--pass', 'a'), F0 = +arg('--from', 0), F1 = +arg('--to', 480), NW = +arg('--workers', 6), SHA_ONLY = process.argv.includes('--sha-only'), CRF = arg('--crf', '16'), STILLS = arg('--stills', null);
const OUT = path.resolve(HERE, arg('--out', `out/video_${PASS}.mp4`));
fs.mkdirSync(path.dirname(OUT), { recursive: true });

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.png': 'image/png', '.jpg': 'image/jpeg', '.json': 'application/json' };
const srv = http.createServer((req, res) => {
  const p = path.join(SERVE, decodeURIComponent(new URL(req.url, 'http://x').pathname));
  if (!p.startsWith(SERVE) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'content-type': MIME[path.extname(p)] || 'application/octet-stream' });
  fs.createReadStream(p).pipe(res);
});
await new Promise(r => srv.listen(0, '127.0.0.1', r));
const URL_ = `http://127.0.0.1:${srv.address().port}/remake/comp.html`;
const FLAGS = ['--disable-lcd-text', '--disable-font-subpixel-positioning', '--force-color-profile=srgb', '--disable-partial-raster', '--disable-skia-runtime-opts', '--disable-gpu-rasterization', '--use-gl=angle', '--use-angle=swiftshader', '--disable-gpu'];

async function open() {
  const browser = await chromium.launch({ args: FLAGS });
  const page = await browser.newPage({ viewport: { width: 1080, height: 1920 }, deviceScaleFactor: 1 });
  const errs = [];
  page.on('pageerror', e => errs.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
  await page.goto(URL_, { waitUntil: 'load' });
  try { await page.waitForFunction('window.__ready === true', null, { timeout: 180000 }); } catch (e) { throw new Error('준비 실패: ' + errs.join(' | ')); }
  if (errs.length) throw new Error('페이지 오류: ' + errs.join(' | '));
  return { browser, page, errs };
}

if (STILLS) {
  const dir = path.resolve(HERE, arg('--out-dir', 'out/stills'));
  fs.mkdirSync(dir, { recursive: true });
  const { browser, page, errs } = await open();
  for (const s of STILLS.split(',')) {
    const f = +s;
    const b64 = await page.evaluate(async ff => { await window.__seekF(ff); return document.getElementById('cv').toDataURL('image/jpeg', 0.92).split(',')[1]; }, f);
    fs.writeFileSync(path.join(dir, `f${String(f).padStart(4, '0')}.jpg`), Buffer.from(b64, 'base64'));
    if (errs.length) throw new Error(errs.join(' | '));
  }
  await browser.close(); srv.close();
  console.log('stills', STILLS);
  process.exit(0);
}

if (process.argv.includes('--bare-peak')) {
  const { browser, page } = await open();
  const b64 = await page.evaluate(() => { window.__barePeak(); return document.getElementById('cv').toDataURL('image/png').split(',')[1]; });
  fs.writeFileSync(path.resolve(HERE, 'assets/prep/bare_peak.png'), Buffer.from(b64, 'base64'));
  await browser.close(); srv.close();
  console.log('bare_peak'); process.exit(0);
}
const shas = {};
const tmp = path.join(os.tmpdir(), 'danmaku_chunks', path.basename(OUT, '.mp4'));
if (!SHA_ONLY) fs.mkdirSync(tmp, { recursive: true });
const per = Math.ceil((F1 - F0) / NW);
let done = 0; const t0 = Date.now();

async function worker(w) {
  const a = F0 + w * per, b = Math.min(F1, a + per);
  if (a >= b) return null;
  const chunk = path.join(tmp, `c${String(w).padStart(2, '0')}.mp4`);
  let ff = null, ffDone = null, sink = async () => {};
  if (!SHA_ONLY) {
    ff = spawn('ffmpeg', ['-v', 'error', '-y', '-f', 'image2pipe', '-c:v', 'mjpeg', '-framerate', '30', '-i', '-',
      '-vf', 'scale=out_color_matrix=bt709:out_range=tv', '-c:v', 'libx264', '-preset', 'medium', '-crf', CRF, '-pix_fmt', 'yuv420p',
      '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-g', '60', '-threads', '2', chunk], { stdio: ['pipe', 'inherit', 'inherit'] });
    ffDone = new Promise((res, rej) => ff.on('close', c => c === 0 ? res() : rej(new Error('ffmpeg ' + c))));
    sink = buf => new Promise(r => { if (ff.stdin.write(buf)) r(); else ff.stdin.once('drain', r); });
  }
  const { browser, page, errs } = await open();
  for (let f = a; f < b; f++) {
    const r = await page.evaluate(async ([ff, enc]) => {
      await window.__seekF(ff);
      const c = document.getElementById('cv');
      const u = new Uint32Array(c.getContext('2d').getImageData(0, 0, c.width, c.height).data.buffer);
      let a = 2166136261, b = 3735928559;
      for (let i = 0; i < u.length; i++) { const v = u[i]; a = Math.imul(a ^ v, 16777619) >>> 0; b = Math.imul(b ^ (v + i), 2246822519) >>> 0; }
      return { h: a.toString(16).padStart(8, '0') + b.toString(16).padStart(8, '0'), j: enc ? c.toDataURL('image/jpeg', 0.97).split(',')[1] : null };
    }, [f, !SHA_ONLY]);
    shas[f] = r.h;
    if (r.j) await sink(Buffer.from(r.j, 'base64'));
    done++;
    if (done % 100 === 0) { const el = (Date.now() - t0) / 1000; process.stdout.write(`  ${done}/${F1 - F0} · ${el.toFixed(0)}s · ${(done / el).toFixed(1)} f/s\n`); }
    if (errs.length) throw new Error(`f${f}: ` + errs.join(' | '));
  }
  await browser.close();
  if (ff) { ff.stdin.end(); await ffDone; }
  return chunk;
}
const chunks = (await Promise.all([...Array(NW).keys()].map(worker))).filter(Boolean);
srv.close();
fs.mkdirSync(path.join(HERE, 'gates'), { recursive: true });
fs.writeFileSync(path.join(HERE, 'gates', `pix_${PASS}.json`), JSON.stringify(shas));
if (!SHA_ONLY) {
  const list = path.join(tmp, 'list.txt');
  fs.writeFileSync(list, chunks.map(c => `file '${path.basename(c)}'`).join('\n'));
  await new Promise((res, rej) => spawn('ffmpeg', ['-v', 'error', '-y', '-f', 'concat', '-safe', '0', '-i', list, '-c', 'copy', '-movflags', '+faststart', OUT], { stdio: 'inherit' }).on('close', c => c === 0 ? res() : rej(new Error('concat ' + c))));
  fs.rmSync(tmp, { recursive: true, force: true });
}
console.log(`완료 ${F1 - F0}f · ${((Date.now() - t0) / 1000).toFixed(1)}s · ${path.relative(HERE, OUT)}`);
