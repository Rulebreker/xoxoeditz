// XOXOEDITZ host — core: op registry, request handling, shared helpers (ES3 only).

var XOXO = $.global.XOXO = ($.global.XOXO && $.global.XOXO.ops) ? $.global.XOXO : { ops: {} };
XOXO.version = "0.1.0";
XOXO.ops = {};

XOXO.op = function (name, fn) { XOXO.ops[name] = fn; };

XOXO.err = function (message, code, recoverable) {
  var e = new Error(message);
  e.xcode = code || "OP_FAILED";
  e.recoverable = (recoverable === false) ? false : true;
  return e;
};

XOXO.each = function (arr, fn) { for (var i = 0; i < arr.length; i++) { if (fn(arr[i], i) === false) break; } };
XOXO.map = function (arr, fn) { var o = []; for (var i = 0; i < arr.length; i++) o.push(fn(arr[i], i)); return o; };
XOXO.has = function (arr, v) { for (var i = 0; i < arr.length; i++) { if (arr[i] === v) return true; } return false; };
XOXO.isArray = function (v) { return Object.prototype.toString.call(v) === "[object Array]"; };
XOXO.def = function (v, d) { return (v === undefined || v === null) ? d : v; };

XOXO.log = function (msg) { try { $.writeln("[xoxo] " + msg); } catch (e) { } };

/** "#rrggbb" or [r,g,b] (0..1) -> [r,g,b]. */
XOXO.color = function (c, withAlpha) {
  var rgb;
  if (typeof c === "string") {
    var h = c.replace("#", "");
    if (h.length === 3) h = h.charAt(0) + h.charAt(0) + h.charAt(1) + h.charAt(1) + h.charAt(2) + h.charAt(2);
    if (h.length !== 6) throw XOXO.err("bad color: " + c, "BAD_ARGS", false);
    rgb = [parseInt(h.substr(0, 2), 16) / 255, parseInt(h.substr(2, 2), 16) / 255, parseInt(h.substr(4, 2), 16) / 255];
  } else if (XOXO.isArray(c)) {
    rgb = [c[0], c[1], c[2]];
  } else {
    throw XOXO.err("bad color value", "BAD_ARGS", false);
  }
  if (withAlpha) rgb.push(c.length === 4 ? c[3] : 1);
  return rgb;
};

XOXO.need = function (args, keys) {
  for (var i = 0; i < keys.length; i++) {
    if (args[keys[i]] === undefined || args[keys[i]] === null) throw XOXO.err("missing argument '" + keys[i] + "'", "BAD_ARGS", false);
  }
};

// ---------- project item lookup ----------
XOXO.eachItem = function (fn) {
  var items = app.project.items;
  for (var i = 1; i <= items.length; i++) { if (fn(items[i], i) === false) break; }
};

XOXO.findItem = function (name, kind) {
  var found = null;
  XOXO.eachItem(function (it) {
    if (it.name !== name) return true;
    if (kind === "comp" && !(it instanceof CompItem)) return true;
    if (kind === "folder" && !(it instanceof FolderItem)) return true;
    if (kind === "footage" && !(it instanceof FootageItem)) return true;
    found = it;
    return false;
  });
  return found;
};

XOXO.getComp = function (name) {
  var c = XOXO.findItem(name, "comp");
  if (!c) throw XOXO.err("composition not found: " + name, "COMP_NOT_FOUND", true);
  return c;
};

XOXO.getLayer = function (comp, ref) {
  if (typeof ref === "number") {
    if (ref < 1 || ref > comp.numLayers) throw XOXO.err("layer index out of range: " + ref, "LAYER_NOT_FOUND", true);
    return comp.layer(ref);
  }
  for (var i = 1; i <= comp.numLayers; i++) { if (comp.layer(i).name === ref) return comp.layer(i); }
  throw XOXO.err("layer not found in " + comp.name + ": " + ref, "LAYER_NOT_FOUND", true);
};

XOXO.layerExists = function (comp, name) {
  for (var i = 1; i <= comp.numLayers; i++) { if (comp.layer(i).name === name) return true; }
  return false;
};

