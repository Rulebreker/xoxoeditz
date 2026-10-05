// XOXOEDITZ host -- layer creation and layer settings (ES3 only).

// A freshly added layer is already named after its source, so it must not count as a clash with itself.
XOXO.nameTaken = function (comp, name, except) {
  for (var i = 1; i <= comp.numLayers; i++) {
    var l = comp.layer(i);
    if (except && l.index === except.index) continue;
    if (l.name === name) return true;
  }
  return false;
};

XOXO.uniqueName = function (comp, name, except) {
  if (!XOXO.nameTaken(comp, name, except)) return name;
  var n = 2;
  while (XOXO.nameTaken(comp, name + "_" + n, except)) n++;
  return name + "_" + n;
};

XOXO.timing = function (layer, a) {
  // a.start/a.end are comp times (seconds).
  if (a.startTime !== undefined) layer.startTime = a.startTime;
  if (a.start !== undefined) layer.inPoint = a.start;
  if (a.end !== undefined) layer.outPoint = a.end;
};

XOXO.describeLayer = function (layer) {
  return { name: layer.name, index: layer.index, inPoint: layer.inPoint, outPoint: layer.outPoint };
};

// Ownership / identity marker kept in Layer.comment: "XOXO|k=text|role=TITLE|id=TXT_TITLE_01|shot=S01|rest=1.25".
// It lets later builds recognise (and prune) the layers XOXOEDITZ generated without ever touching a user's layers.
XOXO.MARK = "XOXO";
XOXO.formatMark = function (m) {
  var out = [XOXO.MARK];
  if (!m) return out[0] + "|gen=1";
  for (var k in m) { if (m.hasOwnProperty(k) && m[k] !== undefined && m[k] !== null && m[k] !== "") out.push(k + "=" + String(m[k]).replace(/[|=]/g, "_")); }
  return out.join("|");
};
XOXO.parseMark = function (comment) {
  var s = String(comment || "");
  if (s.indexOf(XOXO.MARK + "|") !== 0) return null;
  var parts = s.split("|");
  var m = {};
  for (var i = 1; i < parts.length; i++) {
    var eq = parts[i].indexOf("=");
    if (eq > 0) m[parts[i].substr(0, eq)] = parts[i].substr(eq + 1);
  }
  return m;
};
XOXO.setMark = function (layer, mark) {
  try { layer.comment = XOXO.formatMark(mark); return true; } catch (e) { return false; }
};
XOXO.layerMark = function (layer) {
  try { return XOXO.parseMark(layer.comment); } catch (e) { return null; }
};

XOXO.finishLayer = function (comp, layer, a) {
  if (a.name) layer.name = a.name;
  XOXO.timing(layer, a);
  XOXO.setMark(layer, a.mark || null);
  if (a.label !== undefined) layer.label = a.label;
  if (a.threeD) layer.threeDLayer = true;
  if (a.motionBlur) layer.motionBlur = true;
  if (a.blend) XOXO.setBlend(layer, a.blend);
  if (a.opacity !== undefined) XOXO.prop(layer, "opacity").setValue(a.opacity);
  if (a.position) XOXO.prop(layer, "position").setValue(XOXO.coerce(XOXO.prop(layer, "position"), a.position));
  if (a.scale) XOXO.prop(layer, "scale").setValue(XOXO.coerce(XOXO.prop(layer, "scale"), a.scale));
  if (a.rotation !== undefined) XOXO.prop(layer, "rotation").setValue(a.rotation);
  if (a.parent) layer.parent = XOXO.getLayer(comp, a.parent);
  return XOXO.describeLayer(layer);
};

