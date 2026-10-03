/*
 * Web-platform pieces the shared TypeScript packages use that JavaScriptCore
 * does not provide. Loaded by the iOS host before sg-core.js.
 *
 * - crypto.getRandomValues / randomUUID: `shared/id.ts` (record ids).
 * - crypto.subtle.digest("SHA-256"): importer fingerprints.
 * - TextEncoder: `store/integrity.ts` (backup digests).
 * - URL: zod's `.url()` check, used only by the bundled rule-source metadata.
 *
 * Each shim is minimal and covers exactly the calls the packages make; the
 * conformance suite runs the bundle in JavaScriptCore to prove the outputs
 * match Node. Nothing here may be used to read or send user data.
 */
(function () {
  "use strict";
  var host = globalThis.__sgHost;
  if (!host) throw new Error("__sgHost must be installed before the shims.");

  function utf8(text) {
    var bytes = [];
    for (var i = 0; i < text.length; i += 1) {
      var code = text.charCodeAt(i);
      if (code >= 0xd800 && code <= 0xdbff && i + 1 < text.length) {
        var next = text.charCodeAt(i + 1);
        if (next >= 0xdc00 && next <= 0xdfff) {
          code = 0x10000 + ((code - 0xd800) << 10) + (next - 0xdc00);
          i += 1;
        } else {
          code = 0xfffd;
        }
      } else if (code >= 0xd800 && code <= 0xdfff) {
        code = 0xfffd; // lone surrogate, as TextEncoder does
      }
      if (code < 0x80) bytes.push(code);
      else if (code < 0x800) bytes.push(0xc0 | (code >> 6), 0x80 | (code & 63));
      else if (code < 0x10000)
        bytes.push(
          0xe0 | (code >> 12),
          0x80 | ((code >> 6) & 63),
          0x80 | (code & 63),
        );
      else
        bytes.push(
          0xf0 | (code >> 18),
          0x80 | ((code >> 12) & 63),
          0x80 | ((code >> 6) & 63),
          0x80 | (code & 63),
        );
    }
    return new Uint8Array(bytes);
  }

  if (typeof globalThis.TextEncoder === "undefined") {
    globalThis.TextEncoder = function TextEncoder() {};
    globalThis.TextEncoder.prototype.encoding = "utf-8";
    globalThis.TextEncoder.prototype.encode = function (input) {
      return utf8(input === undefined ? "" : String(input));
    };
  }

  function getRandomValues(array) {
    var bytes = host.randomBytes(array.byteLength);
    var view = new Uint8Array(array.buffer, array.byteOffset, array.byteLength);
    for (var i = 0; i < view.length; i += 1) view[i] = bytes[i];
    return array;
  }

  function randomUUID() {
    var b = getRandomValues(new Uint8Array(16));
    b[6] = (b[6] & 0x0f) | 0x40;
    b[8] = (b[8] & 0x3f) | 0x80;
    var h = [];
    for (var i = 0; i < 16; i += 1)
      h.push((b[i] + 0x100).toString(16).slice(1));
    return (
      h.slice(0, 4).join("") +
      "-" +
      h.slice(4, 6).join("") +
      "-" +
      h.slice(6, 8).join("") +
      "-" +
      h.slice(8, 10).join("") +
      "-" +
      h.slice(10).join("")
    );
  }

  function digest(algorithm, data) {
    var name =
      typeof algorithm === "string" ? algorithm : algorithm && algorithm.name;
    if (String(name).toUpperCase() !== "SHA-256") {
      return Promise.reject(new Error("Only SHA-256 is supported."));
    }
    var view =
      data instanceof ArrayBuffer
        ? new Uint8Array(data)
        : new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
    var hex = host.sha256Hex(Array.prototype.slice.call(view));
    var out = new Uint8Array(32);
    for (var i = 0; i < 32; i += 1) out[i] = parseInt(hex.substr(i * 2, 2), 16);
    return Promise.resolve(out.buffer);
  }

  if (typeof globalThis.crypto === "undefined") {
    globalThis.crypto = {
      getRandomValues: getRandomValues,
      randomUUID: randomUUID,
      subtle: { digest: digest },
    };
  }

  if (typeof globalThis.URL === "undefined") {
    var pattern =
      /^([a-zA-Z][a-zA-Z0-9+.-]*:)\/\/([^\/?#:@\s]+)(?::(\d+))?([^?#\s]*)(\?[^#\s]*)?(#\S*)?$/;
    globalThis.URL = function URL(input) {
      var match = pattern.exec(String(input));
      if (!match) throw new TypeError("Invalid URL");
      this.protocol = match[1].toLowerCase();
      this.hostname = match[2].toLowerCase();
      this.port = match[3] || "";
      this.host = this.hostname + (this.port ? ":" + this.port : "");
      this.pathname = match[4] || "/";
      this.search = match[5] || "";
      this.hash = match[6] || "";
      this.origin = this.protocol + "//" + this.host;
      this.href = this.origin + this.pathname + this.search + this.hash;
    };
    globalThis.URL.prototype.toString = function () {
      return this.href;
    };
  }
})();
