// XOXOEDITZ host -- properties, keyframes, expressions, text animators (ES3 only).

XOXO.op("set_property", function (a) {
  XOXO.need(a, ["comp", "layer", "prop", "value"]);
  var comp = XOXO.getComp(a.comp);
  var layer = XOXO.getLayer(comp, a.layer);
  var p = XOXO.prop(layer, a.prop);
  p.setValue(XOXO.coerce(p, a.value));
  return { ok: true };
});

XOXO.clearKeys = function (p) {
  for (var i = p.numKeys; i >= 1; i--) p.removeKey(i);
};

// Ease between consecutive keys. kind: linear | easeOut (fast->slow) | easeIn (slow->fast) | easeInOut
XOXO.easeInfluence = function (kind) {
  // returns [outInfluenceOfFirstKey, inInfluenceOfSecondKey]
  if (kind === "easeOut") return [0.1, 85];
  if (kind === "easeIn") return [85, 0.1];
  if (kind === "easeInOut") return [45, 45];
  return null;
};

XOXO.applySegmentEase = function (p, i, kind) {
  var infl = XOXO.easeInfluence(kind);
  if (!infl) return;
  var outA = p.keyOutTemporalEase(i);
  var inB = p.keyInTemporalEase(i + 1);
  var oa = [], ib = [];
  for (var d = 0; d < outA.length; d++) oa.push(new KeyframeEase(0, infl[0]));
  for (var e = 0; e < inB.length; e++) ib.push(new KeyframeEase(0, infl[1]));
  p.setTemporalEaseAtKey(i, p.keyInTemporalEase(i), oa);
  p.setTemporalEaseAtKey(i + 1, ib, p.keyOutTemporalEase(i + 1));
};

XOXO.op("keyframes", function (a) {
  XOXO.need(a, ["comp", "layer", "prop", "keys"]);
  var comp = XOXO.getComp(a.comp);
  var layer = XOXO.getLayer(comp, a.layer);
  var p = XOXO.prop(layer, a.prop);
  if (a.keys.length < 1) throw XOXO.err("keys must not be empty", "BAD_ARGS", false);
  if (a.clear !== false) XOXO.clearKeys(p);
  var i;
  for (i = 0; i < a.keys.length; i++) {
    var k = a.keys[i];
    p.setValueAtTime(k.t, XOXO.coerce(p, k.v));
  }
  var warnings = [];
  var ease = XOXO.def(a.ease, "linear");
  for (i = 0; i < a.keys.length; i++) {
    var kk = a.keys[i];
    var idx = p.nearestKeyIndex(kk.t);
    if (kk.hold) { p.setInterpolationTypeAtKey(idx, KeyframeInterpolationType.HOLD, KeyframeInterpolationType.HOLD); }
  }
  if (ease !== "linear") {
    for (i = 1; i < p.numKeys; i++) {
      try { XOXO.applySegmentEase(p, i, XOXO.def(a.keys[i - 1].ease, ease)); }
      catch (e) { warnings.push("ease not applied on segment " + i + ": " + e.message); }
    }
  }
  return { numKeys: p.numKeys, warnings: warnings };
});

XOXO.op("expression", function (a) {
  XOXO.need(a, ["comp", "layer", "prop", "expression"]);
  var comp = XOXO.getComp(a.comp);
  var layer = XOXO.getLayer(comp, a.layer);
  var p = XOXO.prop(layer, a.prop);
  if (!p.canSetExpression) throw XOXO.err("property does not accept expressions: " + a.prop, "UNSUPPORTED", true);
  p.expression = a.expression;
  var err = "";
  try { err = p.expressionError || ""; } catch (e) { err = ""; }
  if (err) {
    p.expression = "";
    throw XOXO.err("expression error: " + err, "EXPRESSION_ERROR", true);
  }
  return { enabled: !!p.expressionEnabled };
});