XOXO.setBlend = function (layer, name) {
  var map = {
    normal: BlendingMode.NORMAL, add: BlendingMode.ADD, screen: BlendingMode.SCREEN, multiply: BlendingMode.MULTIPLY,
    overlay: BlendingMode.OVERLAY, softlight: BlendingMode.SOFT_LIGHT, hardlight: BlendingMode.HARD_LIGHT,
    lighten: BlendingMode.LIGHTEN, darken: BlendingMode.DARKEN, difference: BlendingMode.DIFFERENCE,
    colordodge: BlendingMode.COLOR_DODGE, lineardodge: BlendingMode.LINEAR_DODGE
  };
  var m = map[String(name).toLowerCase().replace(/[^a-z]/g, "")];
  if (m === undefined) throw XOXO.err("unknown blend mode: " + name, "BAD_ARGS", false);
  layer.blendingMode = m;
};

XOXO.op("layer_add_footage", function (a) {
  XOXO.need(a, ["comp", "item", "name"]);
  var comp = XOXO.getComp(a.comp);
  var item = XOXO.findItem(a.item, "footage");
  if (!item) item = XOXO.findItem(a.item, "comp");
  if (!item) throw XOXO.err("project item not found: " + a.item, "ITEM_NOT_FOUND", true);
  if (item.footageMissing) throw XOXO.err("footage is missing on disk: " + a.item, "FOOTAGE_MISSING", false);
  var layer = comp.layers.add(item);
  layer.name = XOXO.uniqueName(comp, a.name, layer);
  // speed: 1 = normal, 2 = twice as fast. AE "stretch" is a duration percentage.
  var speed = XOXO.def(a.speed, 1);
  if (speed !== 1) layer.stretch = 100 / speed;
  var srcIn = XOXO.def(a.sourceIn, 0);
  var start = XOXO.def(a.start, 0);
  // place source time `srcIn` at comp time `start`
  layer.startTime = start - srcIn * (layer.stretch / 100);
  if (a.start !== undefined) layer.inPoint = start;
  if (a.end !== undefined) layer.outPoint = a.end;
  if (a.fit && item.width && item.height) {
    var sx = comp.width / item.width, sy = comp.height / item.height;
    var s = (a.fit === "cover") ? Math.max(sx, sy) : (a.fit === "contain" ? Math.min(sx, sy) : 1);
    layer.property("ADBE Transform Group").property("ADBE Scale").setValue([s * 100, s * 100]);
    layer.property("ADBE Transform Group").property("ADBE Position").setValue([comp.width / 2, comp.height / 2]);
  }
  if (a.hideVideo) layer.enabled = false; // keeps audio, hides video
  var r = XOXO.finishLayer(comp, layer, { label: a.label, threeD: a.threeD, motionBlur: a.motionBlur, blend: a.blend, opacity: a.opacity });
  r.baseScale = layer.property("ADBE Transform Group").property("ADBE Scale").value[0];
  return r;
});

XOXO.op("layer_add_solid", function (a) {
  XOXO.need(a, ["comp", "name"]);
  var comp = XOXO.getComp(a.comp);
  var w = XOXO.def(a.width, comp.width), h = XOXO.def(a.height, comp.height);
  var layer = comp.layers.addSolid(XOXO.color(XOXO.def(a.color, "#000000")), a.name, w, h, 1, XOXO.def(a.duration, comp.duration));
  return XOXO.finishLayer(comp, layer, { name: XOXO.uniqueName(comp, a.name, layer), start: a.start, end: a.end, opacity: a.opacity, blend: a.blend, threeD: a.threeD, position: a.position });
});

XOXO.op("layer_add_null", function (a) {
  XOXO.need(a, ["comp", "name"]);
  var comp = XOXO.getComp(a.comp);
  var layer = comp.layers.addNull(XOXO.def(a.duration, comp.duration));
  return XOXO.finishLayer(comp, layer, { name: XOXO.uniqueName(comp, a.name, layer), start: a.start, end: a.end, position: a.position, threeD: a.threeD });
});

XOXO.op("layer_add_adjustment", function (a) {
  XOXO.need(a, ["comp", "name"]);
  var comp = XOXO.getComp(a.comp);
  var layer = comp.layers.addSolid([1, 1, 1], a.name, comp.width, comp.height, 1, XOXO.def(a.duration, comp.duration));
  layer.adjustmentLayer = true;
  return XOXO.finishLayer(comp, layer, { name: XOXO.uniqueName(comp, a.name, layer), start: a.start, end: a.end, opacity: a.opacity });
});

