// After Effects PROJECT STATE: XOXOEDITZ must never destroy work that is not its own, and must not make the user manage
// After Effects project state by hand on every run. Everything here runs against the simulator, which implements the
// same host ops (project_status / project_mark / project_close) the real host does - it proves the policy, not AE.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { tmpDir, testConfig, baseEnv } from './helpers/env.js';
import { hasFfmpeg, makeAssetFolder } from './helpers/media.js';
import { createMockAE } from '../src/bridge/mock-ae.js';
import { Bridge } from '../src/bridge/client.js';
import { MockTransport } from '../src/bridge/transports/mock.js';
import { openOrCreateProject, prepareProject, projectState, closeProject, saveOpenProject, classifyProject } from '../src/ae/project.js';
import * as S from '../src/app/services.js';
import { newProject, scanProject, analyzeProjectNarration, scaffoldProjectPlan, createContext } from '../src/app/services.js';
import { main } from '../src/cli/index.js';

function world() {
  const cfg = testConfig({});
  const mock = createMockAE();
  const bridge = new Bridge(new MockTransport({ mock }), { config: cfg });
  const call = (op, args = {}) => { const r = mock.call({ id: 't', op, args }); assert.equal(r.success, true, `${op}: ${r.error}`); return r.data; };
  const userDir = tmpDir('xoxo-user-');
  const aep = (name) => path.join(cfg.projectsDir, name, `${name}.aep`);
  /** somebody else's project: a comp the user made, optionally saved and then edited again */
  const userProject = ({ saved = true, dirty = true } = {}) => {
    call('project_new', {});
    if (saved) { call('comp_ensure', { name: 'USER_COMP', width: 1920, height: 1080, fps: 24, duration: 5 }); call('project_save', { path: path.join(userDir, 'Desktop.aep').replace(/\\/g, '/') }); }
    if (dirty) call('comp_ensure', { name: 'USER_UNSAVED_COMP', width: 1920, height: 1080, fps: 24, duration: 5 });
    return path.join(userDir, 'Desktop.aep');
  };
  /** an earlier XOXOEDITZ project (marked + saved under projects/), optionally with unsaved edits */
  const xoxoProject = (name, { saved = true, dirty = false } = {}) => {
    call('project_new', {}); call('project_mark', { project: name });
    if (saved) call('project_save', { path: aep(name).replace(/\\/g, '/') });
    if (dirty) call('comp_ensure', { name: 'XOXO_UNSAVED_COMP', width: 1920, height: 1080, fps: 24, duration: 5 });
    return aep(name);
  };
  const opts = { projectsDir: cfg.projectsDir };
  return { cfg, mock, bridge, call, userDir, aep, userProject, xoxoProject, opts };
}
const savedItems = (file) => JSON.parse(fs.readFileSync(file, 'utf8')).items.map((i) => i.name);

test('state: no project open -> a dedicated, marked XOXOEDITZ project is created and saved', async () => {
  const w = world();
  assert.equal((await projectState(w.bridge, w.opts)).data.kind, 'none');
  const r = await openOrCreateProject(w.bridge, w.aep('edit1'), { ...w.opts, name: 'edit1' });
  assert.equal(r.success, true, r.error); assert.equal(r.data.created, true); assert.ok(fs.existsSync(w.aep('edit1')));
  const st = (await projectState(w.bridge, { ...w.opts, aepPath: w.aep('edit1') })).data;
  assert.equal(st.kind, 'xoxo'); assert.equal(st.owner.project, 'edit1'); assert.equal(st.isTarget, true); assert.equal(st.dirty, false);
  assert.ok(savedItems(w.aep('edit1')).includes('XOXO_META'), 'the ownership marker is saved inside the project file');
});

test('state: clean XOXOEDITZ project open -> switched away from safely, nothing lost, new project created', async () => {
  const w = world(); const old = w.xoxoProject('old', { dirty: false });
  const r = await openOrCreateProject(w.bridge, w.aep('edit2'), { ...w.opts, name: 'edit2' });
  assert.equal(r.success, true, r.error); assert.equal(r.data.prepare.action, 'close-clean'); assert.equal(r.data.created, true);
  assert.ok(fs.existsSync(old), 'the previous project file is untouched');
  assert.equal((await projectState(w.bridge, w.opts)).data.owner.project, 'edit2');
});

