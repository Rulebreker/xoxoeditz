// XOXOEDITZ host -- project, folders, import, compositions (ES3 only).

XOXO.op("ping", function (a) {
  var net = null;
  try { net = (app.preferences.getPrefAsLong("Main Pref Section", "Pref_SCRIPTING_FILE_NETWORK_SECURITY") === 1); } catch (e) { net = null; }
  var projFile = null;
  try { projFile = app.project.file ? app.project.file.fsName : null; } catch (e2) { projFile = null; }
  return {
    xoxo: XOXO.version,
    aeVersion: String(app.version),
    build: String(app.buildName || ""),
    os: String($.os),
    locale: String(app.isoLanguage || ""),
    scriptsMayWriteFiles: net,
    project: { file: projFile, dirty: !!app.project.dirty, numItems: app.project.numItems }
  };
});

XOXO.op("project_info", function (a) {
  var f = null;
  try { f = app.project.file ? app.project.file.fsName : null; } catch (e) { f = null; }
  var comps = [];
  XOXO.eachItem(function (it) { if (it instanceof CompItem) comps.push(it.name); });
  return { file: f, dirty: !!app.project.dirty, numItems: app.project.numItems, comps: comps };
});

// ---- project ownership -----------------------------------------------------------------------------------------
// A project XOXOEDITZ created carries a marker: a root folder item "XOXO_META" whose comment reads
// "XOXOEDITZ|v=1|project=<name>". It is saved inside the .aep, so it survives closing and re-opening and lets later
// runs tell a generated project from somebody's own work without guessing from file names.
XOXO.OWNER_FOLDER = "XOXO_META";
XOXO.OWNER_TAG = "XOXOEDITZ";

XOXO.readOwner = function () {
  var found = null;
  try {
    var root = app.project.rootFolder;
    for (var i = 1; i <= root.numItems; i++) {
      var it = root.item(i);
      if (it instanceof FolderItem && it.name === XOXO.OWNER_FOLDER) { found = it; break; }
    }
  } catch (e) { return null; }
  if (!found) return null;
  var c = String(found.comment || "");
  if (c.indexOf(XOXO.OWNER_TAG + "|") !== 0) return null;
  var parts = c.split("|");
  var m = {};
  for (var k = 1; k < parts.length; k++) {
    var eq = parts[k].indexOf("=");
    if (eq > 0) m[parts[k].substr(0, eq)] = parts[k].substr(eq + 1);
  }
  return m;
};

// Read-only: what is open in After Effects right now, and who does it belong to.
XOXO.op("project_status", function (a) {
  var f = null;
  try { f = app.project.file ? app.project.file.fsName : null; } catch (e) { f = null; }
  var comps = [];
  XOXO.eachItem(function (it) { if (it instanceof CompItem) comps.push(it.name); });
  return { open: (app.project.numItems > 0 || !!f), file: f, untitled: !f, dirty: !!app.project.dirty, numItems: app.project.numItems, comps: comps, owner: XOXO.readOwner() };
});

// Mark the open project as XOXOEDITZ's own (idempotent). The caller saves afterwards.
XOXO.op("project_mark", function (a) {
  XOXO.need(a, ["project"]);
  var root = app.project.rootFolder;
  var folder = null;
  for (var i = 1; i <= root.numItems; i++) {
    var it = root.item(i);
    if (it instanceof FolderItem && it.name === XOXO.OWNER_FOLDER) { folder = it; break; }
  }
  if (!folder) folder = app.project.items.addFolder(XOXO.OWNER_FOLDER);
  folder.comment = XOXO.OWNER_TAG + "|v=1|project=" + String(a.project).replace(/[|=]/g, "_");
  return { marked: true, project: a.project };
});

// Close the open project. save:true saves first (needs a file); otherwise the changes are discarded. Callers decide
// WHETHER that is allowed (see src/ae/project.js); this op only does it.
XOXO.op("project_close", function (a) {
  var f = null;
  try { f = app.project.file ? app.project.file.fsName : null; } catch (e) { f = null; }
  if (a.save) {
    if (!f) throw XOXO.err("the open project has never been saved; pass a path to project_save first", "NO_PROJECT_FILE", true);
    app.project.close(CloseOptions.SAVE_CHANGES);
  } else {
    app.project.close(CloseOptions.DO_NOT_SAVE_CHANGES);
  }
  return { closed: true, file: f, saved: !!a.save };
});

