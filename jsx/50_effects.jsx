// XOXOEDITZ host — effects (ES3 only). Availability is checked here; fallback policy lives in Node.

XOXO.effectAvailable = function (matchName) {
  if (typeof app.effects === "undefined") return null; // unknown
  for (var i = 0; i < app.effects.length; i++) { if (app.effects[i].matchName === matchName) return true; }
  return false;
};

XOXO.op("effect_available", function (a) {
  XOXO.need(a, ["matchNames"]);
  var out = {};
  for (var i = 0; i < a.matchNames.length; i++) out[a.matchNames[i]] = XOXO.effectAvailable(a.matchNames[i]);
  return out;
});

XOXO.op("layer_effect_add", function (a) {
  XOXO.need(a, ["comp", "layer", "matchName"]);
  var comp = XOXO.getComp(a.comp);
  var layer = XOXO.getLayer(comp, a.layer);
  var avail = XOXO.effectAvailable(a.matchName);
  if (avail === false) throw XOXO.err("effect not installed: " + a.matchName, "EFFECT_UNAVAILABLE", true);
  var parade = layer.property("ADBE Effect Parade");
  if (!parade.canAddProperty(a.matchName)) throw XOXO.err("effect cannot be added to this layer: " + a.matchName, "EFFECT_UNAVAILABLE", true);
  var fx = parade.addProperty(a.matchName);
  if (a.name) fx.name = (a.tag ? "XOXO:" + a.tag + ":" : "") + a.name;
  else if (a.tag) fx.name = "XOXO:" + a.tag + ":" + fx.name;
  var warnings = [];
  if (a.params) {
    for (var key in a.params) {
      if (!a.params.hasOwnProperty(key)) continue;
      var prm = null;
      try { prm = fx.property(/^\d+$/.test(key) ? parseInt(key, 10) : key); } catch (e) { prm = null; }
      if (!prm) { warnings.push("effect parameter not found: " + key); continue; }
      try { prm.setValue(XOXO.coerce(prm, a.params[key])); }
      catch (e2) { warnings.push("could not set " + key + ": " + e2.message); }
    }
  }
  return { effect: fx.name, index: fx.propertyIndex, warnings: warnings };
});

XOXO.op("effect_param_keys", function (a) {
  XOXO.need(a, ["comp", "layer", "effect", "param", "keys"]);
  var comp = XOXO.getComp(a.comp);
  var layer = XOXO.getLayer(comp, a.layer);
  var fx = layer.property("ADBE Effect Parade").property(a.effect);
  if (!fx) throw XOXO.err("effect not on layer: " + a.effect, "PROP_NOT_FOUND", true);
  var p = fx.property(/^\d+$/.test(a.param) ? parseInt(a.param, 10) : a.param);
  if (!p) throw XOXO.err("effect parameter not found: " + a.param, "PROP_NOT_FOUND", true);
  XOXO.clearKeys(p);
  for (var i = 0; i < a.keys.length; i++) p.setValueAtTime(a.keys[i].t, XOXO.coerce(p, a.keys[i].v));
  return { numKeys: p.numKeys };
});

XOXO.op("effects_remove_tag", function (a) {
  XOXO.need(a, ["comp", "layer", "tag"]);
  var comp = XOXO.getComp(a.comp);
  var layer = XOXO.getLayer(comp, a.layer);
  var parade = layer.property("ADBE Effect Parade");
  var prefix = "XOXO:" + a.tag + ":";
  var removed = 0;
  for (var i = parade.numProperties; i >= 1; i--) {
    var fx = parade.property(i);
    if (fx.name.indexOf(prefix) === 0) { fx.remove(); removed++; }
  }
  return { removed: removed };
});

XOXO.op("keys_clear", function (a) {
  XOXO.need(a, ["comp", "layer", "prop"]);
  var comp = XOXO.getComp(a.comp);
  var layer = XOXO.getLayer(comp, a.layer);
  var p = XOXO.prop(layer, a.prop);
  XOXO.clearKeys(p);
  try { p.expression = ""; } catch (e) { }
  return { ok: true };
});