// Sets a TextDocument attribute that is nice to have but must never fail the layer (After Effects versions differ in
// which attributes are writable; 2026 made some read-only). Returns true when it was applied.
XOXO.trySet = function (obj, key, value, warnings, label) {
  try { obj[key] = value; return true; } catch (e) { if (warnings) warnings.push((label || key) + " not applied: " + e.message); return false; }
};

// Text is created ATOMICALLY: if anything required fails after the layer exists, the layer is removed again, so a
// failed alternative never leaves a full-length orphan layer (named after its text) behind. Identity (name, in, out,
// ownership mark) is applied before any styling, so even a partially styled layer is never anonymous.
// Upper-casing is presentation logic done on the STRING: the read-only TextDocument.allCaps is never written.
XOXO.op("layer_add_text", function (a) {
  XOXO.need(a, ["comp", "name", "text"]);
  var comp = XOXO.getComp(a.comp);
  var txt = String(a.text).replace(/\r?\n/g, "\r"); // After Effects separates paragraphs with \r
  if (a.caps === "upper" || a.allCaps) txt = txt.toUpperCase();
  // deterministic ids: a leftover layer with this exact name is replaced, never suffixed (_2)
  XOXO.removeNamed(comp, a.name);
  var layer = a.box ? comp.layers.addBoxText(a.box, txt) : comp.layers.addText(txt);
  var warnings = [];
  try {
    layer.name = a.name;
    XOXO.timing(layer, a);
    XOXO.setMark(layer, a.mark || { k: "text", role: a.role, id: a.name });
    var tp = layer.property("ADBE Text Properties").property("ADBE Text Document");
    var td = tp.value;
    td.resetCharStyle();
    td.fontSize = XOXO.def(a.size, 72);
    td.applyFill = true;
    td.fillColor = XOXO.color(XOXO.def(a.color, "#ffffff"));
    if (a.stroke) {
      XOXO.trySet(td, "applyStroke", true, warnings, "stroke");
      XOXO.trySet(td, "strokeColor", XOXO.color(a.stroke), warnings, "stroke colour");
      XOXO.trySet(td, "strokeWidth", XOXO.def(a.strokeWidth, 2), warnings, "stroke width");
    }
    if (a.font) XOXO.trySet(td, "font", a.font, warnings, "font " + a.font);
    var j = String(XOXO.def(a.justify, "center"));
    td.justification = (j === "left") ? ParagraphJustification.LEFT_JUSTIFY : (j === "right" ? ParagraphJustification.RIGHT_JUSTIFY : ParagraphJustification.CENTER_JUSTIFY);
    if (a.tracking !== undefined) XOXO.trySet(td, "tracking", a.tracking, warnings, "tracking");
    if (a.leading !== undefined) { XOXO.trySet(td, "autoLeading", false, warnings, "leading"); XOXO.trySet(td, "leading", a.leading, warnings, "leading"); }
    tp.setValue(td);
    var tr = layer.property("ADBE Transform Group");
    tr.property("ADBE Position").setValue(XOXO.def(a.position, [comp.width / 2, comp.height / 2]));
    if (a.opacity !== undefined) tr.property("ADBE Opacity").setValue(a.opacity);
    if (a.blend) XOXO.setBlend(layer, a.blend);
    if (a.threeD) layer.threeDLayer = true;
    if (a.label !== undefined) layer.label = a.label;
  } catch (e) {
    try { layer.remove(); } catch (e2) { }
    throw e;
  }
  var r = XOXO.describeLayer(layer);
  r.warnings = warnings;
  return r;
});

// Remove every layer called exactly `name` (unlocking first). Returns how many were removed.
XOXO.removeNamed = function (comp, name) {
  var n = 0;
  for (var i = comp.numLayers; i >= 1; i--) {
    var l = comp.layer(i);
    if (l.name === name) { try { l.locked = false; } catch (e) { } l.remove(); n++; }
  }
  return n;
};