XOXO.op("project_new", function (a) {
  if (app.project.dirty && !a.discard) {
    throw XOXO.err("current project has unsaved changes; save it or pass discard:true", "PROJECT_DIRTY", true);
  }
  if (app.project.numItems > 0 || app.project.file) {
    app.project.close(CloseOptions.DO_NOT_SAVE_CHANGES);
  }
  app.newProject();
  return { numItems: app.project.numItems };
});

XOXO.op("project_open", function (a) {
  XOXO.need(a, ["path"]);
  var f = new File(a.path);
  if (!f.exists) throw XOXO.err("project file not found: " + a.path, "FILE_NOT_FOUND", false);
  if (app.project.file && app.project.file.fsName === f.fsName) {
    return { reused: true, file: f.fsName };
  }
  if (app.project.dirty && !a.discard) throw XOXO.err("current project has unsaved changes", "PROJECT_DIRTY", true);
  if (app.project.numItems > 0 || app.project.file) app.project.close(CloseOptions.DO_NOT_SAVE_CHANGES);
  app.open(f);
  return { reused: false, file: app.project.file ? app.project.file.fsName : f.fsName };
});

XOXO.op("project_save", function (a) {
  if (a.path) {
    var dest = new File(a.path);
    var parent = dest.parent;
    if (parent && !parent.exists) parent.create();
    app.project.save(dest);
  } else {
    if (!app.project.file) throw XOXO.err("project has never been saved; pass a path", "NO_PROJECT_FILE", true);
    app.project.save();
  }
  return { file: app.project.file ? app.project.file.fsName : null };
});

XOXO.op("folder_ensure", function (a) {
  XOXO.need(a, ["path"]);
  var parts = String(a.path).split("/");
  var parent = app.project.rootFolder;
  var created = false;
  for (var i = 0; i < parts.length; i++) {
    if (!parts[i]) continue;
    var found = null;
    for (var k = 1; k <= parent.numItems; k++) {
      var it = parent.item(k);
      if (it instanceof FolderItem && it.name === parts[i]) { found = it; break; }
    }
    if (!found) {
      found = app.project.items.addFolder(parts[i]);
      found.parentFolder = parent;
      created = true;
    }
    parent = found;
  }
  return { created: created, path: a.path };
});

XOXO.moveToFolder = function (item, folderPath) {
  if (!folderPath) return;
  XOXO.runOp("folder_ensure", { path: folderPath });
  var parts = String(folderPath).split("/");
  var cur = app.project.rootFolder;
  for (var i = 0; i < parts.length; i++) {
    if (!parts[i]) continue;
    for (var k = 1; k <= cur.numItems; k++) {
      var it = cur.item(k);
      if (it instanceof FolderItem && it.name === parts[i]) { cur = it; break; }
    }
  }
  item.parentFolder = cur;
};

XOXO.describeFootage = function (it, created) {
  var d = { name: it.name, id: it.id, created: !!created, width: it.width, height: it.height, duration: it.duration, frameRate: it.frameRate, hasVideo: !!it.hasVideo, hasAudio: !!it.hasAudio, missing: !!it.footageMissing };
  try { d.isStill = !!it.mainSource.isStill; } catch (e) { d.isStill = (it.duration === 0); }
  try { d.file = it.file ? it.file.fsName : null; } catch (e2) { d.file = null; }
  return d;
};

// Idempotent import: reuse an existing project item that already points at the same file.
XOXO.op("import_ensure", function (a) {
  XOXO.need(a, ["path"]);
  var f = new File(a.path);
  if (!f.exists) throw XOXO.err("file not found: " + a.path, "FILE_NOT_FOUND", false);
  var existing = null;
  XOXO.eachItem(function (it) {
    if (it instanceof FootageItem && it.file && it.file.fsName === f.fsName) { existing = it; return false; }
    return true;
  });
  var created = false;
  var item = existing;
  if (!item) {
    var io = new ImportOptions(f);
    if (!io.canImportAs(ImportAsType.FOOTAGE)) throw XOXO.err("After Effects cannot import this file as footage: " + a.path, "UNSUPPORTED_FORMAT", false);
    io.importAs = ImportAsType.FOOTAGE;
    if (a.sequence) io.sequence = true;
    item = app.project.importFile(io);
    created = true;
  }
  if (a.name && item.name !== a.name) item.name = a.name;
  XOXO.moveToFolder(item, a.folder);
  return XOXO.describeFootage(item, created);
});

