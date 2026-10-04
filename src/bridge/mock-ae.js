// A small in-memory model of the After Effects scripting DOM.
//
// PURPOSE: let the whole XOXOEDITZ pipeline (host scripts -> bridge -> compile -> QA) run on any
// machine, in CI, and as a `--dry-run` that validates a plan before touching the real application.
// It models only the API surface XOXOEDITZ uses, as documented in the After Effects Scripting Guide.
// It does NOT prove behaviour inside real After Effects — see docs/AE_INTEGRATION.md ("Verification").

import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { buildHostBundle } from './host-bundle.js';

export const DEFAULT_EFFECTS = [
  ['ADBE Gaussian Blur 2', 'Gaussian Blur', 'Blur & Sharpen', [['ADBE Gaussian Blur 2-0001', 'Blurriness', 0], ['ADBE Gaussian Blur 2-0002', 'Blur Dimensions', 1]]],
  ['ADBE Fast Box Blur', 'Fast Box Blur', 'Blur & Sharpen', [['ADBE Fast Box Blur-0001', 'Blur Radius', 0]]],
  ['ADBE Displacement Map', 'Displacement Map', 'Distort', [['ADBE Displacement Map-0001', 'Displacement Map Layer', 0], ['ADBE Displacement Map-0002', 'Max Horizontal Displacement', 5]]],
  ['ADBE Turbulent Displace', 'Turbulent Displace', 'Distort', [['ADBE Turbulent Displace-0001', 'Amount', 50], ['ADBE Turbulent Displace-0002', 'Size', 100]]],
  ['ADBE Shift Channels', 'Shift Channels', 'Channel', [['ADBE Shift Channels-0001', 'Take Alpha From', 0]]],
  ['ADBE Fill', 'Fill', 'Generate', [['ADBE Fill-0002', 'Color', [1, 0, 0, 1]]]],
  ['ADBE Glo2', 'Glow', 'Stylize', [['ADBE Glo2-0001', 'Glow Based On', 1], ['ADBE Glo2-0003', 'Glow Intensity', 1]]],
  ['ADBE Linear Wipe', 'Linear Wipe', 'Transition', [['ADBE Linear Wipe-0001', 'Transition Completion', 0], ['ADBE Linear Wipe-0002', 'Wipe Angle', 90], ['ADBE Linear Wipe-0003', 'Feather', 0]]],
  ['ADBE Tint', 'Tint', 'Color Correction', [['ADBE Tint-0001', 'Map Black To', [0, 0, 0, 1]], ['ADBE Tint-0002', 'Map White To', [1, 1, 1, 1]], ['ADBE Tint-0003', 'Amount to Tint', 100]]],
  ['ADBE Vibrance', 'Vibrance', 'Color Correction', [['ADBE Vibrance-0001', 'Vibrance', 0]]],
  ['ADBE CurvesCustom', 'Curves', 'Color Correction', []],
  ['ADBE Lumetri', 'Lumetri Color', 'Color Correction', []],
  ['ADBE Vignette', 'Vignette', 'Stylize', []],
  ['ADBE Posterize Time', 'Posterize Time', 'Time', [['ADBE Posterize Time-0001', 'Frame Rate', 24]]],
  ['ADBE Mosaic', 'Mosaic', 'Stylize', []],
  ['ADBE Noise', 'Noise', 'Noise & Grain', [['ADBE Noise-0001', 'Amount of Noise', 0]]],
  ['ADBE Add Grain', 'Add Grain', 'Noise & Grain', []],
  ['ADBE Drop Shadow', 'Drop Shadow', 'Perspective', [['ADBE Drop Shadow-0001', 'Shadow Color', [0, 0, 0, 1]], ['ADBE Drop Shadow-0002', 'Opacity', 50]]],
  // V4: effects used by shot transitions, colour looks and text animations
  ['ADBE Motion Blur', 'Directional Blur', 'Blur & Sharpen', [['ADBE Motion Blur-0001', 'Direction', 0], ['ADBE Motion Blur-0002', 'Blur Length', 0]]],
  ['CC Radial Fast Blur', 'CC Radial Fast Blur', 'Blur & Sharpen', [['CC Radial Fast Blur-0001', 'Type', 1], ['CC Radial Fast Blur-0002', 'Amount', 0]]],
  ['ADBE Exposure2', 'Exposure', 'Color Correction', [['ADBE Exposure2-0001', 'Exposure', 0]]],
  ['ADBE Wave Warp', 'Wave Warp', 'Distort', [['ADBE Wave Warp-0001', 'Wave Height', 0], ['ADBE Wave Warp-0002', 'Wave Width', 100]]],
  ['ADBE Ramp', 'Gradient Ramp', 'Generate', [['ADBE Ramp-0001', 'Start Color', [1, 1, 1, 1]], ['ADBE Ramp-0002', 'End Color', [0, 0, 0, 1]], ['ADBE Ramp-0003', 'Ramp Shape', 1]]],
  ['ADBE HUE SATURATION', 'Hue/Saturation', 'Color Correction', [['ADBE HUE SATURATION-0001', 'Master Saturation', 0]]],
  ['ADBE Brightness & Contrast 2', 'Brightness & Contrast', 'Color Correction', [['ADBE Brightness & Contrast 2-0001', 'Brightness', 0], ['ADBE Brightness & Contrast 2-0002', 'Contrast', 0]]],
];