XOXO.op("text_set", function (a) {
  XOXO.need(a, ["comp", "layer"]);
  var comp = XOXO.getComp(a.comp);
  var layer = XOXO.getLayer(comp, a.layer);
  var tp = layer.property("ADBE Text Properties").property("ADBE Text Document");
  var td = tp.value;
  if (a.text !== undefined) td.text = String(a.text).replace(/\n/g, "\r");
  if (a.size !== undefined) td.fontSize = a.size;
  if (a.color) td.fillColor = XOXO.color(a.color);
  tp.setValue(td);
  return { ok: true };
});

// ---- text measurement & fitting -------------------------------------------------------------------------------
// The time at which a text layer is "at rest" (entrance finished, exit not started): the ownership mark carries it
// (rest=<seconds>); otherwise 70 % into the layer's interval. Bounds are ALWAYS measured there, never at comp time 0,
// because an entrance animation (e.g. a 165 % scale punch) inflates the box at the first keyframe.
XOXO.restTime = function (layer, at) {
  var t;
  if (at !== undefined && at !== null) t = at;
  else {
    var m = XOXO.layerMark(layer);
    var r = m && m.rest !== undefined ? parseFloat(m.rest) : NaN;
    t = isNaN(r) ? layer.inPoint + 0.7 * (layer.outPoint - layer.inPoint) : r;
  }
  if (t < layer.inPoint) t = layer.inPoint;
  if (t > layer.outPoint - 0.0001) t = layer.outPoint - 0.0001;
  return t;
};

// Comp-space rectangle of a layer's source rect at time t (position/anchor/scale; rotation and 3D are ignored).
XOXO.compRect = function (layer, t) {
  var r = layer.sourceRectAtTime(t, false);
  var tr = layer.property("ADBE Transform Group");
  var pos = tr.property("ADBE Position").valueAtTime(t, false);
  var anc = tr.property("ADBE Anchor Point").valueAtTime(t, false);
  var sc = tr.property("ADBE Scale").valueAtTime(t, false);
  var sx = sc[0] / 100, sy = sc[1] / 100;
  return { left: pos[0] + (r.left - anc[0]) * sx, top: pos[1] + (r.top - anc[1]) * sy, width: r.width * sx, height: r.height * sy };
};

// Split words into n lines of similar length (greedy towards the ideal line length).
XOXO.balanceLines = function (words, n) {
  if (n <= 1 || words.length <= 1) return [words.join(" ")];
  if (n > words.length) n = words.length;
  var total = words.length - 1;
  var i;
  for (i = 0; i < words.length; i++) total += words[i].length;
  var target = total / n;
  var lines = [], cur = "";
  for (i = 0; i < words.length; i++) {
    if (!cur) { cur = words[i]; continue; }
    var cand = cur + " " + words[i];
    if (lines.length < n - 1 && Math.abs(cand.length - target) > Math.abs(cur.length - target)) { lines.push(cur); cur = words[i]; }
    else cur = cand;
  }
  lines.push(cur);
  return lines;
};

XOXO.shiftPosition = function (layer, dx, dy) {
  var p = layer.property("ADBE Transform Group").property("ADBE Position");
  var i;
  if (p.numKeys > 0) {
    for (i = 1; i <= p.numKeys; i++) { var v = p.keyValue(i); p.setValueAtTime(p.keyTime(i), [v[0] + dx, v[1] + dy].concat(v.length > 2 ? [v[2]] : [])); }
  } else {
    var c = p.value;
    p.setValue([c[0] + dx, c[1] + dy].concat(c.length > 2 ? [c[2]] : []));
  }
};