XOXO.op("comp_ensure", function (a) {
  XOXO.need(a, ["name", "width", "height", "fps", "duration"]);
  var comp = XOXO.findItem(a.name, "comp");
  var created = false;
  var pa = XOXO.def(a.pixelAspect, 1);
  if (!comp) {
    comp = app.project.items.addComp(a.name, a.width, a.height, pa, a.duration, a.fps);
    created = true;
  } else {
    comp.width = a.width; comp.height = a.height; comp.pixelAspect = pa;
    comp.frameRate = a.fps; comp.duration = a.duration;
  }
  if (a.bg) comp.bgColor = XOXO.color(a.bg);
  if (a.reset) { XOXO.clearLayers(comp); }
  XOXO.moveToFolder(comp, a.folder);
  return { name: comp.name, created: created, width: comp.width, height: comp.height, duration: comp.duration, fps: comp.frameRate, numLayers: comp.numLayers };
});

XOXO.clearLayers = function (comp) {
  for (var i = comp.numLayers; i >= 1; i--) {
    var l = comp.layer(i);
    try { l.locked = false; } catch (e) { }
    l.remove();
  }
};

XOXO.op("layers_clear", function (a) {
  XOXO.need(a, ["comp"]);
  var comp = XOXO.getComp(a.comp);
  var n = comp.numLayers;
  XOXO.clearLayers(comp);
  return { removed: n };
});

XOXO.op("comp_set_work_area", function (a) {
  XOXO.need(a, ["comp", "start", "duration"]);
  var comp = XOXO.getComp(a.comp);
  comp.workAreaStart = a.start;
  comp.workAreaDuration = a.duration;
  return { start: comp.workAreaStart, duration: comp.workAreaDuration };
});

XOXO.op("comp_set", function (a) {
  XOXO.need(a, ["comp"]);
  var comp = XOXO.getComp(a.comp);
  if (a.duration !== undefined) comp.duration = a.duration;
  if (a.motionBlur !== undefined) comp.motionBlur = !!a.motionBlur;
  if (a.frameBlending !== undefined) { try { comp.frameBlending = !!a.frameBlending; } catch (eFb) { /* older versions: layer switch only */ } }
  if (a.bg) comp.bgColor = XOXO.color(a.bg);
  if (a.shutterAngle !== undefined) comp.shutterAngle = a.shutterAngle;
  return { duration: comp.duration };
});

XOXO.op("marker_add", function (a) {
  XOXO.need(a, ["comp", "time"]);
  var comp = XOXO.getComp(a.comp);
  var mv = new MarkerValue(String(XOXO.def(a.comment, "")));
  if (a.duration) mv.duration = a.duration;
  if (a.layer !== undefined) {
    XOXO.getLayer(comp, a.layer).property("ADBE Marker").setValueAtTime(a.time, mv);
  } else if (comp.markerProperty) {
    comp.markerProperty.setValueAtTime(a.time, mv);
  } else {
    throw XOXO.err("composition markers are not supported by this After Effects version; pass a layer", "UNSUPPORTED", true);
  }
  return { time: a.time };
});

XOXO.op("list_effects", function (a) {
  var out = [];
  if (typeof app.effects === "undefined") throw XOXO.err("app.effects is not available in this After Effects version", "UNSUPPORTED", true);
  for (var i = 0; i < app.effects.length; i++) {
    var e = app.effects[i];
    out.push({ displayName: e.displayName, matchName: e.matchName, category: e.category });
  }
  return { effects: out };
});

XOXO.op("list_fonts", function (a) {
  var out = [];
  if (typeof app.fonts === "undefined" || !app.fonts.allFonts) throw XOXO.err("app.fonts is not available (needs After Effects 24.0+)", "UNSUPPORTED", true);
  var fam = app.fonts.allFonts;
  for (var i = 0; i < fam.length; i++) {
    var grp = fam[i];
    for (var j = 0; j < grp.length; j++) {
      out.push({ postScriptName: grp[j].postScriptName, family: grp[j].familyName, style: grp[j].styleName });
    }
  }
  return { fonts: out };
});
