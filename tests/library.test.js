import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { tmpDir, testConfig, baseEnv } from './helpers/env.js';
import { hasFfmpeg } from './helpers/media.js';
import { initLibrary, scanLibrary, refreshLibrary, loadLibraryManifest } from '../src/library/scan.js';
import { generateStarterSfx, RECIPES } from '../src/library/starter.js';
import { SUBCATEGORIES, expandTerm, tokenize } from '../src/library/lexicon.js';
import { fingerprintFile } from '../src/assets/fingerprint.js';
import { loadConfig } from '../src/core/config.js';

test('initLibrary creates the standard structure idempotently and never touches existing files', () => {
  const root = tmpDir();
  const made = initLibrary(root);
  for (const sub of SUBCATEGORIES.SFX) assert.ok(fs.existsSync(path.join(root, 'SFX', sub)), `SFX/${sub}`);
  for (const d of ['MUSIC/CINEMATIC', 'OVERLAYS/DUST', 'GRAPHICS/HUD', 'FONTS', 'LUTS', 'PRESETS', 'TRANSITIONS', 'TEXTURES', 'AE_TEMPLATES']) assert.ok(fs.existsSync(path.join(root, d)), d);
  assert.ok(made.length > 40);
  fs.writeFileSync(path.join(root, 'SFX', 'WHOOSH', 'keep.wav'), 'x');
  assert.equal(initLibrary(root).length, 0);
  assert.equal(fs.readFileSync(path.join(root, 'SFX', 'WHOOSH', 'keep.wav'), 'utf8'), 'x');
});

test('lexicon: tokenizing and synonym expansion', () => {
  assert.deepEqual(tokenize('Fast_Whoosh03.wav'), ['fast', 'whoosh']);
  assert.deepEqual(tokenize('CameraPunchHit_02.wav'), ['camera', 'punch', 'hit']);
  const w = expandTerm('whoosh');
  assert.equal(w.get('whoosh'), 1);
  assert.ok(w.get('swoosh') > 0 && w.get('swoosh') < 1);
});

test('fingerprint: stable, content-sensitive, read-only', () => {
  const d = tmpDir(); const a = path.join(d, 'a.bin'); const b = path.join(d, 'b.bin');
  fs.writeFileSync(a, Buffer.alloc(900000, 7)); fs.writeFileSync(b, Buffer.alloc(900000, 7));
  const before = fs.statSync(a).mtimeMs;
  assert.equal(fingerprintFile(a), fingerprintFile(b));
  fs.appendFileSync(b, 'x');
  assert.notEqual(fingerprintFile(a), fingerprintFile(b));
  assert.equal(fs.statSync(a).mtimeMs, before);
});

test('starter pack -> scan: manifest has categories, tags, energy, recommendations, measured features', { skip: !hasFfmpeg }, async () => {
  const cfg = testConfig({});
  const root = tmpDir();
  const only = ['fast_whoosh_01', 'slow_whoosh_01', 'cinematic_impact_01', 'ui_blip_01', 'dark_drone_01'];
  const files = await generateStarterSfx(cfg, root, { only });
  assert.equal(files.length, 5);
  const m = await scanLibrary(cfg, root);
  assert.equal(m.counts.sfx, 5);
  const by = (n) => m.assets.find((a) => a.file.endsWith(n));
  const fast = by('fast_whoosh_01.wav'); const slow = by('slow_whoosh_01.wav'); const impact = by('cinematic_impact_01.wav'); const ui = by('ui_blip_01.wav'); const drone = by('dark_drone_01.wav');
  assert.equal(fast.category, 'SFX'); assert.equal(fast.subcategory, 'WHOOSH'); assert.equal(fast.type, 'sfx');
  assert.ok(fast.tags.includes('whoosh') && fast.tags.includes('fast') && fast.tags.includes('transition'));
  assert.ok(fast.duration > 0.4 && fast.duration < 0.8 && fast.sampleRate === 48000 && fast.channels === 2);
  assert.ok(fast.recommended_for.includes('velocity'));
  assert.equal(fast.preferred_transition, 'whip');
  assert.ok(impact.energy > fast.energy && fast.energy > ui.energy, `energy ordering impact ${impact.energy} > whoosh ${fast.energy} > ui ${ui.energy}`);
  assert.ok(impact.features.peakDb > -12 && impact.features.attack < 0.1, 'measured: loud, sharp attack');
  assert.ok(impact.tags.includes('sharp'));
  assert.ok(slow.features.attack > fast.features.attack, 'slow whoosh builds slower');
  assert.ok(drone.tags.includes('long') && drone.tags.includes('dark'));
  assert.match(impact.description, /impact/);
  assert.match(impact.description, /sharp attack/);
  for (const a of m.assets) for (const k of ['path', 'type', 'category', 'subcategory', 'duration', 'fps', 'sampleRate', 'resolution', 'orientation', 'tags', 'description', 'intensity', 'energy', 'genre', 'recommended_for', 'preferred_transition', 'preferred_edit_types']) assert.ok(k in a, `${a.file} has ${k}`);
});