// ---- property tree --------------------------------------------------------------------------
const GROUP_NODES = {
  'ADBE Transform Group': { name: 'Transform', children: ['ADBE Anchor Point', 'ADBE Position', 'ADBE Scale', 'ADBE Orientation', 'ADBE Rotate X', 'ADBE Rotate Y', 'ADBE Rotate Z', 'ADBE Opacity'] },
  'ADBE Audio Group': { name: 'Audio', children: ['ADBE Audio Levels'] },
  'ADBE Effect Parade': { name: 'Effects', container: true },
  'ADBE Mask Parade': { name: 'Masks', container: true },
  'ADBE Text Properties': { name: 'Text', children: ['ADBE Text Document', 'ADBE Text Animators'] },
  'ADBE Text Animators': { name: 'Animators', container: true },
  'ADBE Text Animator': { name: 'Animator', children: ['ADBE Text Selectors', 'ADBE Text Animator Properties'] },
  'ADBE Text Selectors': { name: 'Selectors', container: true },
  'ADBE Text Selector': { name: 'Range Selector', children: ['ADBE Text Percent Start', 'ADBE Text Percent End', 'ADBE Text Percent Offset', 'ADBE Text Range Advanced'] },
  'ADBE Text Range Advanced': { name: 'Advanced', children: ['ADBE Text Range Shape'] },
  'ADBE Text Animator Properties': { name: 'Properties', container: true },
  'ADBE Root Vectors Group': { name: 'Contents', container: true },
  'ADBE Vector Group': { name: 'Group', children: ['ADBE Vectors Group', 'ADBE Vector Transform Group'] },
  'ADBE Vectors Group': { name: 'Contents', container: true },
  'ADBE Vector Transform Group': { name: 'Transform', children: ['ADBE Vector Position'] },
  'ADBE Vector Shape - Rect': { name: 'Rectangle Path', children: ['ADBE Vector Rect Size', 'ADBE Vector Rect Position', 'ADBE Vector Rect Roundness'] },
  'ADBE Vector Shape - Ellipse': { name: 'Ellipse Path', children: ['ADBE Vector Ellipse Size', 'ADBE Vector Ellipse Position'] },
  'ADBE Vector Shape - Group': { name: 'Path', children: ['ADBE Vector Shape'] },
  'ADBE Vector Graphic - Fill': { name: 'Fill', children: ['ADBE Vector Fill Color', 'ADBE Vector Fill Opacity'] },
  'ADBE Vector Graphic - Stroke': { name: 'Stroke', children: ['ADBE Vector Stroke Color', 'ADBE Vector Stroke Width'] },
  'ADBE Vector Filter - Trim': { name: 'Trim Paths', children: ['ADBE Vector Trim Start', 'ADBE Vector Trim End', 'ADBE Vector Trim Offset'] },
  'ADBE Mask Atom': { name: 'Mask', children: ['ADBE Mask Shape', 'ADBE Mask Feather'] },
  'ADBE Light Options Group': { name: 'Light Options', children: ['ADBE Light Intensity'] },
};
const LEAF_NODES = {
  'ADBE Anchor Point': { name: 'Anchor Point', value: [0, 0], spatial: true },
  'ADBE Position': { name: 'Position', value: [0, 0], spatial: true },
  'ADBE Scale': { name: 'Scale', value: [100, 100] },
  'ADBE Orientation': { name: 'Orientation', value: [0, 0, 0] },
  'ADBE Rotate X': { name: 'X Rotation', value: 0 },
  'ADBE Rotate Y': { name: 'Y Rotation', value: 0 },
  'ADBE Rotate Z': { name: 'Rotation', value: 0 },
  'ADBE Opacity': { name: 'Opacity', value: 100 },
  'ADBE Point of Interest': { name: 'Point of Interest', value: [0, 0, 0], spatial: true },
  'ADBE Audio Levels': { name: 'Audio Levels', value: [0, 0] },
  'ADBE Time Remapping': { name: 'Time Remap', value: 0 },
  'ADBE Marker': { name: 'Marker', value: null },
  'ADBE Text Document': { name: 'Source Text', value: null },
  'ADBE Text Percent Start': { name: 'Start', value: 0 },
  'ADBE Text Percent End': { name: 'End', value: 100 },
  'ADBE Text Percent Offset': { name: 'Offset', value: 0 },
  'ADBE Text Range Shape': { name: 'Shape', value: 1 },
  'ADBE Text Opacity': { name: 'Opacity', value: 100 },
  'ADBE Text Position 3D': { name: 'Position', value: [0, 0, 0] },
  'ADBE Text Tracking Amount': { name: 'Tracking Amount', value: 0 },
  'ADBE Vector Position': { name: 'Position', value: [0, 0] },
  'ADBE Vector Rect Size': { name: 'Size', value: [100, 100] },
  'ADBE Vector Rect Position': { name: 'Position', value: [0, 0] },
  'ADBE Vector Rect Roundness': { name: 'Roundness', value: 0 },
  'ADBE Vector Ellipse Size': { name: 'Size', value: [100, 100] },
  'ADBE Vector Ellipse Position': { name: 'Position', value: [0, 0] },
  'ADBE Vector Shape': { name: 'Path', value: null },
  'ADBE Vector Fill Color': { name: 'Color', value: [1, 1, 1, 1] },
  'ADBE Vector Fill Opacity': { name: 'Opacity', value: 100 },
  'ADBE Vector Stroke Color': { name: 'Color', value: [1, 1, 1, 1] },
  'ADBE Vector Stroke Width': { name: 'Stroke Width', value: 2 },
  'ADBE Vector Trim Start': { name: 'Start', value: 0 },
  'ADBE Vector Trim End': { name: 'End', value: 100 },
  'ADBE Vector Trim Offset': { name: 'Offset', value: 0 },
  'ADBE Mask Shape': { name: 'Mask Path', value: null },
  'ADBE Mask Feather': { name: 'Mask Feather', value: [0, 0] },
  'ADBE Light Intensity': { name: 'Intensity', value: 100 },
};