// text_fit: make a text layer fit a box (comp pixels) using MEASURED bounds. Wrapping comes first (re-break the same
// words into 1..maxLines balanced lines), then the font size shrinks in 6 % steps, and only as a last resort below
// minSize. The layer is then aligned to `ref` (hAlign/vAlign) and clamped into the box. Never writes Scale, so entrance
// animations stay authoritative. Measuring failures are reported, not thrown (the QA pass re-checks).
XOXO.op("text_fit", function (a) {
  XOXO.need(a, ["comp", "layer", "box"]);
  var comp = XOXO.getComp(a.comp);
  var layer = XOXO.getLayer(comp, a.layer);
  var warnings = [];
  var box = a.box;
  var boxW = box.right - box.left, boxH = box.bottom - box.top;
  var tp = layer.property("ADBE Text Properties").property("ADBE Text Document");
  var td = tp.value;
  var t = XOXO.restTime(layer, a.at);
  var origSize = td.fontSize;
  var minSize = XOXO.def(a.minSize, Math.round(origSize * 0.6));
  var maxLines = XOXO.def(a.maxLines, 3);
  var raw = String(td.text).replace(/[\r\n]+/g, " ").split(" ");
  var words = [];
  var i;
  for (i = 0; i < raw.length; i++) { if (raw[i]) words.push(raw[i]); }
  var startLines = String(td.text).split(/\r|\n/).length;
  var res = { fits: false, reflowed: false, shrunk: false, belowMin: false, fontSize: origSize, lines: startLines, warnings: warnings };
  var rect = null;
  var measure = function (size, lines) {
    td.fontSize = size;
    td.text = lines.join("\r");
    tp.setValue(td);
    return XOXO.compRect(layer, t);
  };
  try {
    rect = XOXO.compRect(layer, t);
    var inBox = function (r) { return r.width <= boxW + 0.5 && r.height <= boxH + 0.5; };
    if (!inBox(rect) && a.reflow !== false && words.length > 0) {
      var size = origSize, found = false, lines, n;
      var guard = 0;
      while (!found && guard < 60) {
        guard++;
        for (n = startLines; n <= maxLines; n++) {
          lines = XOXO.balanceLines(words, n);
          rect = measure(size, lines);
          if (inBox(rect)) { found = true; res.lines = lines.length; break; }
          if (lines.length < n) break;
        }
        if (found) break;
        if (size <= minSize && guard > 1) {
          // last resort: keep shrinking the font (never layer scale) until it fits, floor 8 px
          if (size <= 8) break;
          res.belowMin = true;
        }
        size = Math.max(8, Math.floor(size * 0.94));
      }
      res.reflowed = (res.lines !== startLines);
      res.shrunk = (td.fontSize < origSize);
      res.fontSize = td.fontSize;
    }
    // placement
    rect = XOXO.compRect(layer, t);
    var dx = 0, dy = 0;
    if (a.ref) {
      var h = String(XOXO.def(a.hAlign, "center")), v = String(XOXO.def(a.vAlign, "center"));
      dx = (h === "left") ? a.ref[0] - rect.left : (h === "right" ? a.ref[0] - (rect.left + rect.width) : a.ref[0] - (rect.left + rect.width / 2));
      dy = (v === "top") ? a.ref[1] - rect.top : (v === "bottom" ? a.ref[1] - (rect.top + rect.height) : a.ref[1] - (rect.top + rect.height / 2));
    }
    var l2 = rect.left + dx, t2 = rect.top + dy;
    if (l2 < box.left) dx += box.left - l2; else if (l2 + rect.width > box.right) dx -= (l2 + rect.width) - box.right;
    if (t2 < box.top) dy += box.top - t2; else if (t2 + rect.height > box.bottom) dy -= (t2 + rect.height) - box.bottom;
    if (Math.abs(dx) > 0.01 || Math.abs(dy) > 0.01) XOXO.shiftPosition(layer, dx, dy);
    res.moved = [dx, dy];
    rect = XOXO.compRect(layer, t);
    res.rect = rect;
    res.fits = rect.left >= box.left - 1 && rect.top >= box.top - 1 && rect.left + rect.width <= box.right + 1 && rect.top + rect.height <= box.bottom + 1;
    res.restTime = t;
  } catch (e) {
    warnings.push("text could not be measured: " + e.message);
    res.measured = false;
  }
  return res;
});

