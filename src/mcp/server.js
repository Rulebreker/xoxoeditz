// Minimal MCP (Model Context Protocol) server over stdio: newline-delimited JSON-RPC 2.0.
// Zero dependencies. stdout carries ONLY protocol messages; diagnostics go to the log file / stderr.

import fs from 'node:fs';
import path from 'node:path';
import * as S from '../app/services.js';
import { produceVideo, directProject, beatsFor } from '../app/produce.js';
import { critiqueProject, promoteProject, memoryCommand } from '../app/creative.js';
import { runBenchmark, runAllBenchmarks } from '../benchmark/run.js';
import { OPS_DOC } from '../bridge/ops-doc.js';
import { REPO_ROOT } from '../core/paths.js';
import { STYLES } from '../motion/styles.js';

const SERVER_INFO = { name: 'xoxoeditz', version: '0.1.0' };
const PROTOCOL = '2024-11-05';

const str = (description) => ({ type: 'string', description });
const bool = (description) => ({ type: 'boolean', description });
const proj = str('Project name (defaults to the current project).');

export const TOOLS = [
  { name: 'xoxo_doctor', description: 'Diagnose the environment: After Effects, aerender, Media Encoder, FFmpeg, bridge, permissions. Run this first in a new session.', inputSchema: { type: 'object', properties: { connect: bool('Actually connect to After Effects (may launch it; can take minutes on a cold start).') } }, run: (c, a) => S.doctor(c, a) },
  { name: 'xoxo_detect', description: 'Rebuild the capability registry (.xoxo/capabilities.json): OS, AE install/version, plugins, fonts, tools.', inputSchema: { type: 'object', properties: {} }, run: (c) => S.detect(c) },
  { name: 'xoxo_effects', description: 'List every effect/transition/look XOXOEDITZ can build, which implementation this machine would use, and the fallback chain.', inputSchema: { type: 'object', properties: {} }, run: (c) => S.effects(c) },
  { name: 'xoxo_new_project', description: 'Create a project workspace under projects/<name> and make it current.', inputSchema: { type: 'object', required: ['name'], properties: { name: str('Project name'), assets: str('Folder containing the user\'s media (default ./assets).') } }, run: (c, a) => S.newProject(c, a.name, { assets: a.assets }) },
  { name: 'xoxo_scan_assets', description: 'Classify and probe every file in the assets folder -> assets.manifest.json (ids like IMG_J20_01, VID_BROLL_03, NARR_*, MUSIC_*, SFX_*). Use thumbs:true then LOOK at the thumbnails and write a description per asset into the manifest.', inputSchema: { type: 'object', properties: { project: proj, dir: str('Assets folder override.'), thumbs: bool('Generate preview JPEGs you can open with Read.') } }, run: (c, a) => S.scanProject(c, a.project, { dir: a.dir, thumbs: a.thumbs }) },
  { name: 'xoxo_analyze_narration', description: 'Analyse the narration track: duration, pauses, speech segments, loudness, sentence timing (from an SRT/VTT, a plain script, or Whisper) and suggested scene breaks -> narration.json.', inputSchema: { type: 'object', properties: { project: proj, audio: str('Audio file or asset id (default: the asset with role narration).'), script: str('Plain-text script path.'), subtitles: str('SRT/VTT path.'), transcribe: bool('Use the whisper CLI if installed.') } }, run: (c, a) => S.analyzeProjectNarration(c, a.project, a) },
  { name: 'xoxo_scaffold_plan', description: 'Write a deterministic first-draft plan.json (baseline director). You are expected to read it and improve it — scene breaks, asset choice, graphics, transitions, SFX — before building.', inputSchema: { type: 'object', properties: { project: proj, title: str('Video title'), brief: str('Creative brief (drives style choice).'), style: str(`One of: ${Object.keys(STYLES).join(', ')} (or an alias).`), resolution: str('720p | 1080p | 1440p | 4k | 8k (default 4k)'), aspect: str('16:9 | 9:16 | 1:1 | 2.39:1 | vertical | square | cinematic'), fps: { type: 'number' }, force: bool('Overwrite an existing plan.json') } }, run: (c, a) => S.scaffoldProjectPlan(c, a.project, a) },
  { name: 'xoxo_validate_plan', description: 'Validate plan.json against the manifest and narration; returns precise, fixable errors and warnings.', inputSchema: { type: 'object', properties: { project: proj } }, run: (c, a) => S.validateProjectPlan(c, a.project) },
  { name: 'xoxo_edit', description: 'Build the project in After Effects from plan.json: import, comps, timeline, motion graphics, transitions, audio, captions, looks; then QA and auto-repair. Idempotent. dryRun:true uses the built-in simulator and never touches After Effects.', inputSchema: { type: 'object', properties: { project: proj, dryRun: bool('Simulate instead of driving After Effects.'), verify: bool('Run QA after building (default true).'), repair: bool('Auto-repair QA findings (default true).'), discard: bool('ONLY set when the user explicitly asked to discard somebody else\'s UNSAVED After Effects project. Never set it on your own; without it a foreign unsaved project makes the build stop with an actionable message.') } }, run: (c, a) => S.editProject(c, a.project, { dryRun: a.dryRun, verify: a.verify !== false, repair: a.repair !== false, discard: a.discard === true }) },
  { name: 'xoxo_produce', description: 'AUTONOMOUS edit: from a folder of media plus an edit type and a prompt, scan -> visual analysis -> music + beat map -> Director (shots on the beat, velocity ramps, camera rigs, transitions, typography, SFX) -> build in After Effects -> QA/repair -> render. Writes EDIT_REPORT.md. dryRun:true uses the simulator (nothing is rendered). Types: velocity, cinematic, documentary, commercial, automotive, military, sports, music_video, trailer, youtube, shorts, reel, tech, corporate, news, action, fashion, product, gaming, meme, minimal, dark, epic.', inputSchema: { type: 'object', required: ['assets'], properties: { assets: str('Folder with the media (read only).'), type: str('Edit type (see description).'), prompt: str('Plain-English brief, e.g. "aggressive J20 velocity edit, military, 30 seconds".'), output: str('Folder to copy the final video and report into.'), config: str('Path to an edit.config.json (default: next to the assets).'), quality: str('draft | preview | final'), duration: { type: 'number' }, seed: { type: 'number' }, professional: bool('Restrained, no glitch/shake/kinetic.'), overrides: { type: 'object', description: 'Explicit dial overrides 0..1 (velocity, camera, effects, sfx, transitions, text, color, motionBlur, impact, beatSync, depth, cutFrequency, speedVariation, music, intensity). They beat the type, the config and the prompt.' }, music: str('"auto" | "off" | file or library id'), starterSfx: bool('Generate the license-free starter SFX pack when no library is configured.'), dryRun: bool('Use the simulator.'), render: bool('Render after building (default true).'), discard: bool('ONLY when the user explicitly asked to discard somebody else\'s UNSAVED After Effects project (see xoxo_edit).') } }, run: (c, a) => produceVideo(c, { ...a, music: a.music === 'off' ? false : a.music }) },
  { name: 'xoxo_direct', description: 'Run only the creative Director on a scanned project: writes plan.json (timeline mode) and DIRECTOR_REPORT.json with the reason for every decision. Re-run with another seed for a different cut.', inputSchema: { type: 'object', properties: { project: proj, type: str('Edit type'), prompt: str('Brief'), seed: { type: 'number' }, duration: { type: 'number' }, professional: bool('Restrained mode'), dryRun: bool('Plan against the simulator\'s effect list') } }, run: (c, a) => directProject(c, a.project, a) },
  { name: 'xoxo_benchmark', description: 'Run a professional benchmark (velocity | cinematic | documentary | commercial | all): a full autonomous production from generated or supplied media, judged against a checklist (camera variety, speed ramps, SFX, beat sync, kinetic type, advanced transitions, compositing, colour, intro/outro, no slideshow/zoom-only/boxes). dryRun:true uses the simulator and reports skipped criteria honestly; without it a real After Effects render is made and verified.', inputSchema: { type: 'object', required: ['name'], properties: { name: str('velocity | cinematic | documentary | commercial | all'), assets: str('Your own footage folder instead of the generated inputs.'), output: str('Folder for the report and video.'), dryRun: bool('Simulator.'), quality: str('draft | preview | final'), seed: { type: 'number' } } }, run: (c, a) => (a.name === 'all' ? runAllBenchmarks(c, a) : runBenchmark(c, a.name, a)) },
  { name: 'xoxo_critique', description: 'Creative QA of a timeline project: slideshow / zoom-only / static shots, repeated moves, cuts off the beat, missing drop hits, SFX gaps, text density and fit, duplicate visuals, accidental boxes; with a render also black frames, frozen picture, unplanned bars, clipping, silence and cut detection. Writes CREATIVE_QA.json with per-category scores.', inputSchema: { type: 'object', properties: { project: proj, render: str('Path of a rendered file to inspect (default: plan only).'), last: bool('Inspect the last render.') } }, run: (c, a) => critiqueProject(c, a.project, { file: a.render, last: a.last }) },
  { name: 'xoxo_promote', description: 'Copy an approved draft/preview project into another tier (draft | preview | final): same decisions, rescaled and simplified. Then build and render it.', inputSchema: { type: 'object', required: ['project'], properties: { project: str('Project name'), to: str('final (default) | preview | draft'), resolution: str('Final resolution override, e.g. 4k') } }, run: (c, a) => promoteProject(c, a.project, { to: a.to || 'final', finalResolution: a.resolution }) },
  { name: 'xoxo_memory', description: 'Local taste memory: show, reset, or rate asset/sound ids (like | dislike). Only ids, ratings and counts are stored, never paths or media.', inputSchema: { type: 'object', properties: { action: str('show | reset | like | dislike'), ids: { type: 'array', items: { type: 'string' } } } }, run: (c, a) => memoryCommand(c, a.action || 'show', a.ids || []) },
  { name: 'xoxo_beats', description: 'Analyse an audio file: BPM, beats, downbeats, bars, phrases, drops, breaks, rises, impacts, sections, energy -> beat map (optionally saved).', inputSchema: { type: 'object', required: ['file'], properties: { file: str('Audio file'), out: str('Where to save beat_map.json') } }, run: (c, a) => beatsFor(c, a.file, { out: a.out }) },
  { name: 'xoxo_library_search', description: 'Semantic search of the universal asset library (e.g. "fast transition", "impact", "technical UI", "camera punch"): ranked sounds with the reasons for each score.', inputSchema: { type: 'object', required: ['query'], properties: { query: str('What you need'), type: str('sfx (default) | music | overlay'), limit: { type: 'number' } } }, run: (c, a) => S.librarySearch(c, a.query, { type: a.type, limit: a.limit }) },
  { name: 'xoxo_verify', description: 'Re-run the QA pipeline (PROJECT/ASSET/TIMELINE/TEXT/AUDIO/EFFECT/COMPOSITION/RENDER checks) on the saved project and write QA_REPORT.json.', inputSchema: { type: 'object', properties: { project: proj, dryRun: bool('Use the simulator.'), repair: bool('Auto-repair (default true).') } }, run: (c, a) => S.verifyProject(c, a.project, { dryRun: a.dryRun, repair: a.repair !== false }) },
  { name: 'xoxo_render', description: 'Render the master composition (aerender + FFmpeg, or Media Encoder) and verify the output file. preview:true renders a short low-res range and extracts frames to look at.', inputSchema: { type: 'object', properties: { project: proj, preview: bool('Low-res preview render.'), range: str('Seconds "start:end" (e.g. "10:20").'), force: bool('Render even if QA has errors.'), ame: bool('Prefer Adobe Media Encoder.') } }, run: (c, a) => S.renderProjectCmd(c, a.project, a) },
  { name: 'xoxo_project', description: 'After Effects project state: action "status" (what is open, who owns it - XOXOEDITZ or the user - and what a build would do), "save" (persist the open project; as = file for an unsaved one) or "close" (save:true saves first, discard:true throws unsaved changes away). XOXOEDITZ never discards or modifies somebody else\'s project on its own: ask the user before using close with discard.', inputSchema: { type: 'object', properties: { action: str('status | save | close'), save: bool('close: save first'), discard: bool('close: discard unsaved changes (only if the user said so)'), as: str('save: file path for a never-saved project'), dryRun: bool('Use the simulator.') } }, run: (c, a) => (a.action === 'save' ? S.projectSaveCmd(c, { as: a.as, dryRun: a.dryRun }) : a.action === 'close' ? S.projectCloseCmd(c, { save: a.save === true, discard: a.discard === true, dryRun: a.dryRun }) : S.projectStatusCmd(c, { dryRun: a.dryRun })) },
  { name: 'xoxo_status', description: 'Where is this project in the pipeline, and what is the next step?', inputSchema: { type: 'object', properties: { project: proj } }, run: (c, a) => S.statusProject(c, a.project) },
  { name: 'xoxo_ae_call', description: 'Low-level: run one After Effects host operation (see xoxo_ae_ops). Use for surgical fixes after a build; prefer editing plan.json and re-running xoxo_edit.', inputSchema: { type: 'object', required: ['op'], properties: { op: str('Operation name'), args: { type: 'object', description: 'Operation arguments' }, dryRun: bool('Run against the simulator.') } }, run: (c, a) => S.bridgeCall(c, a.op, a.args || {}, { dryRun: a.dryRun }) },
  { name: 'xoxo_ae_ops', description: 'Reference of every After Effects host operation and its arguments.', inputSchema: { type: 'object', properties: {} }, run: async () => ({ success: true, operation: 'ae_ops', data: OPS_DOC }) },
  { name: 'xoxo_plan_format', description: 'The plan.json format documentation (scene/clip/graphic/audio/caption fields).', inputSchema: { type: 'object', properties: {} }, run: async () => ({ success: true, operation: 'plan_format', data: { markdown: fs.readFileSync(path.join(REPO_ROOT, 'docs', 'PLAN_FORMAT.md'), 'utf8'), styles: Object.fromEntries(Object.entries(STYLES).map(([k, v]) => [k, v.description])) } }) },
];

