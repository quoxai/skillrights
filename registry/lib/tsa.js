// Minimal zero-dependency RFC 3161 client: build a DER TimeStampReq for a
// sha256 digest, POST it to a Time Stamping Authority, and check the
// response status is granted before storing the raw TimeStampResp (.tsr).
// Verification of stored tokens uses standard tooling:
//   openssl ts -reply -in <file>.tsr -text
//   openssl ts -verify -digest <hex> -in <file>.tsr -CAfile <tsa-ca.pem>
//
// No nonce is sent, deliberately: nonces protect response freshness, and a
// proof of existence only ever benefits from an EARLIER genuine response.

// The capped streaming reader is shared with the OTS client: both read bytes
// from servers we do not control inside the process that serves the public
// API, and the cap has to bound memory, not just the final size.
import { readBodyCapped } from './ots.js';

// --- tiny DER builders ----------------------------------------------------

function derLen(n) {
  if (n < 0x80) return Buffer.from([n]);
  const bytes = [];
  let v = n;
  while (v > 0) { bytes.unshift(v & 0xff); v >>= 8; }
  return Buffer.from([0x80 | bytes.length, ...bytes]);
}

function der(tag, content) {
  return Buffer.concat([Buffer.from([tag]), derLen(content.length), content]);
}

const SHA256_OID = Buffer.from('608648016503040201', 'hex'); // 2.16.840.1.101.3.4.2.1

/** DER TimeStampReq: version 1, sha256 messageImprint, certReq TRUE. */
export function buildTsq(digest) {
  if (digest.length !== 32) throw new Error('tsa: digest must be 32 bytes');
  const algId = der(0x30, Buffer.concat([der(0x06, SHA256_OID), Buffer.from([0x05, 0x00])]));
  const imprint = der(0x30, Buffer.concat([algId, der(0x04, digest)]));
  const version = der(0x02, Buffer.from([0x01]));
  const certReq = der(0x01, Buffer.from([0xff]));
  return der(0x30, Buffer.concat([version, imprint, certReq]));
}

// --- minimal DER walking for the response --------------------------------
//
// Every element is read against its PARENT's boundary, not the buffer's, and
// children must tile their parent exactly. The previous reader checked only
// the buffer, so `300830030201000000 || digest` (41 bytes, no timestamp
// token at all, requested digest sitting outside the declared outer
// SEQUENCE) was accepted as a granted timestamp (audit, 2026-09-11).

function readTlv(buf, pos, end = buf.length) {
  if (pos + 2 > end) throw new Error('tsa: truncated DER');
  const tag = buf[pos];
  let len = buf[pos + 1];
  let p = pos + 2;
  if (len & 0x80) {
    const n = len & 0x7f;
    if (n === 0 || n > 4 || p + n > end) throw new Error('tsa: bad DER length');
    len = 0;
    // Unsigned accumulation: `(len << 8) | byte` goes NEGATIVE once the top
    // bit lands in bit 31, and a negative length made end < start, which
    // read "status 0, granted" out of garbage (audit, 2026-09-10).
    for (let i = 0; i < n; i += 1) { len = len * 256 + buf[p]; p += 1; }
  }
  if (!Number.isSafeInteger(len) || len < 0 || p + len > end) throw new Error('tsa: bad DER length');
  return { tag, start: p, end: p + len, next: p + len };
}

/** Every child of `el`, each fully contained in it, tiling it exactly. */
function children(buf, el) {
  const out = [];
  let p = el.start;
  while (p < el.end) {
    const child = readTlv(buf, p, el.end);
    out.push(child);
    p = child.next;
  }
  return out;
}

const OID_SIGNED_DATA = Buffer.from('2a864886f70d010702', 'hex');      // 1.2.840.113549.1.7.2
const OID_TST_INFO = Buffer.from('2a864886f70d0109100104', 'hex');     // 1.2.840.113549.1.9.16.1.4

function oidEquals(buf, el, oid) {
  return el.tag === 0x06 && buf.subarray(el.start, el.end).equals(oid);
}

/**
 * TSTInfo.messageImprint.hashedMessage, located structurally:
 *   ContentInfo { contentType id-signedData, [0] SignedData }
 *   SignedData  { version, digestAlgorithms, encapContentInfo { id-ct-TSTInfo, [0] OCTET STRING TSTInfo } ... }
 *   TSTInfo     { version, policy, messageImprint { algorithm, hashedMessage } ... }
 * Returns null when the token is not a structurally valid RFC 3161 token.
 * The SIGNATURE and its trust chain are NOT verified here; that stays the
 * documented offline path:
 *   openssl ts -verify -digest <hex> -in <file>.tsr -CAfile <tsa-ca.pem>
 */