// layers_prune: remove generated layers that the current plan no longer wants. Only layers carrying the XOXO
// ownership mark (Layer.comment) of one of `kinds` are candidates, plus - when `orphans` is not false - text layers
// with NO mark whose name is just the start of their own text (what After Effects calls a layer that a failed build
// created and never renamed). Layers named in `keep` always survive. User layers are never touched.
XOXO.looksAutoNamed = function (layer) {
  try {
    var txt = String(layer.property("ADBE Text Properties").property("ADBE Text Document").value.text).replace(/[\s\r\n]+/g, "");
    var nm = String(layer.name).replace(/\s+/g, "");
    return nm.length > 0 && txt.indexOf(nm) === 0;
  } catch (e) { return false; }
};

XOXO.op("layers_prune", function (a) {
  XOXO.need(a, ["comp"]);
  var comp = XOXO.getComp(a.comp);
  var keep = {};
  var i;
  var names = a.keep || [];
  for (i = 0; i < names.length; i++) keep[names[i]] = true;
  var kinds = a.kinds || ["text"];
  var removed = [];
  for (i = comp.numLayers; i >= 1; i--) {
    var l = comp.layer(i);
    if (keep[l.name] === true) continue;
    var m = XOXO.layerMark(l);
    var why = null;
    if (m) { if (XOXO.has(kinds, m.k)) why = "stale"; }
    else if (a.orphans !== false && XOXO.has(kinds, "text") && l instanceof TextLayer && XOXO.looksAutoNamed(l)) why = "orphan";
    if (why) { removed.push({ name: l.name, why: why }); try { l.locked = false; } catch (e) { } l.remove(); }
  }
  return { removed: removed, count: removed.length };
});

XOXO.addVectorShape = function (contents, s) {
  var grp = contents.addProperty("ADBE Vector Group");
  grp.name = XOXO.def(s.name, "Shape");
  var inner = grp.property("ADBE Vectors Group");
  var t = s.type;
  if (t === "rect") {
    var rp = inner.addProperty("ADBE Vector Shape - Rect");
    rp.property("ADBE Vector Rect Size").setValue(s.size || [100, 100]);
    if (s.roundness) rp.property("ADBE Vector Rect Roundness").setValue(s.roundness);
  } else if (t === "ellipse") {
    var ep = inner.addProperty("ADBE Vector Shape - Ellipse");
    ep.property("ADBE Vector Ellipse Size").setValue(s.size || [100, 100]);
  } else if (t === "line" || t === "polyline") {
    var pts = s.points || [[0, 0], [100, 0]];
    var shp = new Shape();
    shp.vertices = pts;
    var zeros = [];
    for (var i = 0; i < pts.length; i++) zeros.push([0, 0]);
    shp.inTangents = zeros; shp.outTangents = zeros;
    shp.closed = !!s.closed;
    var pg = inner.addProperty("ADBE Vector Shape - Group");
    pg.property("ADBE Vector Shape").setValue(shp);
  } else {
    throw XOXO.err("unknown shape type: " + t, "BAD_ARGS", false);
  }
  if (s.fill) {
    var fl = inner.addProperty("ADBE Vector Graphic - Fill");
    fl.property("ADBE Vector Fill Color").setValue(XOXO.color(s.fill));
    if (s.fillOpacity !== undefined) fl.property("ADBE Vector Fill Opacity").setValue(s.fillOpacity);
  }
  if (s.stroke) {
    var st = inner.addProperty("ADBE Vector Graphic - Stroke");
    st.property("ADBE Vector Stroke Color").setValue(XOXO.color(s.stroke));
    st.property("ADBE Vector Stroke Width").setValue(XOXO.def(s.strokeWidth, 4));
  }
  if (s.trim) {
    var tr = inner.addProperty("ADBE Vector Filter - Trim");
    tr.property("ADBE Vector Trim End").setValue(XOXO.def(s.trimEnd, 100));
  }
  if (s.position) grp.property("ADBE Vector Transform Group").property("ADBE Vector Position").setValue(s.position);
  return grp;
};

