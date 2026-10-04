import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { testConfig, tmpDir } from './helpers/env.js';
import { hasFfmpeg, makeAssetFolder, makeSpeechLike } from './helpers/media.js';
import { scanAssets, makeThumbnails, walk } from '../src/assets/scan.js';
import { inferAudioRole, keywordsFor, typeOf } from '../src/assets/classify.js';
import { parseFfprobe, aspectOf, readImageSize } from '../src/assets/probe.js';
import { analyzeNarration, parseSilenceDetect, parseSubtitles, splitSentences, alignScript, groupScenes, analyzeSentence } from '../src/narration/analyze.js';

test('classification by extension, role by name/folder, keywords', () => {
  assert.equal(typeOf('a/B.MOV').type, 'video');
  assert.equal(typeOf('x.exe').type, 'other');
  assert.equal(inferAudioRole('narration.wav', 120).role, 'narration');
  assert.equal(inferAudioRole('sfx/boom.wav', 2).role, 'sfx');
  assert.equal(inferAudioRole('audio/Music/bed.mp3', 200).role, 'music');
  assert.equal(inferAudioRole('mystery.wav', 100).role, 'unknown');
  assert.deepEqual(keywordsFor('images/J20Front_view-01.jpg').sort(), ['front', 'images', 'j20', 'j20front', 'view'].sort());
});

test('ffprobe parsing: rotation swap, fps, aspect, stills', () => {
  const m = parseFfprobe({ format: { format_name: 'mov,mp4', duration: '5.0' }, streams: [{ codec_type: 'video', width: 1920, height: 1080, avg_frame_rate: '30000/1001', codec_name: 'h264', tags: { rotate: '90' } }, { codec_type: 'audio', channels: 2, sample_rate: '48000', codec_name: 'aac' }] });
  assert.equal(m.width, 1080); assert.equal(m.orientation, 'portrait'); assert.equal(m.aspect, '9:16');
  assert.ok(Math.abs(m.fps - 29.97) < 0.01); assert.equal(m.hasAudio, true); assert.equal(m.isStill, false);
  const still = parseFfprobe({ format: { format_name: 'image2', duration: '0.04' }, streams: [{ codec_type: 'video', width: 10, height: 10, codec_name: 'mjpeg' }] });
  assert.equal(still.isStill, true); assert.equal(still.duration, null);
  assert.equal(aspectOf(3840, 1608), '2.39:1');
  assert.equal(aspectOf(1000, 777), '1000:777');
  assert.equal(aspectOf(2390, 1000), '2.39:1');
});

test('silencedetect, subtitles, sentence splitting, alignment, scene grouping', () => {
  const sil = parseSilenceDetect('[silencedetect @ x] silence_start: 2\n[silencedetect @ x] silence_end: 3.2 | silence_duration: 1.2\n[silencedetect @ x] silence_start: 9');
  assert.deepEqual(sil[0], { start: 2, end: 3.2, duration: 1.2 });
  assert.equal(sil[1].end, null);
  const cues = parseSubtitles('1\n00:00:01,000 --> 00:00:03,500\nHello <i>world</i>\n\n2\n00:01:00,000 --> 00:01:02,000\nSecond line');
  assert.deepEqual(cues.map((c) => [c.start, c.end, c.text]), [[1, 3.5, 'Hello world'], [60, 62, 'Second line']]);
  const vtt = parseSubtitles('WEBVTT\n\n00:01.500 --> 00:02.000\nShort');
  assert.equal(vtt[0].start, 1.5);
  const s = splitSentences('The J-20 flew at Mach 2.0. It was first shown in 2011! Why? Nobody knew.');
  assert.equal(s.length, 4);
  const aligned = alignScript(['One two three.', 'Four five six seven eight nine.'], 10, [{ start: 3, end: 4, duration: 1 }]);
  assert.equal(aligned.length, 2);
  assert.ok(aligned[0].end <= aligned[1].start + 1e-6);
  const sc = groupScenes(Array.from({ length: 12 }, (_, i) => ({ id: `T${i}`, start: i * 3, end: i * 3 + 2.5, text: `s${i}` })));
  assert.ok(sc.length >= 2 && sc.every((x) => x.end > x.start));
  const a = analyzeSentence('The J-20 reaches Mach 2.0 and 2,100 km/h in 2011.');
  assert.ok(a.stats.some((x) => /Mach 2/.test(x)) && a.stats.some((x) => /km\/h/.test(x)));
});

test('image header reader works without ffprobe', () => {
  const dir = tmpDir();
  const png = Buffer.alloc(33); Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(png); png.writeUInt32BE(13, 8); png.write('IHDR', 12); png.writeUInt32BE(800, 16); png.writeUInt32BE(600, 20);
  fs.writeFileSync(path.join(dir, 'a.png'), png);
  assert.deepEqual(readImageSize(path.join(dir, 'a.png')), { width: 800, height: 600 });
});

