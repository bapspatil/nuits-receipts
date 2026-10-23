// Envelope senders are not authenticated by SMTP. Cloudflare Email Routing
// records its own SPF/DKIM/DMARC results in an Authentication-Results header
// it prepends to the message, so the topmost header carrying the
// mx.cloudflare.net authserv-id is trusted and anything lower (which a sender
// can forge) is ignored.
export type SenderVerdict = 'pass' | 'fail' | 'unknown';

const AUTHSERV = 'mx.cloudflare.net';
const HEADER_LIMIT = 256 * 1024;

export function headerFields(raw: Uint8Array): [name: string, value: string][] {
  const text = new TextDecoder('latin1').decode(raw.subarray(0, HEADER_LIMIT));
  const end = text.search(/\r?\n\r?\n/);
  const block = end === -1 ? text : text.slice(0, end);
  const fields: [string, string][] = [];
  for (const line of block.split(/\r?\n/)) {
    if (/^[ \t]/.test(line) && fields.length) {
      fields[fields.length - 1]![1] += ' ' + line.trim();
      continue;
    }
    const colon = line.indexOf(':');
    if (colon <= 0) continue;
    fields.push([line.slice(0, colon).trim().toLowerCase(), line.slice(colon + 1).trim()]);
  }
  return fields;
}

function stripComments(value: string): string {
  let out = '',
    depth = 0;
  for (const char of value) {
    if (char === '(') depth++;
    else if (char === ')' && depth > 0) depth--;
    else if (depth === 0) out += char;
  }
  return out;
}

// Returns the result clauses of the topmost header named `name` whose
// authserv-id is Cloudflare's, e.g. ["spf=pass smtp.mailfrom=a@b", "dkim=pass header.d=b"].
function cloudflareResults(fields: [string, string][], name: string): string[] | null {
  for (const [field, value] of fields) {
    if (field !== name) continue;
    const parts = stripComments(value)
      .split(';')
      .map((p) => p.trim().replace(/\s+/g, ' '))
      .filter(Boolean);
    if ((parts[0] ?? '').split(' ')[0]!.toLowerCase() !== AUTHSERV) continue;
    return parts.slice(1);
  }
  return null;
}

function result(clauses: string[], method: string): { result: string; props: Map<string, string> }[] {
  return clauses
    .filter((c) => c.toLowerCase().startsWith(method + '='))
    .map((c) => {
      const [head, ...rest] = c.split(' ');
      const props = new Map<string, string>();
      for (const token of rest) {
        const eq = token.indexOf('=');
        if (eq > 0)
          props.set(
            token.slice(0, eq).toLowerCase(),
            token
              .slice(eq + 1)
              .replace(/^"|"$/g, '')
              .toLowerCase(),
          );
      }
      return { result: head!.slice(method.length + 1).toLowerCase(), props };
    });
}

export function senderVerdict(raw: Uint8Array, envelopeFrom: string): SenderVerdict {
  const envelope = envelopeFrom.trim().toLowerCase();
  const domain = envelope.slice(envelope.lastIndexOf('@') + 1);
  const fields = headerFields(raw);
  // Only Cloudflare's own Authentication-Results, which it prepends above
  // anything the sender wrote. ARC results are not used: without verifying
  // the ARC seal, a forged ARC header cannot be told apart from a real one.
  const clauses = cloudflareResults(fields, 'authentication-results');
  if (!clauses) return 'unknown';

  // SPF evaluates the envelope MAIL FROM itself, the address we were handed.
  const spf = result(clauses, 'spf');
  const spfPass = spf.some((s) => {
    if (s.result !== 'pass') return false;
    const checked = s.props.get('smtp.mailfrom');
    return !checked || checked === envelope || checked === domain;
  });
  const receivedSpf = fields.find(([f, v]) => f === 'received-spf' && v.toLowerCase().includes('(' + AUTHSERV));
  const receivedEnvelope = receivedSpf?.[1].match(/envelope-from="?([^";\s]+)"?/i)?.[1]?.toLowerCase();
  if (receivedEnvelope && receivedEnvelope !== envelope) return 'fail';
  if (spfPass) return 'pass';
  const spfFailed = spf.some((s) => s.result === 'fail' || s.result === 'softfail');
  const dmarcFailed = result(clauses, 'dmarc').some((d) => d.result === 'fail');
  // DKIM-only mail (e.g. SPF none) stays unknown: Cloudflare's summary does not
  // say which domain signed, so it cannot prove the envelope address.
  return spfFailed || dmarcFailed ? 'fail' : 'unknown';
}