// ---------- property resolution ----------
XOXO.PROPS = {
  position: ["ADBE Transform Group", "ADBE Position"],
  scale: ["ADBE Transform Group", "ADBE Scale"],
  rotation: ["ADBE Transform Group", "ADBE Rotate Z"],
  opacity: ["ADBE Transform Group", "ADBE Opacity"],
  anchor: ["ADBE Transform Group", "ADBE Anchor Point"],
  pointOfInterest: ["ADBE Transform Group", "ADBE Point of Interest"],
  orientation: ["ADBE Transform Group", "ADBE Orientation"],
  rotationX: ["ADBE Transform Group", "ADBE Rotate X"],
  rotationY: ["ADBE Transform Group", "ADBE Rotate Y"],
  audioLevels: ["ADBE Audio Group", "ADBE Audio Levels"],
  timeRemap: ["ADBE Time Remapping"],
  sourceText: ["ADBE Text Properties", "ADBE Text Document"]
};

XOXO.prop = function (layer, key) {
  var path = XOXO.PROPS[key];
  if (!path) {
    path = String(key).split("/");
  }
  var cur = layer;
  for (var i = 0; i < path.length; i++) {
    var seg = path[i];
    if (/^\d+$/.test(seg)) seg = parseInt(seg, 10);
    var next = null;
    try { next = cur.property(seg); } catch (e) { next = null; }
    if (!next) throw XOXO.err("property not found: " + key + " (at '" + path[i] + "' on layer " + layer.name + ")", "PROP_NOT_FOUND", true);
    cur = next;
  }
  return cur;
};

/** Coerce JSON-ish values into what a Property wants (hex colors, 3D vs 2D arrays). */
XOXO.coerce = function (p, v) {
  if (typeof v === "string" && v.charAt(0) === "#") {
    var cur = null;
    try { cur = p.value; } catch (e) { cur = null; }
    return XOXO.color(v, cur && cur.length === 4);
  }
  if (XOXO.isArray(v)) {
    var curv = null;
    try { curv = p.value; } catch (e2) { curv = null; }
    if (curv && XOXO.isArray(curv) && curv.length === 3 && v.length === 2) return [v[0], v[1], (p.name === "Scale" ? 100 : 0)];
    if (curv && XOXO.isArray(curv) && curv.length === 2 && v.length === 3) return [v[0], v[1]];
  }
  return v;
};

// ---------- request handling ----------
XOXO.runOp = function (name, args) {
  var fn = XOXO.ops[name];
  if (!fn) throw XOXO.err("unknown op: " + name, "UNKNOWN_OP", false);
  return fn(args || {});
};

XOXO.fail = function (res, e) {
  res.success = false;
  res.error = (e && e.message) ? e.message : String(e);
  res.code = (e && e.xcode) ? e.xcode : "OP_FAILED";
  res.recoverable = (e && e.recoverable === false) ? false : true;
  if (e && e.line) res.line = e.line;
  return res;
};

XOXO.handle = function (req) {
  var t0 = new Date().getTime();
  var res = { id: req.id, operation: req.op, success: false };
  var undo = req.undo !== false && req.op !== "ping";
  try {
    if (undo) app.beginUndoGroup("XOXO " + req.op);
    try {
      XOXO.flags = req.flags || {};
      res.data = XOXO.runOp(req.op, req.args);
      res.success = true;
    } finally {
      if (undo) app.endUndoGroup();
    }
  } catch (e) {
    XOXO.fail(res, e);
  }
  res.durationMs = new Date().getTime() - t0;
  return res;
};

// batch: units run in order; ops inside a unit stop at first failure; other units still run.
XOXO.op("batch", function (a) {
  var units = a.units || [];
  var out = [];
  var allOk = true;
  for (var u = 0; u < units.length; u++) {
    var unit = units[u];
    var ur = { id: unit.id, success: true, results: [], failedIndex: -1 };
    for (var i = 0; i < unit.ops.length; i++) {
      var o = unit.ops[i];
      var r = { op: o.op, success: false };
      try {
        r.data = XOXO.runOp(o.op, o.args);
        r.success = true;
      } catch (e) {
        XOXO.fail(r, e);
      }
      ur.results.push(r);
      if (!r.success) { ur.success = false; ur.failedIndex = i; break; }
    }
    if (!ur.success) allOk = false;
    out.push(ur);
    if (!ur.success && a.stopOnError) break;
  }
  return { allSucceeded: allOk, units: out };
});

XOXO.op("raw_eval", function (a) {
  if (!XOXO.flags || XOXO.flags.rawEval !== true) throw XOXO.err("raw_eval is disabled (set allowRawEval in xoxo.config.json)", "DISABLED", false);
  XOXO.need(a, ["code"]);
  var r = eval(a.code);
  return { value: (r === undefined) ? null : String(r) };
});