class KeyframeEase { constructor(speed, influence) { this.speed = speed; this.influence = influence; } }
const KeyframeInterpolationType = { LINEAR: 6612, BEZIER: 6613, HOLD: 6614 };

class MockProp {
  constructor(matchName, opts = {}) {
    this.matchName = matchName;
    this.name = opts.name ?? matchName;
    this.isGroup = Boolean(opts.group);
    this.container = Boolean(opts.container);
    this.allowedAdd = opts.allowedAdd ?? null; // null = anything in schema
    this.children = [];
    this.parentProp = null;
    this._value = opts.value === undefined ? null : clone(opts.value);
    this.spatial = Boolean(opts.spatial);
    this.keys = [];
    this._expr = '';
    this._effectCatalog = opts.effectCatalog || null;
    this.propertyIndex = 1;
  }
  get numProperties() { return this.children.length; }
  get numKeys() { return this.keys.length; }
  get canSetExpression() { return !this.isGroup; }
  get expressionEnabled() { return Boolean(this._expr); }
  get expressionError() { return this._exprErr || ''; }
  get expression() { return this._expr; }
  set expression(v) {
    this._expr = String(v);
    // crude syntax screen so the failure path is exercisable: unbalanced parens/brackets
    const open = (this._expr.match(/[([{]/g) || []).length; const close = (this._expr.match(/[)\]}]/g) || []).length;
    this._exprErr = open !== close ? 'Syntax Error: unbalanced brackets' : '';
  }
  get value() { return clone(this._value); }
  property(x) {
    if (typeof x === 'number') return this.children[x - 1] || null;
    return this.children.find((c) => c.matchName === x) || this.children.find((c) => c.name === x) || null;
  }
  canAddProperty(mn) {
    if (!this.container) return false;
    if (this._effectCatalog) return Boolean(this._effectCatalog.has(mn));
    return Boolean(GROUP_NODES[mn] || LEAF_NODES[mn]);
  }
  addProperty(mn) {
    if (!this.canAddProperty(mn)) throw new Error(`Unable to add property "${mn}" to "${this.name}"`);
    let p;
    if (this._effectCatalog) p = buildEffect(mn, this._effectCatalog.get(mn));
    else p = buildNode(mn);
    p.parentProp = this;
    p.propertyIndex = this.children.length + 1;
    this.children.push(p);
    return p;
  }
  remove() {
    if (!this.parentProp) throw new Error('cannot remove root property');
    const sib = this.parentProp.children;
    sib.splice(sib.indexOf(this), 1);
    sib.forEach((c, i) => { c.propertyIndex = i + 1; });
  }
  setValue(v) { this._value = clone(v); }
  setValueAtTime(t, v) {
    const key = { t, v: clone(v), inEase: null, outEase: null, interp: KeyframeInterpolationType.BEZIER };
    const i = this.keys.findIndex((k) => Math.abs(k.t - t) < 1e-9);
    if (i >= 0) this.keys[i] = key; else { this.keys.push(key); this.keys.sort((a, b) => a.t - b.t); }
    this._value = clone(v);
  }
  keyTime(i) { return this.keys[i - 1].t; }
  keyValue(i) { return clone(this.keys[i - 1].v); }
  removeKey(i) { this.keys.splice(i - 1, 1); }
  nearestKeyIndex(t) {
    let best = 1; let d = Infinity;
    this.keys.forEach((k, i) => { if (Math.abs(k.t - t) < d) { d = Math.abs(k.t - t); best = i + 1; } });
    return best;
  }
  _dims() { return this.spatial ? 1 : (Array.isArray(this._value) ? this._value.length : 1); }
  keyInTemporalEase(i) { const k = this.keys[i - 1]; return k.inEase || Array.from({ length: this._dims() }, () => new KeyframeEase(0, 33.33)); }
  keyOutTemporalEase(i) { const k = this.keys[i - 1]; return k.outEase || Array.from({ length: this._dims() }, () => new KeyframeEase(0, 33.33)); }
  setTemporalEaseAtKey(i, inE, outE) {
    const d = this._dims();
    if (inE && inE.length !== d) throw new Error(`Bad ease dimension: expected ${d}, got ${inE.length}`);
    if (outE && outE.length !== d) throw new Error(`Bad ease dimension: expected ${d}, got ${outE.length}`);
    if (inE) this.keys[i - 1].inEase = inE;
    if (outE) this.keys[i - 1].outEase = outE;
  }
  setInterpolationTypeAtKey(i, a) { this.keys[i - 1].interp = a; }
  valueAtTime(t) {
    if (!this.keys.length) return this.value;
    const ks = this.keys;
    if (t <= ks[0].t) return clone(ks[0].v);
    if (t >= ks[ks.length - 1].t) return clone(ks[ks.length - 1].v);
    for (let i = 0; i < ks.length - 1; i++) {
      if (t >= ks[i].t && t <= ks[i + 1].t) {
        const u = (t - ks[i].t) / (ks[i + 1].t - ks[i].t);
        const a = ks[i].v; const b = ks[i + 1].v;
        if (typeof a === 'number' && typeof b === 'number') return a + (b - a) * u;
        if (Array.isArray(a) && Array.isArray(b)) return a.map((x, j) => x + (b[j] - x) * u);
        return clone(a);
      }
    }
    return this.value;
  }
}