function messageImprintOf(buf, token) {
  try {
    if (token.tag !== 0x30) return null;
    const ci = children(buf, token);
    if (ci.length < 2 || !oidEquals(buf, ci[0], OID_SIGNED_DATA) || ci[1].tag !== 0xa0) return null;
    const signedData = children(buf, ci[1])[0];
    if (!signedData || signedData.tag !== 0x30) return null;
    const encap = children(buf, signedData).find((el) => {
      if (el.tag !== 0x30) return false;
      const first = children(buf, el)[0];
      return first && oidEquals(buf, first, OID_TST_INFO);
    });
    if (!encap) return null;
    const encapParts = children(buf, encap);
    if (encapParts.length < 2 || encapParts[1].tag !== 0xa0) return null;
    const eContent = children(buf, encapParts[1])[0];
    if (!eContent || eContent.tag !== 0x04) return null;
    const tstInfo = readTlv(buf, eContent.start, eContent.end);
    if (tstInfo.tag !== 0x30 || tstInfo.next !== eContent.end) return null;
    const tst = children(buf, tstInfo);
    if (tst.length < 3 || tst[0].tag !== 0x02 || tst[1].tag !== 0x06 || tst[2].tag !== 0x30) return null;
    const imprint = children(buf, tst[2]);
    if (imprint.length < 2 || imprint[0].tag !== 0x30 || imprint[1].tag !== 0x04) return null;
    const algOid = children(buf, imprint[0])[0];
    if (!algOid || !oidEquals(buf, algOid, SHA256_OID)) return null; // we only ever request sha256
    return Buffer.from(buf.subarray(imprint[1].start, imprint[1].end));
  } catch {
    return null; // any DER violation inside the token: not a valid token
  }
}

/**
 * Parse a TimeStampResp: status, whether a token is present, and the message
 * imprint read out of TSTInfo itself (null when the token is not a
 * structurally valid RFC 3161 timestamp token). Throws on DER that does not
 * nest correctly.
 */
export function parseTsr(buf) {
  const outer = readTlv(buf, 0, buf.length); // TimeStampResp SEQUENCE
  if (outer.tag !== 0x30) throw new Error('tsa: response is not a SEQUENCE');
  if (outer.next !== buf.length) throw new Error('tsa: trailing bytes after the TimeStampResp');
  const parts = children(buf, outer);
  if (parts.length < 1 || parts[0].tag !== 0x30) throw new Error('tsa: missing PKIStatusInfo');
  const statusParts = children(buf, parts[0]);
  if (statusParts.length < 1 || statusParts[0].tag !== 0x02) throw new Error('tsa: missing status INTEGER');
  const statusInt = statusParts[0];
  if (statusInt.end - statusInt.start < 1 || statusInt.end - statusInt.start > 4) {
    throw new Error('tsa: implausible status INTEGER');
  }
  let status = 0;
  for (let i = statusInt.start; i < statusInt.end; i += 1) status = status * 256 + buf[i];
  const granted = status === 0 || status === 1; // granted | grantedWithMods
  const token = parts.length > 1 ? parts[1] : null;
  return {
    granted,
    status,
    tokenPresent: token !== null,
    messageImprint: token ? messageImprintOf(buf, token) : null,
  };
}

/**
 * Structural acceptance test for a TimeStampResp, used both when a response
 * arrives and when an existing .tsr is found on disk: granted, with a
 * structurally valid timestamp token whose TSTInfo message imprint IS this
 * digest. Signature and trust chain are out of scope here (openssl path).
 */
export function tsrCoversDigest(buf, digest) {
  try {
    const parsed = parseTsr(buf);
    return parsed.granted
      && parsed.tokenPresent
      && parsed.messageImprint !== null
      && parsed.messageImprint.equals(digest);
  } catch {
    return false;
  }
}

/**
 * Request an RFC 3161 timestamp for a digest. Returns the raw
 * TimeStampResp bytes if granted with a token whose imprint is this digest;
 * throws otherwise.
 */
const MAX_TSR_BYTES = 64 * 1024;
const TSA_TIMEOUT_MS = 30_000;

export async function requestTimestamp(digest, tsaUrl, fetchFn = fetch) {
  const res = await fetchFn(tsaUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/timestamp-query' },
    body: buildTsq(digest),
    signal: AbortSignal.timeout(TSA_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`tsa: http ${res.status}`);
  // Capped WHILE streaming: reading the whole body first meant a chunked
  // response with no content-length was buffered in full before the cap
  // could refuse it (audit, 2026-09-11).
  let body;
  try {
    body = await readBodyCapped(res, MAX_TSR_BYTES);
  } catch (err) {
    throw new Error(`tsa: ${err.message}`);
  }
  const parsed = parseTsr(body);
  if (!parsed.granted) throw new Error(`tsa: request rejected (status ${parsed.status})`);
  if (!parsed.tokenPresent) throw new Error('tsa: granted but no token in response');
  // The imprint is read out of TSTInfo, not searched for anywhere in the
  // bytes: the old whole-body scan accepted a token that timestamps something
  // else but happens to carry these 32 bytes in an unrelated field, and that
  // would only surface at offline `openssl ts -verify` time, years later.
  if (parsed.messageImprint === null) {
    throw new Error('tsa: response is not a structurally valid RFC 3161 timestamp token');
  }
  if (!parsed.messageImprint.equals(digest)) {
    throw new Error('tsa: token does not cover the requested imprint');
  }
  return body;
}