test('rescan is incremental, keeps user overrides, flags duplicates; originals are never modified', { skip: !hasFfmpeg }, async () => {
  const cfg = testConfig({});
  const root = tmpDir();
  await generateStarterSfx(cfg, root, { only: ['fast_whoosh_01', 'ui_blip_01'] });
  const before = Object.fromEntries(fs.readdirSync(path.join(root, 'SFX', 'WHOOSH')).filter((f) => f.endsWith('.wav')).map((f) => [f, fs.statSync(path.join(root, 'SFX', 'WHOOSH', f)).mtimeMs]));
  const m1 = await refreshLibrary(cfg, {}).catch(() => null); // no libraryRoot configured -> clear error
  assert.equal(m1, null);
  cfg.libraryRoot = root;
  const first = await refreshLibrary(cfg);
  first.assets.find((a) => a.file.endsWith('ui_blip_01.wav')).override = { energy: 0.9, tags: ['hero-ui'] };
  fs.writeFileSync(cfg.libraryManifest, JSON.stringify(first));
  fs.copyFileSync(path.join(root, 'SFX', 'WHOOSH', 'fast_whoosh_01.wav'), path.join(root, 'SFX', 'WHOOSH', 'fast_whoosh_copy.wav'));
  const second = await refreshLibrary(cfg);
  assert.equal(second.assets.length, 3);
  const ui = second.assets.find((a) => a.file.endsWith('ui_blip_01.wav'));
  assert.equal(ui.energy, 0.9); assert.deepEqual(ui.tags, ['hero-ui']);
  assert.ok(second.assets.some((a) => a.duplicateOf), 'duplicate content detected');
  assert.ok(second.warnings.some((w) => /duplicate/.test(w)));
  assert.equal(loadLibraryManifest(cfg).assets.length, 3);
  for (const [f, t] of Object.entries(before)) assert.equal(fs.statSync(path.join(root, 'SFX', 'WHOOSH', f)).mtimeMs, t, `${f} untouched`);
});

test('paths with spaces and Unicode work end to end', { skip: !hasFfmpeg }, async () => {
  const cfg = testConfig({});
  const root = path.join(tmpDir(), 'Bibliothèque de sons 日本 (v2)');
  await generateStarterSfx(cfg, root, { only: ['ui_blip_01'] });
  const m = await scanLibrary(cfg, root);
  assert.equal(m.assets.length, 1);
  assert.ok(m.assets[0].path.includes('Bibliothèque de sons 日本'));
  assert.ok(m.assets[0].duration > 0);
});

test('files outside known folders are reported, not guessed; missing library gives a clear error; env var configures the root', async () => {
  const root = tmpDir(); initLibrary(root);
  fs.mkdirSync(path.join(root, 'random'), { recursive: true });
  fs.writeFileSync(path.join(root, 'random', 'x.wav'), 'x');
  const cfg = testConfig({});
  const m = await scanLibrary(cfg, root, { analyze: false });
  assert.equal(m.assets.length, 0);
  assert.ok(m.warnings.some((w) => /random\/x.wav.*not inside a known top-level folder/.test(w)));
  await assert.rejects(() => scanLibrary(cfg, path.join(root, 'nope')), /library folder not found/);
  assert.equal(loadConfig({ cwd: tmpDir(), env: { ...baseEnv(), XOXOEDITZ_ASSETS: root } }).libraryRoot, root);
  assert.equal(RECIPES.length >= 24, true);
});

// ---------------- project asset understanding ----------------
import { spawnSync } from 'node:child_process';
import { analyzeFrames, analyzeVisual, ensureVisualAnalysis, hamming, findSubject, FW, FH } from '../src/assets/visual.js';
import { scanAssets } from '../src/assets/scan.js';
import { makeImage, makeVideo } from './helpers/media.js';

const ffm = (args) => { const r = spawnSync('ffmpeg', ['-v', 'error', '-y', ...args]); if (r.status !== 0) throw new Error(String(r.stderr)); };