function clone(v) {
  if (v === null || v === undefined) return v;
  if (Array.isArray(v)) return v.map(clone);
  if (typeof v === 'object') { const o = Object.create(Object.getPrototypeOf(v)); for (const k of Object.keys(v)) o[k] = clone(v[k]); return o; }
  return v;
}

function buildNode(mn) {
  if (GROUP_NODES[mn]) {
    const g = GROUP_NODES[mn];
    const p = new MockProp(mn, { name: g.name, group: true, container: g.container });
    for (const c of g.children || []) { const ch = buildNode(c); ch.parentProp = p; ch.propertyIndex = p.children.length + 1; p.children.push(ch); }
    return p;
  }
  const l = LEAF_NODES[mn];
  if (!l) throw new Error(`unknown property ${mn}`);
  return new MockProp(mn, { name: l.name, value: l.value, spatial: l.spatial });
}

function buildEffect(mn, def) {
  const p = new MockProp(mn, { name: def.displayName, group: true });
  def.params.forEach(([pm, pn, pv], i) => {
    const c = new MockProp(pm, { name: pn, value: pv });
    c.parentProp = p; c.propertyIndex = i + 1; p.children.push(c);
  });
  return p;
}

class MarkerValue { constructor(comment) { this.comment = comment; this.duration = 0; } }
class Shape { constructor() { this.vertices = []; this.inTangents = []; this.outTangents = []; this.closed = true; } }
class TextDocument {
  constructor(text) {
    this.text = text; this.fontSize = 72; this.font = 'ArialMT'; this.fillColor = [1, 1, 1]; this.applyFill = true; this.applyStroke = false;
    this.strokeColor = [0, 0, 0]; this.strokeWidth = 0; this.justification = 7415; this.tracking = 0; this.leading = 0; this.autoLeading = true; this.allCaps = false;
  }
  resetCharStyle() { this.fontSize = 72; this.fillColor = [1, 1, 1]; }
}

// ---- items & layers ---------------------------------------------------------------------------
class ItemBase {
  constructor(project, name) { this.project = project; this.name = name; this.id = ++project._nextId; this.parentFolder = project.rootFolder || null; this.comment = ''; }
  remove() { const a = this.project._items; a.splice(a.indexOf(this), 1); }
}
class FolderItem extends ItemBase {
  get numItems() { return this.project._items.filter((i) => i.parentFolder === this).length; }
  item(n) { return this.project._items.filter((i) => i.parentFolder === this)[n - 1]; }
}
class FootageItem extends ItemBase {
  constructor(project, name, file, meta) {
    super(project, name);
    this.file = file; this.width = meta.width; this.height = meta.height; this.duration = meta.duration;
    this.frameRate = meta.fps || 0; this.hasVideo = meta.hasVideo; this.hasAudio = meta.hasAudio;
    this.mainSource = { isStill: meta.isStill };
    this.pixelAspect = 1;
  }
  get footageMissing() { return !this.file.exists; }
}
class SolidSource {}