test('state: DIRTY XOXOEDITZ project open -> its unsaved work is saved (policy save) before switching; policy discard drops it', async () => {
  const w = world(); const old = w.xoxoProject('old', { dirty: true });
  assert.ok(!savedItems(old).includes('XOXO_UNSAVED_COMP'));
  const r = await openOrCreateProject(w.bridge, w.aep('edit3'), { ...w.opts, name: 'edit3' });
  assert.equal(r.success, true, r.error); assert.equal(r.data.prepare.action, 'saved-xoxo');
  assert.ok(savedItems(old).includes('XOXO_UNSAVED_COMP'), 'the unsaved edits were written to the old project before it was closed');
  // policy "discard" only ever applies to XOXOEDITZ's own projects
  const w2 = world(); const old2 = w2.xoxoProject('old', { dirty: true });
  const r2 = await openOrCreateProject(w2.bridge, w2.aep('edit3'), { ...w2.opts, name: 'edit3', dirtyPolicy: 'discard' });
  assert.equal(r2.success, true, r2.error); assert.equal(r2.data.prepare.action, 'discarded-xoxo'); assert.ok(!savedItems(old2).includes('XOXO_UNSAVED_COMP'));
  // a never-saved XOXOEDITZ project is saved to a recovery file instead of being lost
  const w3 = world(); w3.xoxoProject('ghost', { saved: false, dirty: true });
  const r3 = await openOrCreateProject(w3.bridge, w3.aep('edit3'), { ...w3.opts, name: 'edit3' });
  assert.equal(r3.success, true, r3.error); assert.equal(r3.data.prepare.action, 'saved-xoxo-recovery');
  const rec = fs.readdirSync(path.join(w3.cfg.projectsDir, '_recovered')); assert.equal(rec.length, 1); assert.ok(savedItems(path.join(w3.cfg.projectsDir, '_recovered', rec[0])).includes('XOXO_UNSAVED_COMP'));
});

test('state: unrelated DIRTY user project -> refused with an actionable message, nothing modified or discarded, nothing created', async () => {
  const w = world(); const userFile = w.userProject({ saved: true, dirty: true });
  const before = fs.readFileSync(userFile, 'utf8');
  const r = await openOrCreateProject(w.bridge, w.aep('edit4'), { ...w.opts, name: 'edit4' });
  assert.equal(r.success, false); assert.equal(r.code, 'PROJECT_DIRTY_USER');
  assert.match(r.error, /unsaved changes/i); assert.match(r.error, /--discard/); assert.match(r.error, /xoxo project (save|close)/); assert.ok(r.error.includes('Desktop.aep'), 'names the project');
  const st = (await projectState(w.bridge, w.opts)).data;
  assert.equal(st.kind, 'user'); assert.equal(st.dirty, true, 'the user project is still open and still unsaved'); assert.ok(st.comps.includes('USER_UNSAVED_COMP'));
  assert.equal(fs.readFileSync(userFile, 'utf8'), before, 'the user file on disk was not touched');
  assert.ok(!fs.existsSync(w.aep('edit4')), 'no XOXOEDITZ project was created');
  // an UNTITLED dirty user project is protected the same way
  const u = world(); u.userProject({ saved: false, dirty: true });
  const r2 = await openOrCreateProject(u.bridge, u.aep('edit4'), { ...u.opts, name: 'edit4' });
  assert.equal(r2.success, false); assert.equal(r2.code, 'PROJECT_DIRTY_USER'); assert.match(r2.error, /untitled/i);
  // the config policy can never authorise discarding somebody else's work
  const r3 = await openOrCreateProject(w.bridge, w.aep('edit4'), { ...w.opts, name: 'edit4', dirtyPolicy: 'discard' });
  assert.equal(r3.code, 'PROJECT_DIRTY_USER');
});

test('state: --discard is the only way to drop a user project, it is explicit, and it still never saves over the user file', async () => {
  const w = world(); const userFile = w.userProject({ saved: true, dirty: true }); const before = fs.readFileSync(userFile, 'utf8');
  const r = await openOrCreateProject(w.bridge, w.aep('edit5'), { ...w.opts, name: 'edit5', discard: true });
  assert.equal(r.success, true, r.error); assert.equal(r.data.prepare.action, 'discarded-user'); assert.match(r.data.prepare.notes.join(' '), /DISCARDED/);
  assert.equal(fs.readFileSync(userFile, 'utf8'), before, 'discarded means never written back');
  assert.equal((await projectState(w.bridge, w.opts)).data.owner.project, 'edit5');
});

