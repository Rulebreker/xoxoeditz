// XOXOEDITZ host — file transports (ES3 only).
//   One-shot:  AfterFX -r <job>.jsx  ->  XOXO.runJobFile(<job>.job.json)  ->  <job>.result.json
//   Listener:  XOXO.startListener(dir)  polls dir/inbox/*.req.json and writes dir/outbox/<id>.res.json

XOXO.readText = function (path) {
  var f = new File(path);
  if (!f.exists) throw XOXO.err("file not found: " + path, "FILE_NOT_FOUND", false);
  f.encoding = "UTF-8";
  if (!f.open("r")) throw XOXO.err("cannot open for reading: " + path + " (" + f.error + ")", "IO_ERROR", true);
  var s = f.read();
  f.close();
  return s;
};

XOXO.writeText = function (path, text) {
  var tmp = new File(path + ".tmp");
  tmp.encoding = "UTF-8";
  if (!tmp.open("w")) {
    throw XOXO.err("cannot write " + path + " — enable Preferences > Scripting & Expressions > 'Allow Scripts to Write Files and Access Network'", "FILE_ACCESS_DENIED", true);
  }
  tmp.write(text);
  tmp.close();
  var dest = new File(path);
  if (dest.exists) dest.remove();
  tmp.rename(dest.name);
};

XOXO.runJobFile = function (jobPath) {
  var base = String(jobPath).replace(/\.job\.json$/, "");
  var resultPath = base + ".result.json";
  var res;
  try {
    var req = JSON.parse(XOXO.readText(jobPath));
    res = XOXO.handle(req);
  } catch (e) {
    res = XOXO.fail({ success: false, operation: "runJobFile" }, e);
  }
  XOXO.writeText(resultPath, JSON.stringify(res));
  return res;
};

XOXO.listener = { dir: null, running: false, interval: 250, handled: 0 };

XOXO.listenerTick = function () {
  var L = XOXO.listener;
  if (!L.running) return;
  try {
    var stop = new File(L.dir + "/STOP");
    if (stop.exists) { stop.remove(); L.running = false; XOXO.writeText(L.dir + "/heartbeat.json", JSON.stringify({ alive: false, t: new Date().getTime() })); return; }
    var inbox = new Folder(L.dir + "/inbox");
    var files = inbox.getFiles("*.req.json");
    if (files && files.length) {
      var names = [];
      for (var i = 0; i < files.length; i++) names.push(files[i].fsName);
      names.sort();
      var reqFile = names[0];
      var res;
      try {
        var req = JSON.parse(XOXO.readText(reqFile));
        res = XOXO.handle(req);
      } catch (e) {
        res = XOXO.fail({ success: false, operation: "listener" }, e);
      }
      var id = String(new File(reqFile).name).replace(/\.req\.json$/, "");
      XOXO.writeText(L.dir + "/outbox/" + id + ".res.json", JSON.stringify(res));
      new File(reqFile).remove();
      L.handled++;
    }
    XOXO.writeText(L.dir + "/heartbeat.json", JSON.stringify({ alive: true, t: new Date().getTime(), handled: L.handled, ae: String(app.version) }));
  } catch (err) {
    XOXO.log("listener error: " + err.message);
  }
  app.scheduleTask("XOXO.listenerTick()", L.interval, false);
};

XOXO.startListener = function (dir) {
  var L = XOXO.listener;
  if (L.running) return;
  L.dir = String(dir).replace(/\\/g, "/");
  var d = new Folder(L.dir + "/inbox"); if (!d.exists) d.create();
  d = new Folder(L.dir + "/outbox"); if (!d.exists) d.create();
  L.running = true;
  XOXO.listenerTick();
};