class CompItem extends ItemBase {
  constructor(project, name, w, h, pa, dur, fps) {
    super(project, name);
    Object.assign(this, { width: w, height: h, pixelAspect: pa, duration: dur, frameRate: fps });
    this.bgColor = [0, 0, 0]; this.workAreaStart = 0; this.workAreaDuration = dur; this.motionBlur = false; this.shutterAngle = 180;
    this._layers = [];
    this.markerProperty = new MockProp('ADBE Marker', { name: 'Marker', value: null });
    this.layers = new LayerCollection(this);
  }
  get numLayers() { return this._layers.length; }
  layer(x) {
    if (typeof x === 'number') { const l = this._layers[x - 1]; if (!l) throw new Error(`Layer index out of range: ${x}`); return l; }
    const l = this._layers.find((y) => y.name === x);
    if (!l) throw new Error(`Layer not found: ${x}`);
    return l;
  }
}
class AVLayer {}
class TextLayer extends AVLayer {}
class ShapeLayer extends AVLayer {}
class CameraLayer {}
class LightLayer {}

const BlendingMode = { NORMAL: 1, ADD: 2, SCREEN: 3, MULTIPLY: 4, OVERLAY: 5, SOFT_LIGHT: 6, HARD_LIGHT: 7, LIGHTEN: 8, DARKEN: 9, DIFFERENCE: 10, COLOR_DODGE: 11, LINEAR_DODGE: 12 };
const TrackMatteType = { NO_TRACK_MATTE: 0, ALPHA: 1, ALPHA_INVERTED: 2, LUMA: 3, LUMA_INVERTED: 4 };

function makeLayer(comp, Cls, { name, source = null, kind, duration, hasAudio = false }) {
  const l = new Cls();
  l.comp = comp; l.name = name; l.source = source; l.enabled = true; l.locked = false; l.solo = false; l.shy = false; l.label = 1; l.comment = '';
  l._start = 0; l._in = 0; l._out = duration ?? comp.duration; l._stretch = 100; l._parent = null;
  l.threeDLayer = false; l.motionBlur = false; l.adjustmentLayer = false; l.nullLayer = kind === 'null'; l.blendingMode = BlendingMode.NORMAL;
  l.hasAudio = hasAudio; l.audioEnabled = hasAudio; l.trackMatteType = 0; l._kind = kind;
  const root = new MockProp('ROOT', { name: 'root', group: true });
  const add = (mn) => { const n = buildNode(mn); n.parentProp = root; n.propertyIndex = root.children.length + 1; root.children.push(n); return n; };
  if (kind === 'camera') {
    const t = add('ADBE Transform Group');
    t.children = ['ADBE Point of Interest', 'ADBE Position', 'ADBE Orientation', 'ADBE Rotate X', 'ADBE Rotate Y', 'ADBE Rotate Z'].map((m, i) => { const c = buildNode(m); c.parentProp = t; c.propertyIndex = i + 1; return c; });
  } else if (kind === 'light') {
    add('ADBE Transform Group'); add('ADBE Light Options Group');
  } else {
    add('ADBE Transform Group');
    const t = root.property('ADBE Transform Group');
    t.property('ADBE Position')._value = [comp.width / 2, comp.height / 2];
    if (source && source.width && kind !== 'text') t.property('ADBE Anchor Point')._value = [source.width / 2, source.height / 2];
    if (hasAudio) add('ADBE Audio Group');
    if (kind === 'text') add('ADBE Text Properties');
    if (kind === 'shape') add('ADBE Root Vectors Group');
  }
  const effects = add('ADBE Effect Parade');
  effects._effectCatalog = comp.project._app._effectCatalog;
  if (kind !== 'camera' && kind !== 'light') add('ADBE Mask Parade');
  add('ADBE Marker');
  l._root = root;
  l.property = (x) => root.property(x);
  return l;
}