test('state: clean user project -> closed without loss and the user is told; existing XOXOEDITZ project -> reopened; the open target is reused even when dirty', async () => {
  const w = world(); const userFile = w.userProject({ saved: true, dirty: false });
  const r = await openOrCreateProject(w.bridge, w.aep('edit6'), { ...w.opts, name: 'edit6' });
  assert.equal(r.success, true, r.error); assert.equal(r.data.prepare.action, 'close-clean'); assert.match(r.data.prepare.notes[0], /Desktop\.aep/); assert.ok(fs.existsSync(userFile));
  // existing project: reopen it
  await w.bridge.call('project_close', { save: true });
  const again = await openOrCreateProject(w.bridge, w.aep('edit6'), { ...w.opts, name: 'edit6' });
  assert.equal(again.success, true, again.error); assert.equal(again.data.created, false);
  // the target is open and dirty (an earlier step of the same run): reused as it is, no save, no discard
  w.call('comp_ensure', { name: 'WORK_IN_PROGRESS', width: 1920, height: 1080, fps: 24, duration: 5 });
  const reuse = await openOrCreateProject(w.bridge, w.aep('edit6'), { ...w.opts, name: 'edit6' });
  assert.equal(reuse.success, true, reuse.error); assert.equal(reuse.data.prepare.action, 'reuse-target');
  assert.equal((await projectState(w.bridge, w.opts)).data.dirty, true); assert.ok((await projectState(w.bridge, w.opts)).data.comps.includes('WORK_IN_PROGRESS'));
});

test('state: classification - marker beats location; legacy projects under projects/ count as ours; an empty untitled project is "none"', () => {
  const dir = '/tmp/xoxo-projects'; const f = (p) => path.join(dir, p);
  assert.equal(classifyProject({ open: true, file: '/home/me/x.aep', dirty: false, numItems: 3, owner: { project: 'x' } }, { projectsDir: dir }).kind, 'xoxo');
  assert.equal(classifyProject({ open: true, file: f('a/a.aep'), dirty: true, numItems: 3, owner: null }, { projectsDir: dir }).kind, 'xoxo');
  assert.equal(classifyProject({ open: true, file: '/home/me/x.aep', dirty: true, numItems: 3, owner: null }, { projectsDir: dir }).kind, 'user');
  assert.equal(classifyProject({ open: true, file: null, dirty: false, numItems: 0, owner: null }, { projectsDir: dir }).kind, 'none');
  assert.equal(classifyProject({ open: true, file: null, dirty: true, numItems: 2, owner: null }, { projectsDir: dir }).kind, 'user');
  assert.equal(classifyProject({ open: true, file: f('a/a.aep'), dirty: true, numItems: 1, owner: null }, { projectsDir: dir, aepPath: f('a/a.aep') }).isTarget, true);
  assert.equal(classifyProject({ open: true, file: '/elsewhere/projects-evil/a.aep', dirty: true, numItems: 1, owner: null }, { projectsDir: dir }).kind, 'user', 'a sibling folder is not inside the projects folder');
});

test('xoxo project close / save: XOXOEDITZ projects close safely by default; somebody else\'s unsaved project needs an explicit choice', async () => {
  const w = world(); w.userProject({ saved: true, dirty: true });
  const refused = await closeProject(w.bridge, { ...w.opts });
  assert.equal(refused.success, false); assert.equal(refused.code, 'PROJECT_DIRTY_USER'); assert.match(refused.error, /--save/); assert.match(refused.error, /--discard/);
  assert.equal((await projectState(w.bridge, w.opts)).data.dirty, true, 'still open');
  assert.equal((await closeProject(w.bridge, { ...w.opts, save: true, discard: true })).code, 'BAD_ARGS');
  const saved = await closeProject(w.bridge, { ...w.opts, save: true });
  assert.equal(saved.success, true); assert.equal(saved.data.saved, true); assert.equal((await projectState(w.bridge, w.opts)).data.kind, 'none');
  assert.ok(savedItems(path.join(w.userDir, 'Desktop.aep')).includes('USER_UNSAVED_COMP'), '--save wrote the user\'s changes to their own file');
  // XOXOEDITZ project: saved by default
  const x = world(); const xf = x.xoxoProject('mine', { dirty: true });
  const c = await closeProject(x.bridge, { ...x.opts }); assert.equal(c.success, true); assert.equal(c.data.saved, true); assert.ok(savedItems(xf).includes('XOXO_UNSAVED_COMP'));
  // discard is explicit
  const d = world(); const df = d.userProject({ saved: true, dirty: true }); const before = fs.readFileSync(df, 'utf8');
  const dr = await closeProject(d.bridge, { ...d.opts, discard: true }); assert.equal(dr.success, true); assert.equal(dr.data.discarded, true); assert.equal(fs.readFileSync(df, 'utf8'), before);
  // nothing open
  assert.equal((await closeProject(d.bridge, { ...d.opts })).data.closed, false);
  // save: an untitled project needs somewhere to go
  const u = world(); u.userProject({ saved: false, dirty: true });
  const ns = await saveOpenProject(u.bridge, { ...u.opts }); assert.equal(ns.success, false); assert.equal(ns.code, 'NO_PROJECT_FILE');
  const target = path.join(u.userDir, 'rescued.aep'); const sv = await saveOpenProject(u.bridge, { ...u.opts, as: target }); assert.equal(sv.success, true, sv.error); assert.ok(fs.existsSync(target));
});