export function toolList() {
  return TOOLS.map(({ name, description, inputSchema }) => ({ name, description, inputSchema }));
}

export async function callTool(ctx, name, args) {
  const tool = TOOLS.find((t) => t.name === name);
  if (!tool) return { content: [{ type: 'text', text: `unknown tool: ${name}` }], isError: true };
  let result;
  try { result = await tool.run(ctx, args || {}); }
  catch (e) { result = { success: false, operation: name, error: e.message }; }
  const text = JSON.stringify(result, null, 2);
  return { content: [{ type: 'text', text: text.length > 60000 ? text.slice(0, 60000) + '\n…(truncated; read the files named in the result)' : text }], isError: result.success === false };
}

/** Handle one JSON-RPC message; returns a response object or null for notifications. */
export async function handleMessage(ctx, msg) {
  const { id, method, params } = msg;
  const ok = (result) => ({ jsonrpc: '2.0', id, result });
  const err = (code, message) => ({ jsonrpc: '2.0', id, error: { code, message } });
  switch (method) {
    case 'initialize': return ok({ protocolVersion: params?.protocolVersion || PROTOCOL, capabilities: { tools: {} }, serverInfo: SERVER_INFO, instructions: 'XOXOEDITZ drives Adobe After Effects. Start with xoxo_doctor, then follow CLAUDE.md: new_project -> scan_assets -> analyze_narration -> (write plan.json) -> validate_plan -> edit -> verify -> render.' });
    case 'notifications/initialized': case 'notifications/cancelled': return null;
    case 'ping': return ok({});
    case 'tools/list': return ok({ tools: toolList() });
    case 'tools/call': return ok(await callTool(ctx, params?.name, params?.arguments));
    case 'resources/list': return ok({ resources: [] });
    case 'prompts/list': return ok({ prompts: [] });
    default: return id === undefined ? null : err(-32601, `method not found: ${method}`);
  }
}

export async function serve({ input = process.stdin, output = process.stdout } = {}) {
  const ctx = S.createContext({});
  let buf = '';
  input.setEncoding('utf8');
  const send = (o) => output.write(JSON.stringify(o) + '\n');
  let chain = Promise.resolve(); // process sequentially: After Effects is single-threaded
  input.on('data', (d) => {
    buf += d;
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
      if (!line) continue;
      let msg;
      try { msg = JSON.parse(line); } catch { send({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'parse error' } }); continue; }
      chain = chain.then(async () => { try { const r = await handleMessage(ctx, msg); if (r) send(r); } catch (e) { if (msg.id !== undefined) send({ jsonrpc: '2.0', id: msg.id, error: { code: -32603, message: e.message } }); } });
    }
  });
  input.on('end', () => chain.then(() => process.exit(0)));
}
