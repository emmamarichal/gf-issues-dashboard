/* ==========================================================================
   Report data stored in the link itself — the urlHosted format.
   ----------------------------------------------------------------------
   Same idea and same encoding as graphicore/urlHosted (Lasse Fister,
   https://github.com/graphicore/urlHosted): the data is JSON, compressed
   with zlib (deflate), encoded as base64, and placed after "#?" in the URL:

       https://…/report.html#?eJy1Vc1u2zAMvvcpCJ93…

   Everything after "#" is the URL's fragment: browsers never send it to the
   server, so the report is not stored anywhere — the link *is* the report.

   urlHosted's own code (lib/sAndD.js) does
       btoa(pako.deflate(JSON.stringify(data), { to: 'string' }))
   This file produces exactly the same bytes with the browser's built-in
   CompressionStream('deflate') (zlib format), so no library is needed, and
   a payload made here can be read by urlHosted's deserialize() and back.
   ========================================================================== */

const UrlHosted = (function () {
  const DATA_MARK = '?'; // urlHosted's default "dataMark"

  function supported() {
    return typeof CompressionStream !== 'undefined' && typeof DecompressionStream !== 'undefined';
  }

  async function pipeThrough(bytes, stream) {
    const out = new Blob([bytes]).stream().pipeThrough(stream);
    return new Uint8Array(await new Response(out).arrayBuffer());
  }

  function bytesToBase64(bytes) {
    let binary = '';
    const CHUNK = 0x8000;
    for (let i = 0; i < bytes.length; i += CHUNK) {
      binary += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
    }
    return btoa(binary);
  }

  // Accepts standard base64 (what urlHosted writes) and the URL-safe variant
  // (- and _ instead of + and /), with or without "=" padding, and tolerates
  // whitespace or percent-encoding picked up while the link was copied around.
  function base64ToBytes(b64) {
    let s = String(b64).trim();
    if (/%[0-9a-f]{2}/i.test(s)) {
      try { s = decodeURIComponent(s); } catch (e) { /* keep as is */ }
    }
    s = s.replace(/\s+/g, '').replace(/-/g, '+').replace(/_/g, '/');
    while (s.length % 4) s += '=';
    const binary = atob(s);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
  }

  async function serialize(data) {
    if (!supported()) throw new Error('this browser cannot compress data (CompressionStream is missing) — use a recent Chrome, Firefox, Edge or Safari');
    const json = new TextEncoder().encode(JSON.stringify(data));
    return bytesToBase64(await pipeThrough(json, new CompressionStream('deflate')));
  }

  async function deserialize(payload) {
    if (!supported()) throw new Error('this browser cannot decompress data (DecompressionStream is missing) — use a recent Chrome, Firefox, Edge or Safari');
    let json;
    try {
      const bytes = base64ToBytes(payload);
      json = new TextDecoder('utf-8', { fatal: true }).decode(await pipeThrough(bytes, new DecompressionStream('deflate')));
    } catch (err) {
      throw new Error('the data in the link is incomplete or damaged (' + (err && err.message || err) + ')');
    }
    try {
      return JSON.parse(json);
    } catch (err) {
      throw new Error('the data in the link is not a report (' + err.message + ')');
    }
  }

  function makeLink(pageUrl, payload) {
    return String(pageUrl).split('#')[0] + '#' + DATA_MARK + payload;
  }

  // Same rule as urlHosted's _getPayloadFromURL: everything after the first
  // "?" inside the fragment. Returns '' when there is no payload.
  function payloadFromHash(hash) {
    let h = String(hash || '');
    if (h.charAt(0) === '#') h = h.slice(1);
    const pos = h.indexOf(DATA_MARK);
    if (pos === -1) return '';
    return h.slice(pos + DATA_MARK.length);
  }

  return {
    supported: supported,
    serialize: serialize,
    deserialize: deserialize,
    makeLink: makeLink,
    payloadFromHash: payloadFromHash,
    base64ToBytes: base64ToBytes,
    bytesToBase64: bytesToBase64
  };
})();