test('services + CLI: project status explains what a build would do (and says when it is the simulator)', async () => {
  const root = tmpDir('xoxo-ps-'); const mock = createMockAE();
  const ctx = createContext({ cwd: root, env: baseEnv(), overrides: { transport: 'mock' }, mockAE: mock });
  let r = await S.projectStatusCmd(ctx, {}); assert.equal(r.success, true); assert.equal(r.data.kind, 'none'); assert.match(r.data.willDo, /create or open its own/);
  mock.call({ id: '1', op: 'project_new', args: {} }); mock.call({ id: '2', op: 'comp_ensure', args: { name: 'MINE', width: 1280, height: 720, fps: 24, duration: 3 } });
  r = await S.projectStatusCmd(ctx, {}); assert.equal(r.data.kind, 'user'); assert.equal(r.data.dirty, true); assert.match(r.data.willDo, /refuse/); assert.equal(r.data.simulator, true);
  assert.equal((await S.projectCloseCmd(ctx, {})).code, 'PROJECT_DIRTY_USER');
  const out = []; const orig = console.log; console.log = (...a) => out.push(a.join(' '));
  try { await main(['project', 'status', '--dry-run', '--json']); } finally { console.log = orig; }
  assert.equal(JSON.parse(out.join('\n')).operation, 'project_status');
});

test('xoxo edit / auto end to end: a dirty user project stops the build with the actionable message and is left intact; --discard is explicit; a re-run reuses its own project', { skip: !hasFfmpeg, timeout: 240000 }, async () => {
  const root = tmpDir('xoxo-edit-state-'); const assets = makeAssetFolder(path.join(root, 'assets'));
  fs.writeFileSync(path.join(assets, 'script.txt'), 'The jet is fast. It is stealthy. It is new.');
  const mock = createMockAE();
  const ctx = createContext({ cwd: root, env: baseEnv(), overrides: { transport: 'mock' }, mockAE: mock });
  const must = (r) => { assert.equal(r.success, true, `${r.operation}: ${r.error}`); return r.data; };
  must(await newProject(ctx, 'st', { assets })); must(await scanProject(ctx, 'st'));
  must(await analyzeProjectNarration(ctx, 'st', { script: path.join(assets, 'script.txt') }));
  must(await scaffoldProjectPlan(ctx, 'st', { title: 'STATE', brief: 'cinematic documentary', resolution: '720p' }));
  // the user has an unrelated project with unsaved changes open
  mock.call({ id: '1', op: 'project_new', args: {} }); mock.call({ id: '2', op: 'comp_ensure', args: { name: 'USER_WORK', width: 1280, height: 720, fps: 24, duration: 3 } });
  const blocked = await S.editProject(ctx, 'st', { dryRun: true });
  assert.equal(blocked.success, false); assert.equal(blocked.code, 'PROJECT_DIRTY_USER'); assert.match(blocked.error, /--discard/);
  assert.equal((await S.projectStatusCmd(ctx, {})).data.comps.includes('USER_WORK'), true, 'user work still there');
  // explicit discard -> build proceeds on its own, marked project
  const done = await S.editProject(ctx, 'st', { dryRun: true, discard: true });
  assert.ok(done.data?.build?.success, JSON.stringify(done.error || done.data?.build?.errors)); assert.ok(fs.existsSync(done.data.build.project), done.data.build.project);
  const after = (await S.projectStatusCmd(ctx, {})).data; assert.equal(after.kind, 'xoxo'); assert.equal(after.owner.project, 'st');
  // re-run without any flag: its own (possibly dirty) project is reused - no user action needed
  const again = await S.editProject(ctx, 'st', { dryRun: true });
  assert.ok(again.data?.build?.success, again.error);
  // another XOXOEDITZ project is open and dirty: saved, not blocked
  must(await newProject(ctx, 'st2', { assets })); must(await scanProject(ctx, 'st2'));
  must(await analyzeProjectNarration(ctx, 'st2', { script: path.join(assets, 'script.txt') }));
  must(await scaffoldProjectPlan(ctx, 'st2', { title: 'STATE2', brief: 'cinematic documentary', resolution: '720p' }));
  mock.call({ id: '3', op: 'comp_ensure', args: { name: 'EXTRA_UNSAVED', width: 1280, height: 720, fps: 24, duration: 3 } });
  const second = await S.editProject(ctx, 'st2', { dryRun: true });
  assert.ok(second.data?.build?.success, second.error); assert.equal(second.data.build.projectState?.action ?? 'saved-xoxo', 'saved-xoxo');
});