const layerProto = {
  get index() { return this.comp._layers.indexOf(this) + 1; },
  get startTime() { return this._start; },
  set startTime(v) { const d = v - this._start; this._start = v; this._in += d; this._out += d; },
  get inPoint() { return this._in; },
  set inPoint(v) { this._in = v; },
  get outPoint() { return this._out; },
  set outPoint(v) { this._out = v; },
  get stretch() { return this._stretch; },
  set stretch(v) { this._stretch = v; },
  get parent() { return this._parent; },
  set parent(v) { this._parent = v; },
  get isTrackMatte() { return false; },
  remove() { const a = this.comp._layers; a.splice(a.indexOf(this), 1); },
  moveToBeginning() { const a = this.comp._layers; a.splice(a.indexOf(this), 1); a.unshift(this); },
  moveToEnd() { const a = this.comp._layers; a.splice(a.indexOf(this), 1); a.push(this); },
  moveAfter(o) { const a = this.comp._layers; a.splice(a.indexOf(this), 1); a.splice(a.indexOf(o) + 1, 0, this); },
  moveBefore(o) { const a = this.comp._layers; a.splice(a.indexOf(this), 1); a.splice(a.indexOf(o), 0, this); },
  setTrackMatte(matte, type) { this.trackMatteType = type; this._matte = matte; },
  sourceRectAtTime() {
    if (this._kind === 'text') {
      const doc = this._root.property('ADBE Text Properties').property('ADBE Text Document')._value;
      const lines = String(doc.text).split(/\r|\n/);
      const w = Math.max(...lines.map((s) => s.length)) * doc.fontSize * 0.55;
      const left = doc.justification === 7414 ? 0 : (doc.justification === 7415 ? -w : -w / 2);
      return { left: doc.justification === 7414 ? 0 : left, top: -doc.fontSize * 0.8, width: w, height: lines.length * doc.fontSize * 1.2 };
    }
    if (this._kind === 'shape') {
      const walk = (p, acc) => { for (const c of p.children) { if (c.matchName === 'ADBE Vector Rect Size' || c.matchName === 'ADBE Vector Ellipse Size') acc.push(c._value); walk(c, acc); } return acc; };
      const sizes = walk(this._root.property('ADBE Root Vectors Group'), []);
      const s = sizes[0] || [100, 100];
      return { left: -s[0] / 2, top: -s[1] / 2, width: s[0], height: s[1] };
    }
    const s = this.source || { width: 0, height: 0 };
    return { left: 0, top: 0, width: s.width, height: s.height };
  },
};
Object.defineProperty(layerProto, 'threeD', { get() { return this.threeDLayer; } });

class LayerCollection {
  constructor(comp) { this.comp = comp; }
  _push(l) {
    Object.defineProperties(l, Object.getOwnPropertyDescriptors(layerProto));
    // threeDLayer promotes 2D vectors to 3D, like AE
    let td = false;
    Object.defineProperty(l, 'threeDLayer', {
      get: () => td,
      set: (v) => {
        td = Boolean(v);
        if (td) {
          const t = l._root.property('ADBE Transform Group');
          for (const m of ['ADBE Anchor Point', 'ADBE Position', 'ADBE Scale']) { const p = t.property(m); if (p && p._value.length === 2) p._value.push(m === 'ADBE Scale' ? 100 : 0); }
        }
      },
    });
    // Time Remap exists only once enabled, and never for stills/solids (as in After Effects)
    let tre = false;
    Object.defineProperty(l, 'timeRemapEnabled', {
      get: () => tre,
      set: (v) => {
        if (v && !tre) {
          const src = l.source;
          if (!src || src.mainSource?.isStill || !(src.duration > 0) || src instanceof SolidSource || src.mainSource instanceof SolidSource) throw new Error('Time remapping is not available for this layer');
          const p = buildNode('ADBE Time Remapping'); p.parentProp = l._root; p.propertyIndex = l._root.children.length + 1; l._root.children.push(p);
          p.setValueAtTime(0, 0); p.setValueAtTime(src.duration, src.duration);
        }
        tre = Boolean(v);
      },
    });
    l.frameBlendingType = 4012;
    this.comp._layers.unshift(l);
    return l;
  }
  add(item, duration) {
    const isComp = item instanceof CompItem;
    const dur = duration ?? (isComp || item.duration > 0 ? Math.min(item.duration, 1e9) : this.comp.duration);
    const stillDur = item instanceof FootageItem && item.mainSource.isStill ? this.comp.duration : dur;
    const audioOnly = item instanceof FootageItem && !item.hasVideo;
    const l = makeLayer(this.comp, AVLayer, { name: item.name, source: item, kind: 'footage', duration: Math.min(stillDur, isComp ? item.duration : stillDur), hasAudio: Boolean(item.hasAudio || isComp) });
    if (audioOnly) l._audioOnly = true;
    return this._push(l);
  }
  addSolid(color, name, w, h, pa, duration) {
    const src = Object.assign(new SolidSource(), { width: w, height: h });
    const item = { name, width: w, height: h, duration: 0, mainSource: src, hasAudio: false };
    const l = makeLayer(this.comp, AVLayer, { name, source: item, kind: 'solid', duration });
    l.solidColor = color;
    return this._push(l);
  }
  addNull(duration) { return this._push(makeLayer(this.comp, AVLayer, { name: 'Null', kind: 'null', duration })); }
  addText(text) {
    const l = makeLayer(this.comp, TextLayer, { name: String(text).slice(0, 24), kind: 'text' });
    l._root.property('ADBE Text Properties').property('ADBE Text Document')._value = new TextDocument(String(text));
    return this._push(l);
  }
  addBoxText(size, text) { const l = this.addText(text); l.boxSize = size; return l; }
  addShape() { return this._push(makeLayer(this.comp, ShapeLayer, { name: 'Shape Layer', kind: 'shape' })); }
  addCamera(name) { return this._push(makeLayer(this.comp, CameraLayer, { name, kind: 'camera' })); }
  addLight(name) { return this._push(makeLayer(this.comp, LightLayer, { name, kind: 'light' })); }
}

