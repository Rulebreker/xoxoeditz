// XOXOEDITZ host -- render queue (ES3 only). Rendering itself is done by aerender / Media Encoder.

XOXO.op("rq_clear", function (a) {
  var rq = app.project.renderQueue;
  var n = rq.numItems;
  for (var i = n; i >= 1; i--) {
    try { rq.item(i).remove(); } catch (e) { }
  }
  return { removed: n };
});

XOXO.op("rq_templates", function (a) {
  // Use a throwaway queue item to enumerate what this install can actually do.
  var comps = [];
  XOXO.eachItem(function (it) { if (it instanceof CompItem) { comps.push(it); return false; } return true; });
  if (!comps.length) throw XOXO.err("need at least one composition to enumerate render templates", "NO_COMP", true);
  var item = app.project.renderQueue.items.add(comps[0]);
  var out = { renderSettings: [], outputModules: [] };
  try {
    out.renderSettings = item.templates || [];
    out.outputModules = item.outputModule(1).templates || [];
  } finally {
    item.remove();
  }
  return out;
});

XOXO.op("rq_add", function (a) {
  XOXO.need(a, ["comp", "output"]);
  var comp = XOXO.getComp(a.comp);
  var item = app.project.renderQueue.items.add(comp);
  var warnings = [];
  if (a.renderSettings) {
    try { item.applyTemplate(a.renderSettings); } catch (e) { warnings.push("render settings template not applied: " + a.renderSettings); }
  }
  var om = item.outputModule(1);
  if (a.outputModule) {
    try { om.applyTemplate(a.outputModule); } catch (e2) { warnings.push("output module template not applied: " + a.outputModule); }
  }
  var dest = new File(a.output);
  if (dest.parent && !dest.parent.exists) dest.parent.create();
  om.file = dest;
  if (a.start !== undefined) item.timeSpanStart = a.start;
  if (a.duration !== undefined) item.timeSpanDuration = a.duration;
  return { index: item.index, output: om.file ? om.file.fsName : null, warnings: warnings };
});

XOXO.op("rq_list", function (a) {
  var rq = app.project.renderQueue;
  var out = [];
  for (var i = 1; i <= rq.numItems; i++) {
    var it = rq.item(i);
    var o = null;
    try { o = it.outputModule(1).file ? it.outputModule(1).file.fsName : null; } catch (e) { o = null; }
    out.push({ index: i, comp: it.comp.name, status: String(it.status), output: o });
  }
  return { items: out };
});

XOXO.op("rq_queue_ame", function (a) {
  if (typeof app.project.renderQueue.queueInAME !== "function") throw XOXO.err("queueInAME is not available in this version", "UNSUPPORTED", true);
  app.project.renderQueue.queueInAME(!!a.start);
  return { queued: true };
});