test('visual analysis: brightness/colour tags, subject region on a synthetic picture, no source modification', { skip: !hasFfmpeg }, async () => {
  const cfg = testConfig({}); const dir = tmpDir();
  const img = path.join(dir, 'subject.png');
  ffm(['-f', 'lavfi', '-i', 'color=c=0x101010:s=640x360,drawbox=x=400:y=100:w=130:h=130:color=orange:t=fill', '-frames:v', '1', img]);
  const mtime = fs.statSync(img).mtimeMs;
  const v = await analyzeVisual(cfg, { path: img, type: 'image', meta: { isStill: true } });
  assert.ok(v.tags.includes('dark'));
  assert.ok(['orange', 'red', 'yellow'].includes(v.tags.find((t) => ['orange', 'red', 'yellow', 'green', 'blue'].includes(t))), `hue tag in ${v.tags}`);
  const cx = v.subject.x + v.subject.w / 2; const cy = v.subject.y + v.subject.h / 2;
  assert.ok(cx > 0.55 && cx < 0.85 && cy > 0.2 && cy < 0.7, `subject centre ${cx.toFixed(2)},${cy.toFixed(2)} near the box (0.72,0.46)`);
  assert.ok(v.subject.conf > 0.3);
  assert.equal(fs.statSync(img).mtimeMs, mtime);
  const flat = findSubject(new Float32Array(FW * FH).fill(0.5));
  assert.equal(flat.conf, 0, 'a flat picture has no subject: falls back to the centre');
});

test('visual analysis: motion energy separates a moving clip from a static one; best window found', { skip: !hasFfmpeg }, async () => {
  const cfg = testConfig({}); const dir = tmpDir();
  const moving = makeVideo(path.join(dir, 'moving.mp4'), { dur: 4, withAudio: false });
  const still = path.join(dir, 'still.mp4');
  ffm(['-f', 'lavfi', '-i', 'color=c=blue:s=640x360:r=24', '-t', '4', '-pix_fmt', 'yuv420p', '-c:v', 'libx264', still]);
  const a = await analyzeVisual(cfg, { path: moving, type: 'video', meta: {} });
  const b = await analyzeVisual(cfg, { path: still, type: 'video', meta: {} });
  assert.ok(a.motion.avg > b.motion.avg * 5 && b.motion.avg < 0.005, `moving ${a.motion.avg} vs static ${b.motion.avg}`);
  assert.ok(a.tags.some((t) => /motion/.test(t)) && b.tags.includes('static-shot'));
  assert.ok(a.motion.bestWindow && a.motion.bestWindow.duration <= 2);
  assert.ok(b.tags.includes('blue'));
});

test('near-duplicate detection and fingerprint cache in ensureVisualAnalysis; manifest carries fingerprints', { skip: !hasFfmpeg }, async () => {
  const cfg = testConfig({}); const dir = tmpDir();
  const mk = (n, vf) => ffm(['-f', 'lavfi', '-i', `color=c=gray:s=640x360,${vf}`, '-frames:v', '1', path.join(dir, n)]);
  mk('a.png', 'drawbox=x=50:y=50:w=200:h=150:color=red:t=fill');
  mk('b.jpg', 'drawbox=x=50:y=50:w=200:h=150:color=red:t=fill,scale=320:180');       // re-encoded + resized copy
  mk('c.png', 'drawbox=x=380:y=200:w=200:h=120:color=blue:t=fill,hue=h=40');
  const m = await scanAssets(cfg, dir);
  assert.ok(m.assets.every((x) => x.fingerprint && x.fingerprint.length === 20));
  const cache = path.join(cfg.workspace, 'visual-cache.json');
  const r1 = await ensureVisualAnalysis(cfg, m, cache);
  assert.equal(r1.analysed, 3);
  const by = (id) => m.assets.find((x) => x.id === id);
  assert.ok(by('IMG_A').nearDuplicates?.includes('IMG_B'), 'resized/re-encoded copy flagged');
  assert.ok(!by('IMG_C').nearDuplicates, 'different picture is not a duplicate');
  assert.ok(hamming(by('IMG_A').visual.hash, by('IMG_C').visual.hash) > 4);
  const r2 = await ensureVisualAnalysis(cfg, m, cache);
  assert.deepEqual([r2.analysed, r2.reused], [0, 3], 'second pass is served from the cache');
  fs.writeFileSync(path.join(dir, 'broken.png'), 'not an image');
  const m2 = await scanAssets(cfg, dir);
  const r3 = await ensureVisualAnalysis(cfg, m2, cache);
  assert.equal(r3.warnings.length, 1, 'one unreadable file is reported, the rest still analysed');
});

test('analyzeFrames is pure: identical frames give zero motion', () => {
  const f = Buffer.alloc(FW * FH * 3, 128);
  const r = analyzeFrames([f, f, f], { fps: 2 });
  assert.equal(r.motion.avg, 0);
  assert.ok(r.tags.includes('static-shot') && r.tags.includes('midtone') && r.tags.includes('monochrome'));
});