// ---- project & application --------------------------------------------------------------------
class RenderQueueItem {
  constructor(queue, comp) {
    this.queue = queue; this.comp = comp; this.status = 3013; this.timeSpanStart = 0; this.timeSpanDuration = comp.duration;
    this.templates = ['Best Settings', 'Draft Settings', 'DV Settings', 'Multi-Machine Settings'];
    const om = { templates: ['Lossless', 'Lossless with Alpha', 'H.264 - Match Render Settings - 15 Mbps', 'AIFF 48kHz', 'ProRes 422 HQ'], file: null, applyTemplate(n) { if (!this.templates.includes(n)) throw new Error('No such template: ' + n); this.template = n; } };
    this._om = om;
  }
  get index() { return this.queue._items.indexOf(this) + 1; }
  applyTemplate(n) { if (!this.templates.includes(n)) throw new Error('No such template: ' + n); this.template = n; }
  outputModule() { return this._om; }
  remove() { const a = this.queue._items; a.splice(a.indexOf(this), 1); }
}
class RenderQueue {
  constructor() { this._items = []; this.queuedInAME = 0; const q = this; this.items = { add: (comp) => { const it = new RenderQueueItem(q, comp); q._items.push(it); return it; } }; }
  get numItems() { return this._items.length; }
  item(i) { return this._items[i - 1]; }
  queueInAME(start) { this.queuedInAME++; this.ameStarted = Boolean(start); }
}

function indexedItems(project) {
  return new Proxy({}, {
    get(_, k) {
      if (k === 'length') return project._items.length;
      if (k === 'addComp') return (n, w, h, pa, d, f) => { const c = new CompItem(project, n, w, h, pa, d, f); project._items.push(c); return c; };
      if (k === 'addFolder') return (n) => { const f = new FolderItem(project, n); project._items.push(f); return f; };
      const i = Number(k);
      if (Number.isInteger(i)) return project._items[i - 1];
      return undefined;
    },
  });
}

