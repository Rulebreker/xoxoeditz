// XOXOEDITZ host -- project inspection for QA (ES3 only). Read-only.

XOXO.layerKind = function (l) {
  if (l instanceof TextLayer) return "text";
  if (l instanceof ShapeLayer) return "shape";
  if (l instanceof CameraLayer) return "camera";
  if (l instanceof LightLayer) return "light";
  if (l instanceof AVLayer) {
    if (l.nullLayer) return "null";
    if (l.adjustmentLayer) return "adjustment";
    if (l.source instanceof CompItem) return "precomp";
    if (l.source && l.source.mainSource && l.source.mainSource instanceof SolidSource) return "solid";
    return "footage";
  }
  return "unknown";
};

XOXO.layerBounds = function (comp, l) {
  // Comp-space bounds MEASURED AT REST (entrance done), not at comp time 0 where a keyed scale/position is still on its
  // first keyframe. Rotation and 3D are ignored.
  try {
    var t = XOXO.restTime(l);
    t = Math.min(Math.max(t, 0), comp.duration);
    return XOXO.compRect(l, t);
  } catch (e) {
    return null;
  }
};

// Earliest / latest keyframe time over the animatable transform properties (null when nothing is keyed).
XOXO.keyRange = function (l) {
  var lo = null, hi = null;
  var names = ["ADBE Opacity", "ADBE Position", "ADBE Scale", "ADBE Rotate Z"];
  try {
    var tr = l.property("ADBE Transform Group");
    for (var n = 0; n < names.length; n++) {
      var p = tr.property(names[n]);
      if (!p) continue;
      for (var i = 1; i <= p.numKeys; i++) {
        var kt = p.keyTime(i);
        if (lo === null || kt < lo) lo = kt;
        if (hi === null || kt > hi) hi = kt;
      }
    }
  } catch (e) { }
  return lo === null ? null : [lo, hi];
};

XOXO.describeLayerFull = function (comp, l, withBounds) {
  var d = { index: l.index, name: l.name, kind: XOXO.layerKind(l), inPoint: l.inPoint, outPoint: l.outPoint, startTime: l.startTime, enabled: !!l.enabled };
  try { d.locked = !!l.locked; } catch (e0) { }
  try { d.threeD = !!l.threeDLayer; } catch (e1) { }
  try { d.hasAudio = !!l.hasAudio; d.audioEnabled = !!l.audioEnabled; } catch (e2) { }
  try { d.source = l.source ? l.source.name : null; } catch (e3) { d.source = null; }
  try { d.parent = l.parent ? l.parent.name : null; } catch (e4) { }
  try { d.opacity = l.property("ADBE Transform Group").property("ADBE Opacity").value; } catch (e5) { }
  var fx = [];
  try {
    var parade = l.property("ADBE Effect Parade");
    for (var i = 1; i <= parade.numProperties; i++) fx.push(parade.property(i).name);
  } catch (e6) { }
  d.effects = fx;
  try { if (l.timeRemapEnabled) d.timeRemapKeys = l.property("ADBE Time Remapping").numKeys; } catch (e12) { }
  try { d.motionBlur = !!l.motionBlur; } catch (e13) { }
  var mk = XOXO.layerMark(l);
  if (mk) d.mark = mk;
  try { var kr = XOXO.keyRange(l); if (kr) d.keyRange = kr; } catch (e14) { }
  if (d.kind === "text") {
    try { d.text = l.property("ADBE Text Properties").property("ADBE Text Document").value.text; } catch (e7) { }
    try { d.fontSize = l.property("ADBE Text Properties").property("ADBE Text Document").value.fontSize; } catch (e8) { }
  }
  try {
    var al = l.property("ADBE Audio Group").property("ADBE Audio Levels");
    d.audioLevel = al.value;
    d.audioKeys = al.numKeys;
  } catch (e9) { }
  try { d.position = l.property("ADBE Transform Group").property("ADBE Position").value; } catch (e10) { }
  try { d.scale = l.property("ADBE Transform Group").property("ADBE Scale").value; } catch (e11) { }
  try { d.numMasks = l.property("ADBE Mask Parade").numProperties; } catch (e12) { }
  if (withBounds && (d.kind === "text" || d.kind === "shape")) {
    d.bounds = XOXO.layerBounds(comp, l);
    try { d.restTime = XOXO.restTime(l); } catch (e15) { }
  }
  return d;
};

XOXO.op("inspect", function (a) {
  var withLayers = a.layers !== false;
  var wantComps = a.comps || null;
  var items = [];
  XOXO.eachItem(function (it) {
    var d = { id: it.id, name: it.name, type: (it instanceof CompItem) ? "comp" : ((it instanceof FolderItem) ? "folder" : "footage") };
    try { d.folder = (it.parentFolder && it.parentFolder !== app.project.rootFolder) ? it.parentFolder.name : null; } catch (e) { }
    if (it instanceof FootageItem) {
      d.missing = !!it.footageMissing;
      try { d.file = it.file ? it.file.fsName : null; } catch (e1) { d.file = null; }
      d.width = it.width; d.height = it.height; d.duration = it.duration;
      d.hasAudio = !!it.hasAudio; d.hasVideo = !!it.hasVideo;
    } else if (it instanceof CompItem) {
      d.width = it.width; d.height = it.height; d.duration = it.duration; d.fps = it.frameRate; d.numLayers = it.numLayers;
      var wanted = true;
      if (wantComps) { wanted = XOXO.has(wantComps, it.name); }
      if (withLayers && wanted) {
        d.layers = [];
        for (var i = 1; i <= it.numLayers; i++) d.layers.push(XOXO.describeLayerFull(it, it.layer(i), a.bounds !== false));
      }
    }
    items.push(d);
  });
  var f = null;
  try { f = app.project.file ? app.project.file.fsName : null; } catch (e2) { f = null; }
  return { project: { file: f, dirty: !!app.project.dirty }, items: items, renderQueue: XOXO.runOp("rq_list", {}).items };
});