test('walk ignores symlinks that escape the assets dir and dotfiles', () => {
  const root = tmpDir(); const outside = tmpDir();
  fs.writeFileSync(path.join(root, 'ok.jpg'), 'x'); fs.writeFileSync(path.join(root, '.hidden.jpg'), 'x'); fs.writeFileSync(path.join(outside, 'secret.jpg'), 'x');
  fs.symlinkSync(path.join(outside, 'secret.jpg'), path.join(root, 'link.jpg'));
  fs.symlinkSync(outside, path.join(root, 'linkdir'));
  const names = walk(root).files.map((f) => path.basename(f));
  assert.deepEqual(names, ['ok.jpg']);
});

test('scanAssets on real media: probe, roles, stable ids, preserved overrides, thumbnails', { skip: !hasFfmpeg }, async () => {
  const cfg = testConfig();
  const root = makeAssetFolder(tmpDir());
  const m1 = await scanAssets(cfg, root);
  const byRel = Object.fromEntries(m1.assets.map((a) => [a.relPath, a]));
  assert.equal(byRel['images/j20_front.jpg'].id, 'IMG_J20_FRONT');
  assert.equal(byRel['images/j20_front.jpg'].meta.width, 1920);
  assert.equal(byRel['images/j20_front.jpg'].meta.isStill, true);
  assert.equal(byRel['broll_runway.mp4'].id, 'VID_BROLL_RUNWAY');
  assert.equal(byRel['broll_runway.mp4'].meta.hasAudio, true);
  assert.equal(byRel['narration.wav'].id, 'NARR_NARRATION');
  assert.equal(byRel['narration.wav'].role, 'narration');
  assert.equal(byRel['sfx/whoosh_01.wav'].id, 'SFX_WHOOSH_01');
  assert.equal(byRel['music_main.mp3'].id, 'MUSIC_MAIN');
  assert.ok(Math.abs(byRel['music_main.mp3'].meta.duration - 20) < 0.5);
  // user edits survive a rescan; ids are stable
  byRel['images/map_china.jpg'].override = { note: 'keep' }; byRel['images/map_china.jpg'].description = 'Map of China';
  const m2 = await scanAssets(cfg, root, { previous: m1 });
  const map2 = m2.assets.find((a) => a.relPath === 'images/map_china.jpg');
  assert.equal(map2.description, 'Map of China'); assert.equal(map2.id, 'IMG_MAP_CHINA');
  const thumbs = await makeThumbnails(cfg, m2, path.join(cfg.workspace, 'thumbs'));
  assert.equal(thumbs.length, 4);
  assert.ok(fs.statSync(thumbs[0].file).size > 100);
});

test('narration analysis on a synthetic voice track', { skip: !hasFfmpeg }, async () => {
  const cfg = testConfig();
  const dir = tmpDir();
  const wav = makeSpeechLike(path.join(dir, 'n.wav')); // 2s tone, 1.2s silence, 3s tone, 0.5s silence, 2s tone
  const r = await analyzeNarration(cfg, { audio: wav, script: 'First sentence here. Second sentence follows now. Third one ends it.', outDir: dir });
  assert.ok(Math.abs(r.duration - 8.7) < 0.2, `duration ${r.duration}`);
  assert.equal(r.silences.length, 2);
  assert.ok(Math.abs(r.silences[0].start - 2) < 0.15 && Math.abs(r.silences[0].duration - 1.2) < 0.15);
  assert.equal(r.pauses.length, 1);
  assert.equal(r.sentences.length, 3);
  assert.equal(r.transcript.method, 'script-heuristic');
  assert.ok(r.sentences[0].end <= r.sentences[1].start + 0.3);
  assert.ok(fs.existsSync(path.join(dir, 'narration.json')));
  const noText = await analyzeNarration(cfg, { audio: wav });
  assert.equal(noText.transcript.method, 'none');
  assert.ok(noText.notes[0].includes('No transcript'));
});

test('untrusted media is only ever opened through the file protocol', { skip: process.platform === 'win32' }, async () => {
  const dir = tmpDir();
  const log = path.join(dir, 'args.log');
  const fake = path.join(dir, 'fake-ffprobe.mjs');
  fs.writeFileSync(fake, `#!/usr/bin/env node\nimport fs from 'node:fs';\nfs.appendFileSync(${JSON.stringify(log)}, JSON.stringify(process.argv.slice(2)) + '\\n');\nconsole.log('{}');\n`);
  fs.chmodSync(fake, 0o755);
  process.env.XOXO_TEST_ALLOW = `${process.env.XOXO_TEST_ALLOW || ''},fake-ffprobe.mjs`;
  const cfg = testConfig({ ffprobe: fake });
  const root = tmpDir();
  fs.writeFileSync(path.join(root, 'evil.mp4'), '#EXTM3U\n#EXTINF:1,\nfile:///etc/passwd\n');
  await scanAssets(cfg, root);
  const calls = fs.readFileSync(log, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  assert.equal(calls.length, 1);
  const i = calls[0].indexOf('-protocol_whitelist');
  assert.ok(i >= 0 && calls[0][i + 1] === 'file', 'ffprobe is restricted to the file protocol');
});
