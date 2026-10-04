// XOXOEDITZ host — polyfills. ExtendScript is ES3: no JSON, no Array.map/forEach/indexOf.
// This file MUST stay ES3-compatible (enforced by scripts/lint-jsx.js).

if (typeof JSON === "undefined" || typeof JSON.parse !== "function") {
  JSON = {};
}

(function () {
  function esc(s) {
    var out = '"';
    for (var i = 0; i < s.length; i++) {
      var c = s.charAt(i);
      var code = s.charCodeAt(i);
      if (c === '"') out += '\\"';
      else if (c === "\\") out += "\\\\";
      else if (c === "\n") out += "\\n";
      else if (c === "\r") out += "\\r";
      else if (c === "\t") out += "\\t";
      else if (code < 32) { var h = code.toString(16); out += "\\u" + "0000".substring(h.length) + h; }
      else out += c;
    }
    return out + '"';
  }

  function isArray(v) { return Object.prototype.toString.call(v) === "[object Array]"; }

  function ser(v, seen) {
    if (v === null || v === undefined) return "null";
    var t = typeof v;
    if (t === "number") return isFinite(v) ? String(v) : "null";
    if (t === "boolean") return v ? "true" : "false";
    if (t === "string") return esc(v);
    if (t === "function") return "null";
    for (var s = 0; s < seen.length; s++) { if (seen[s] === v) return "null"; }
    seen.push(v);
    var parts = [];
    var r;
    if (isArray(v)) {
      for (var i = 0; i < v.length; i++) parts.push(ser(v[i], seen));
      r = "[" + parts.join(",") + "]";
    } else {
      for (var k in v) {
        if (!v.hasOwnProperty(k)) continue;
        if (typeof v[k] === "function" || v[k] === undefined) continue;
        parts.push(esc(k) + ":" + ser(v[k], seen));
      }
      r = "{" + parts.join(",") + "}";
    }
    seen.pop();
    return r;
  }

  JSON.stringify = function (v) { return ser(v, []); };

  // Safe recursive-descent parser. NEVER eval() job files: they are untrusted input.
  JSON.parse = function (text) {
    var at = 0;
    var src = String(text);
    function fail(m) { throw new Error("JSON parse error at " + at + ": " + m); }
    function ws() { while (at < src.length && " \t\r\n".indexOf(src.charAt(at)) >= 0) at++; }
    function val() {
      ws();
      var c = src.charAt(at);
      if (c === "{") return obj();
      if (c === "[") return arr();
      if (c === '"') return str();
      if (c === "-" || (c >= "0" && c <= "9")) return num();
      if (src.substr(at, 4) === "true") { at += 4; return true; }
      if (src.substr(at, 5) === "false") { at += 5; return false; }
      if (src.substr(at, 4) === "null") { at += 4; return null; }
      fail("unexpected '" + c + "'");
    }
    function num() {
      var m = /^-?\d+(\.\d+)?([eE][+\-]?\d+)?/.exec(src.substring(at));
      if (!m) fail("bad number");
      at += m[0].length;
      return parseFloat(m[0]);
    }
    function str() {
      at++;
      var out = "";
      while (at < src.length) {
        var c = src.charAt(at++);
        if (c === '"') return out;
        if (c === "\\") {
          var n = src.charAt(at++);
          if (n === "n") out += "\n";
          else if (n === "r") out += "\r";
          else if (n === "t") out += "\t";
          else if (n === "b") out += "\b";
          else if (n === "f") out += "\f";
          else if (n === "u") { out += String.fromCharCode(parseInt(src.substr(at, 4), 16)); at += 4; }
          else out += n;
        } else out += c;
      }
      fail("unterminated string");
    }
    function arr() {
      at++;
      var a = [];
      ws();
      if (src.charAt(at) === "]") { at++; return a; }
      while (true) {
        a.push(val());
        ws();
        var c = src.charAt(at++);
        if (c === "]") return a;
        if (c !== ",") fail("expected , or ]");
      }
    }
    function obj() {
      at++;
      var o = {};
      ws();
      if (src.charAt(at) === "}") { at++; return o; }
      while (true) {
        ws();
        if (src.charAt(at) !== '"') fail("expected key");
        var k = str();
        ws();
        if (src.charAt(at++) !== ":") fail("expected :");
        o[k] = val();
        ws();
        var c = src.charAt(at++);
        if (c === "}") return o;
        if (c !== ",") fail("expected , or }");
      }
    }
    var result = val();
    ws();
    if (at < src.length) fail("trailing data");
    return result;
  };
})();