// Text animators: per-character reveals built on Range Selector + Opacity/Position/Tracking.
// Every mode sweeps the selector's Start 0 -> 100 with End at 100: characters leave the affected
// range left-to-right, so they appear in reading order.
XOXO.op("text_reveal", function (a) {
  XOXO.need(a, ["comp", "layer", "mode", "start", "duration"]);
  var comp = XOXO.getComp(a.comp);
  var layer = XOXO.getLayer(comp, a.layer);
  var mode = a.mode;
  if (mode !== "typewriter" && mode !== "fade_up" && mode !== "tracking_in") throw XOXO.err("unknown text_reveal mode: " + mode, "BAD_ARGS", false);
  var warnings = [];
  var animators = layer.property("ADBE Text Properties").property("ADBE Text Animators");
  var an = animators.addProperty("ADBE Text Animator");
  an.name = "XOXO Reveal";
  var props = an.property("ADBE Text Animator Properties");
  // A scripted animator may or may not come with a default Range Selector: reuse it if present, otherwise add one.
  var selGroup = an.property("ADBE Text Selectors");
  var sel = (selGroup.numProperties > 0) ? selGroup.property(1) : selGroup.addProperty("ADBE Text Selector");
  props.addProperty("ADBE Text Opacity").setValue(0);
  if (mode === "fade_up") props.addProperty("ADBE Text Position 3D").setValue([0, XOXO.def(a.offset, 40), 0]);
  if (mode === "tracking_in") props.addProperty("ADBE Text Tracking Amount").setValue(XOXO.def(a.tracking, 60));
  // Based On: 1 characters, 3 words. Reveal word by word instead of letter by letter.
  if (a.unit === "words") {
    try { sel.property("ADBE Text Range Advanced").property("ADBE Text Range Type2").setValue(3); }
    catch (eU) { warnings.push("word unit not applied (revealing by character): " + eU.message); }
  }
  if (mode !== "typewriter") {
    try { sel.property("ADBE Text Range Advanced").property("ADBE Text Range Shape").setValue(2); }
    catch (e) { warnings.push("range shape not set: " + e.message); }
  }
  sel.property("ADBE Text Percent End").setValue(100);
  var st = sel.property("ADBE Text Percent Start");
  st.setValueAtTime(a.start, 0);
  st.setValueAtTime(a.start + a.duration, 100);
  return { warnings: warnings };
});

// Variable speed: comp time -> source time keyframes on Time Remap. Linear keys sampled densely by the caller
// reproduce any speed curve, so no bezier handles are needed.
XOXO.op("time_remap", function (a) {
  XOXO.need(a, ["comp", "layer", "keys"]);
  var comp = XOXO.getComp(a.comp);
  var layer = XOXO.getLayer(comp, a.layer);
  var warnings = [];
  try { layer.timeRemapEnabled = true; } catch (e) { throw XOXO.err("time remapping is not available for layer " + layer.name + ": " + e.message, "UNSUPPORTED", true); }
  var p = layer.property("ADBE Time Remapping");
  if (!p) throw XOXO.err("Time Remap property missing on " + layer.name + " (stills and solids cannot be remapped)", "UNSUPPORTED", true);
  XOXO.clearKeys(p); // After Effects adds two default keys when remapping is enabled
  for (var i = 0; i < a.keys.length; i++) p.setValueAtTime(a.keys[i].t, a.keys[i].src);
  if (a.start !== undefined) layer.inPoint = a.start;
  if (a.end !== undefined) layer.outPoint = a.end;
  if (a.frameBlend) {
    try {
      layer.frameBlendingType = (a.frameBlend === "pixel") ? FrameBlendingType.PIXEL_MOTION : ((a.frameBlend === "mix") ? FrameBlendingType.FRAME_MIX : FrameBlendingType.NO_FRAME_BLEND);
    } catch (e2) { warnings.push("frame blending not applied: " + e2.message); }
  }
  if (a.motionBlur) { try { layer.motionBlur = true; } catch (e3) { warnings.push("motion blur not applied: " + e3.message); } }
  return { numKeys: p.numKeys, warnings: warnings };
});
