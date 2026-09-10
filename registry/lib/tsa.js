// Minimal zero-dependency RFC 3161 client: build a DER TimeStampReq for a
// sha256 digest, POST it to a Time Stamping Authority, and check the
// response status is granted before storing the raw TimeStampResp (.tsr).
// Verification of stored tokens uses standard tooling:
//   openssl ts -reply -in <file>.tsr -text
//   openssl ts -verify -digest <hex> -in <file>.tsr -CAfile <tsa-ca.pem>
//
// No nonce is sent, deliberately: nonces protect response freshness, and a
// proof of existence only ever benefits from an EARLIER genuine response.

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

function readTlv(buf, pos) {
  if (pos + 2 > buf.length) throw new Error('tsa: truncated DER');
  const tag = buf[pos];
  let len = buf[pos + 1];
  let p = pos + 2;
  if (len & 0x80) {
    const n = len & 0x7f;
    if (n === 0 || n > 4 || p + n > buf.length) throw new Error('tsa: bad DER length');
    len = 0;
    for (let i = 0; i < n; i += 1) { len = (len << 8) | buf[p]; p += 1; }
  }
  if (p + len > buf.length) throw new Error('tsa: truncated DER value');
  return { tag, start: p, end: p + len, next: p + len };
}

/**
 * Parse a TimeStampResp far enough to know whether it was granted and
 * whether a token is present. Returns { granted, status, tokenPresent }.
 */
export function parseTsr(buf) {
  const outer = readTlv(buf, 0); // TimeStampResp SEQUENCE
  if (outer.tag !== 0x30) throw new Error('tsa: response is not a SEQUENCE');
  const statusInfo = readTlv(buf, outer.start); // PKIStatusInfo SEQUENCE
  if (statusInfo.tag !== 0x30) throw new Error('tsa: missing PKIStatusInfo');
  const statusInt = readTlv(buf, statusInfo.start);
  if (statusInt.tag !== 0x02) throw new Error('tsa: missing status INTEGER');
  let status = 0;
  for (let i = statusInt.start; i < statusInt.end; i += 1) status = (status << 8) | buf[i];
  const granted = status === 0 || status === 1; // granted | grantedWithMods
  const tokenPresent = statusInfo.next < outer.end;
  return { granted, status, tokenPresent };
}

/**
 * Request an RFC 3161 timestamp for a digest. Returns the raw
 * TimeStampResp bytes if granted with a token; throws otherwise.
 */
export async function requestTimestamp(digest, tsaUrl, fetchFn = fetch) {
  const res = await fetchFn(tsaUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/timestamp-query' },
    body: buildTsq(digest),
  });
  if (!res.ok) throw new Error(`tsa: http ${res.status}`);
  const body = Buffer.from(await res.arrayBuffer());
  const parsed = parseTsr(body);
  if (!parsed.granted) throw new Error(`tsa: request rejected (status ${parsed.status})`);
  if (!parsed.tokenPresent) throw new Error('tsa: granted but no token in response');
  return body;
}