XOXO.op("layer_add_shape", function (a) {
  XOXO.need(a, ["comp", "name", "shapes"]);
  var comp = XOXO.getComp(a.comp);
  var layer = comp.layers.addShape();
  var contents = layer.property("ADBE Root Vectors Group");
  for (var i = 0; i < a.shapes.length; i++) XOXO.addVectorShape(contents, a.shapes[i]);
  layer.property("ADBE Transform Group").property("ADBE Position").setValue(XOXO.def(a.position, [comp.width / 2, comp.height / 2]));
  return XOXO.finishLayer(comp, layer, { name: XOXO.uniqueName(comp, a.name, layer), start: a.start, end: a.end, opacity: a.opacity, blend: a.blend, mark: a.mark });
});

XOXO.op("layer_add_camera", function (a) {
  XOXO.need(a, ["comp", "name"]);
  var comp = XOXO.getComp(a.comp);
  var layer = comp.layers.addCamera(a.name, XOXO.def(a.center, [comp.width / 2, comp.height / 2]));
  return XOXO.finishLayer(comp, layer, { name: XOXO.uniqueName(comp, a.name, layer), start: a.start, end: a.end });
});

XOXO.op("layer_add_light", function (a) {
  XOXO.need(a, ["comp", "name"]);
  var comp = XOXO.getComp(a.comp);
  var layer = comp.layers.addLight(a.name, XOXO.def(a.center, [comp.width / 2, comp.height / 2]));
  if (a.intensity !== undefined) layer.property("ADBE Light Options Group").property("ADBE Light Intensity").setValue(a.intensity);
  return XOXO.finishLayer(comp, layer, { name: XOXO.uniqueName(comp, a.name, layer), start: a.start, end: a.end });
});

XOXO.op("layer_set", function (a) {
  XOXO.need(a, ["comp", "layer"]);
  var comp = XOXO.getComp(a.comp);
  var layer = XOXO.getLayer(comp, a.layer);
  var p = a.props || {};
  if (p.name !== undefined) layer.name = p.name;
  if (p.enabled !== undefined) layer.enabled = !!p.enabled;
  if (p.audioEnabled !== undefined) layer.audioEnabled = !!p.audioEnabled;
  if (p.solo !== undefined) layer.solo = !!p.solo;
  if (p.shy !== undefined) layer.shy = !!p.shy;
  if (p.locked !== undefined) layer.locked = !!p.locked;
  if (p.threeD !== undefined) layer.threeDLayer = !!p.threeD;
  if (p.motionBlur !== undefined) layer.motionBlur = !!p.motionBlur;
  if (p.label !== undefined) layer.label = p.label;
  if (p.blend !== undefined) XOXO.setBlend(layer, p.blend);
  if (p.parent !== undefined) layer.parent = (p.parent === null) ? null : XOXO.getLayer(comp, p.parent);
  if (p.startTime !== undefined) layer.startTime = p.startTime;
  if (p.inPoint !== undefined) layer.inPoint = p.inPoint;
  if (p.outPoint !== undefined) layer.outPoint = p.outPoint;
  if (p.stretch !== undefined) layer.stretch = p.stretch;
  if (p.comment !== undefined) layer.comment = p.comment;
  return XOXO.describeLayer(layer);
});

XOXO.op("layer_move", function (a) {
  XOXO.need(a, ["comp", "layer", "to"]);
  var comp = XOXO.getComp(a.comp);
  var layer = XOXO.getLayer(comp, a.layer);
  if (a.to === "top") layer.moveToBeginning();
  else if (a.to === "bottom") layer.moveToEnd();
  else if (typeof a.to === "object" && a.to.after) layer.moveAfter(XOXO.getLayer(comp, a.to.after));
  else if (typeof a.to === "object" && a.to.before) layer.moveBefore(XOXO.getLayer(comp, a.to.before));
  else throw XOXO.err("bad 'to' for layer_move", "BAD_ARGS", false);
  return XOXO.describeLayer(layer);
});

XOXO.op("layer_remove", function (a) {
  XOXO.need(a, ["comp", "layer"]);
  var comp = XOXO.getComp(a.comp);
  var layer = XOXO.getLayer(comp, a.layer);
  layer.locked = false;
  layer.remove();
  return { removed: true };
});

