// XOXOEDITZ host — layer creation and layer settings (ES3 only).

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

XOXO.finishLayer = function (comp, layer, a) {
  if (a.name) layer.name = a.name;
  XOXO.timing(layer, a);
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

XOXO.op("layer_add_text", function (a) {
  XOXO.need(a, ["comp", "name", "text"]);
  var comp = XOXO.getComp(a.comp);
  var txt = String(a.text).replace(/\n/g, "\r"); // After Effects separates paragraphs with \r
var layer = a.box ? comp.layers.addBoxText(a.box, txt) : comp.layers.addText(txt);
  var tp = layer.property("ADBE Text Properties").property("ADBE Text Document");
  var td = tp.value;
  var warnings = [];
  td.resetCharStyle();
  td.fontSize = XOXO.def(a.size, 72);
  td.applyFill = true;
  td.fillColor = XOXO.color(XOXO.def(a.color, "#ffffff"));
  if (a.stroke) { td.applyStroke = true; td.strokeColor = XOXO.color(a.stroke); td.strokeWidth = XOXO.def(a.strokeWidth, 2); }
  if (a.font) {
    try { td.font = a.font; } catch (e) { warnings.push("font not applied: " + a.font); }
  }
  var j = String(XOXO.def(a.justify, "center"));
  td.justification = (j === "left") ? ParagraphJustification.LEFT_JUSTIFY : (j === "right" ? ParagraphJustification.RIGHT_JUSTIFY : ParagraphJustification.CENTER_JUSTIFY);
  if (a.tracking !== undefined) td.tracking = a.tracking;
  if (a.leading !== undefined) { td.autoLeading = false; td.leading = a.leading; }
  if (a.allCaps) td.allCaps = true;
  tp.setValue(td);
  var pos = XOXO.def(a.position, [comp.width / 2, comp.height / 2]);
  layer.property("ADBE Transform Group").property("ADBE Position").setValue(pos);
  var r = XOXO.finishLayer(comp, layer, { name: XOXO.uniqueName(comp, a.name, layer), start: a.start, end: a.end, opacity: a.opacity, blend: a.blend });
  r.warnings = warnings;
  return r;
});

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
  return XOXO.finishLayer(comp, layer, { name: XOXO.uniqueName(comp, a.name, layer), start: a.start, end: a.end, opacity: a.opacity, blend: a.blend });
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