class MockFile {
  constructor(p) { this._p = path.resolve(String(p)); this.encoding = 'UTF-8'; this.error = ''; }
  get fsName() { return this._p; }
  get name() { return path.basename(this._p); }
  get exists() { return fs.existsSync(this._p); }
  get parent() { return new MockFolder(path.dirname(this._p)); }
  open(mode) { this._mode = mode; this._buf = ''; return true; }
  read() { return fs.readFileSync(this._p, 'utf8'); }
  write(s) { this._buf += s; return true; }
  close() { if (this._mode === 'w') { fs.mkdirSync(path.dirname(this._p), { recursive: true }); fs.writeFileSync(this._p, this._buf); } return true; }
  remove() { try { fs.unlinkSync(this._p); return true; } catch { return false; } }
  rename(n) { const dest = path.join(path.dirname(this._p), n); fs.renameSync(this._p, dest); this._p = dest; return true; }
}
class MockFolder {
  constructor(p) { this._p = path.resolve(String(p)); }
  get fsName() { return this._p; }
  get exists() { return fs.existsSync(this._p); }
  create() { fs.mkdirSync(this._p, { recursive: true }); return true; }
  getFiles(mask) {
    const re = new RegExp('^' + String(mask || '*').replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*') + '$');
    try { return fs.readdirSync(this._p).filter((n) => re.test(n)).map((n) => new MockFile(path.join(this._p, n))); } catch { return []; }
  }
}

const IMAGE = /\.(png|jpe?g|gif|bmp|tiff?|webp|psd|ai|svg|exr)$/i;
const VIDEO = /\.(mp4|mov|m4v|avi|mkv|webm|mxf|mpg|mpeg|r3d|prores)$/i;
const AUDIO = /\.(wav|mp3|aif|aiff|aac|m4a|flac|ogg)$/i;

function defaultProbe(file) {
  const n = file.fsName;
  if (IMAGE.test(n)) return { width: 1920, height: 1080, duration: 0, fps: 0, hasVideo: true, hasAudio: false, isStill: true };
  if (VIDEO.test(n)) return { width: 1920, height: 1080, duration: 10, fps: 24, hasVideo: true, hasAudio: true, isStill: false };
  if (AUDIO.test(n)) return { width: 0, height: 0, duration: 60, fps: 0, hasVideo: false, hasAudio: true, isStill: false };
  return null;
}

/**
 * Build a mock After Effects instance. Returns { context, app, state, run(code), call(request), pump() }.
 */
export function createMockAE({ effects = DEFAULT_EFFECTS, version = '25.0x57', probe = defaultProbe, fonts, allowFileAccess = true, withBundle = true } = {}) {
  const effectCatalog = new Map(effects.map(([mn, dn, cat, params]) => [mn, { displayName: dn, category: cat, params }]));
  const tasks = [];
  const project = { _items: [], _nextId: 0, dirty: false, file: null, renderQueue: new RenderQueue() };
  const state = { project, undoDepth: 0, saved: [] };
  project.rootFolder = new FolderItem(project, 'Root');
  project.rootFolder.parentFolder = null;
  project.items = indexedItems(project);
  Object.defineProperty(project, 'numItems', { get: () => project._items.length });
  project.item = (i) => project._items[i - 1];
  project.importFile = (io) => {
    const meta = probe(io.file);
    if (!meta) throw new Error('Unsupported file');
    const it = new FootageItem(project, io.file.name, io.file, meta);
    project._items.push(it); project.dirty = true;
    return it;
  };
  project.save = (f) => {
    if (f) project.file = f;
    if (!project.file) throw new Error('no file');
    fs.mkdirSync(path.dirname(project.file.fsName), { recursive: true });
    fs.writeFileSync(project.file.fsName, JSON.stringify({ mock: 'MOCK-AEP', items: project._items.map((i) => ({ name: i.name, type: i.constructor.name, ...(i instanceof CompItem ? { width: i.width, height: i.height, duration: i.duration, fps: i.frameRate } : {}) })) }));
    project.dirty = false; state.saved.push(project.file.fsName);
  };
  project.close = () => { project._items.length = 0; project.file = null; project.dirty = false; project.renderQueue = new RenderQueue(); };
  project._app = { _effectCatalog: effectCatalog };

  const app = {
    version, buildName: 'Mock Build', isoLanguage: 'en_US', project,
    effects: effects.map(([mn, dn, cat]) => ({ matchName: mn, displayName: dn, category: cat })),
    preferences: { getPrefAsLong: () => (allowFileAccess ? 1 : 0), savePrefAsLong() {}, saveToDisk() {} },
    beginUndoGroup() { state.undoDepth++; }, endUndoGroup() { state.undoDepth--; },
    scheduleTask(code, delay) { tasks.push({ code, due: Date.now() + delay }); return tasks.length; },
    newProject() { project.close(); return project; },
    open(f) { if (!f.exists) throw new Error('file does not exist'); project.file = f; return project; },
  };
  if (fonts) app.fonts = { allFonts: fonts };
  else app.fonts = { allFonts: [[{ postScriptName: 'ArialMT', familyName: 'Arial', styleName: 'Regular' }, { postScriptName: 'Arial-BoldMT', familyName: 'Arial', styleName: 'Bold' }], [{ postScriptName: 'Impact', familyName: 'Impact', styleName: 'Regular' }]] };

  class ImportOptions { constructor(file) { this.file = file; } canImportAs() { return Boolean(probe(this.file)); } }

  const sandbox = {
    app, $: { os: 'Mock OS', writeln() {}, sleep() {}, global: null },
    File: function File(p) { return new MockFile(p); }, Folder: function Folder(p) { return new MockFolder(p); },
    ImportOptions, ImportAsType: { FOOTAGE: 1, COMP: 2 }, CloseOptions: { DO_NOT_SAVE_CHANGES: 1 },
    CompItem, FootageItem, FolderItem, AVLayer, TextLayer, ShapeLayer, CameraLayer, LightLayer, SolidSource,
    BlendingMode, TrackMatteType, ParagraphJustification: { LEFT_JUSTIFY: 7414, CENTER_JUSTIFY: 7413, RIGHT_JUSTIFY: 7415 },
    KeyframeEase, KeyframeInterpolationType, MarkerValue, Shape, FrameBlendingType: { NO_FRAME_BLEND: 4012, FRAME_MIX: 4013, PIXEL_MOTION: 4014 },
  };
  sandbox.File.prototype = MockFile.prototype; sandbox.Folder.prototype = MockFolder.prototype;
  const context = vm.createContext(sandbox);
  context.$.global = context;
  // Force the ES3 JSON polyfill to be the one under test.
  vm.runInContext('delete globalThis.JSON;', context);
  if (withBundle) vm.runInContext(buildHostBundle(), context, { filename: 'xoxo_host.jsx' });

  const mock = {
    context, app, state, effects: effectCatalog,
    run: (code, filename = 'script.jsx') => vm.runInContext(code, context, { filename }),
    /** Execute one bridge request through the host's own JSON polyfill, as After Effects would. */
    call(request) {
      context.__req = JSON.stringify(request);
      const out = vm.runInContext('JSON.stringify(XOXO.handle(JSON.parse(__req)))', context);
      return JSON.parse(out);
    },
    /** Run any scheduled tasks that are due (listener polling). */
    pump(now = Date.now() + 1e9) {
      const due = tasks.splice(0).filter((t) => { if (t.due <= now) return true; tasks.push(t); return false; });
      for (const t of due) vm.runInContext(t.code, context);
      return due.length;
    },
    get pendingTasks() { return tasks.length; },
  };
  return mock;
}