// Idempotency helper: every compiled unit removes the layers it is about to create.
XOXO.op("layers_remove", function (a) {
  XOXO.need(a, ["comp", "names"]);
  var comp = XOXO.getComp(a.comp);
  var removed = 0;
  for (var i = comp.numLayers; i >= 1; i--) {
    var l = comp.layer(i);
    var hit = false;
    for (var n = 0; n < a.names.length; n++) {
      if (l.name === a.names[n] || (a.prefix && l.name.indexOf(a.names[n]) === 0)) { hit = true; break; }
    }
    if (hit) { try { l.locked = false; } catch (e) { } l.remove(); removed++; }
  }
  return { removed: removed };
});

// Z-order: names are listed bottom -> top; each is moved to the front in turn, so the last name ends on top.
XOXO.op("layers_reorder", function (a) {
  XOXO.need(a, ["comp", "order"]);
  var comp = XOXO.getComp(a.comp);
  var missing = [];
  var moved = 0;
  for (var i = 0; i < a.order.length; i++) {
    var found = null;
    for (var k = 1; k <= comp.numLayers; k++) { if (comp.layer(k).name === a.order[i]) { found = comp.layer(k); break; } }
    if (!found) { missing.push(a.order[i]); continue; }
    found.moveToBeginning();
    moved++;
  }
  return { moved: moved, missing: missing };
});

XOXO.op("track_matte", function (a) {
  XOXO.need(a, ["comp", "layer", "matte", "type"]);
  var comp = XOXO.getComp(a.comp);
  var layer = XOXO.getLayer(comp, a.layer);
  var matte = XOXO.getLayer(comp, a.matte);
  var types = { alpha: TrackMatteType.ALPHA, alphaInverted: TrackMatteType.ALPHA_INVERTED, luma: TrackMatteType.LUMA, lumaInverted: TrackMatteType.LUMA_INVERTED };
  var t = types[a.type];
  if (t === undefined) throw XOXO.err("unknown matte type: " + a.type, "BAD_ARGS", false);
  if (typeof layer.setTrackMatte === "function") {
    layer.setTrackMatte(matte, t);
  } else {
    // pre-23.0: the matte must be the layer directly above
    matte.moveBefore(layer);
    layer.trackMatteType = t;
  }
  return { ok: true };
});

XOXO.op("mask_add", function (a) {
  XOXO.need(a, ["comp", "layer", "rect"]);
  var comp = XOXO.getComp(a.comp);
  var layer = XOXO.getLayer(comp, a.layer);
  var r = a.rect; // [left, top, width, height] in layer space
  var l = r[0], t = r[1], rr = r[0] + r[2], b = r[1] + r[3];
  var shp = new Shape();
  if (a.shape === "ellipse") {
    var cx = (l + rr) / 2, cy = (t + b) / 2, hw = r[2] / 2, hh = r[3] / 2, k = 0.5523;
    shp.vertices = [[cx, t], [rr, cy], [cx, b], [l, cy]];
    shp.inTangents = [[-hw * k, 0], [0, -hh * k], [hw * k, 0], [0, hh * k]];
    shp.outTangents = [[hw * k, 0], [0, hh * k], [-hw * k, 0], [0, -hh * k]];
  } else {
    shp.vertices = [[l, t], [rr, t], [rr, b], [l, b]];
    shp.inTangents = [[0, 0], [0, 0], [0, 0], [0, 0]];
    shp.outTangents = [[0, 0], [0, 0], [0, 0], [0, 0]];
  }
  shp.closed = true;
  var mask = layer.property("ADBE Mask Parade").addProperty("ADBE Mask Atom");
  mask.property("ADBE Mask Shape").setValue(shp);
  if (a.name) mask.name = a.name;
  if (a.inverted) mask.inverted = true;
  if (a.feather) mask.property("ADBE Mask Feather").setValue([a.feather, a.feather]);
  return { ok: true };
});
