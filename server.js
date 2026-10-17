#!/usr/bin/env node
// The forms MCP server — lets any MCP client (Claude Desktop/Code, Cursor, …)
// find Philippine government forms, read what each one needs, fill it, and
// verify a filled PDF. Zero dependencies: JSON-RPC 2.0 over stdio.
//
// Configure in your MCP client:
//   { "command": "node", "args": ["/path/to/integrations/mcp/server.js"],
//     "env": { "PDFPHILE_API_KEY": "pk_live_…", "PDFPHILE_API_URL": "https://<the site>" } }
//
// Filled PDFs are written to PDFPHILE_OUT_DIR (default: ./pdfphile-out) and the
// path is returned, so the agent can attach or open it.
import readline from 'node:readline';
import fs from 'node:fs';
import path from 'node:path';

// The site this talks to: the server writes its origin and name in when it hands this file out
// (GET /downloads/…); run from a checkout, they come from the repo's config/site.json.
const SITE_ORIGIN = "https://philforms.com", SITE_NAME = "PhilForms";
function siteOf() {
  if (/^https?:/.test(SITE_ORIGIN)) return { origin: SITE_ORIGIN, name: SITE_NAME };
  try {
    const c = JSON.parse(fs.readFileSync(new URL('../../config/site.json', import.meta.url), 'utf8'));
    const b = c.brand[process.env.PDFPHILE_BRAND] || c.brand[c.active_brand];
    return { origin: `https://${b.domain}`, name: b.name };
  } catch { return { origin: 'http://localhost:8080', name: 'the forms API' }; }
}
const SITE = siteOf();

// PDFPHILE_URL is what the CLI reads: accept either, so one environment drives both.
const API = (process.env.PDFPHILE_API_URL || process.env.PDFPHILE_URL || SITE.origin).replace(/\/$/, '');
const KEY = process.env.PDFPHILE_API_KEY || '';
const OUT = process.env.PDFPHILE_OUT_DIR || path.resolve('pdfphile-out');

const TOOL = [
  {
    name: 'search_forms',
    description: 'Search the catalogue of Philippine government/agency forms (BIR, SSS, PhilHealth, Pag-IBIG, GSIS, COA, CSC, GPPB …). Returns form ids to use with the other tools.',
    inputSchema: { type: 'object', properties: { query: { type: 'string', description: 'e.g. "2307", "withholding certificate", "philhealth claim"' }, agency: { type: 'string' } } },
  },
  {
    name: 'get_form_parameters',
    description: 'The fill contract of one form: every parameter with its printed label, type (tin/date/amount/choice/…), format, allowed choice values and printed cell count.',
    inputSchema: { type: 'object', properties: { form_id: { type: 'string' } }, required: ['form_id'] },
  },
  {
    name: 'fill_form',
    description: 'Fill a form. `data` is keyed by parameter name from get_form_parameters. Values the printed form cannot hold are rejected with the reason. Returns the saved PDF path and its tamper-evident document id.',
    inputSchema: { type: 'object', properties: { form_id: { type: 'string' }, data: { type: 'object' }, file_name: { type: 'string' }, compute: { type: 'boolean', description: 'Fill the blank lines the form itself says how to work out (totals, 8% tax due …) — never changes a value you sent' } }, required: ['form_id', 'data'] },
  },
  {
    name: 'check_form_values',
    description: 'Dry run before fill_form (free, no PDF): returns every refused value as an issue { field, label, code, expected, message } — e.g. a letter in a TIN, a short PhilHealth PIN, an impossible date — and the core fields (filer ID, name, address) still blank. Values are never silently altered: fix the issues, then fill.',
    inputSchema: { type: 'object', properties: { form_id: { type: 'string' }, data: { type: 'object' }, compute: { type: 'boolean', description: 'Also work out the form\'s computed lines; they come back under `computed`' } }, required: ['form_id', 'data'] },
  },
  {
    name: 'verify_pdf',
    description: `Check whether a PDF was issued by ${SITE.name} and is unmodified (genuine / modified / unknown).`,
    inputSchema: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] },
  },
];

async function api(method, route, body, isBinary = false) {
  const res = await fetch(`${API}${route}`, {
    method,
    headers: { ...(KEY ? { Authorization: `Bearer ${KEY}` } : {}), ...(body && !(body instanceof Uint8Array) ? { 'Content-Type': 'application/json' } : {}), ...(body instanceof Uint8Array ? { 'Content-Type': 'application/pdf' } : {}) },
    body: body instanceof Uint8Array ? body : body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    let detail;
    try { detail = await res.json(); } catch { detail = { error: await res.text() }; }
    throw new Error(`${res.status} ${detail.error || ''}${detail.issue ? ': ' + JSON.stringify(detail.issue) : detail.detail ? ': ' + JSON.stringify(detail.detail) : ''}`);
  }
  return isBinary ? { buf: Buffer.from(await res.arrayBuffer()), header: res.headers } : res.json();
}

async function call(name, arg) {
  if (name === 'search_forms') {
    const q = new URLSearchParams({ ...(arg.query ? { q: arg.query } : {}), ...(arg.agency ? { agency: arg.agency } : {}) });
    return api('GET', `/api/v1/engine/forms?${q}`);
  }
  if (name === 'get_form_parameters') return api('GET', `/api/v1/parameters/${encodeURIComponent(arg.form_id)}`);
  if (name === 'fill_form') {
    const { buf, header } = await api('POST', `/api/v1/engine/fill/${encodeURIComponent(arg.form_id)}${arg.compute ? '?compute=1' : ''}`, arg.data, true);
    fs.mkdirSync(OUT, { recursive: true });
    const file = path.join(OUT, arg.file_name || `${arg.form_id}-${header.get('x-document-id') || Date.now()}.pdf`);
    fs.writeFileSync(file, buf);
    const missing = header.get('x-fields-missing');
    return { path: file, document_id: header.get('x-document-id'), boxes_filled: Number(header.get('x-boxes-filled')), bytes: buf.length, verify_url: `${API}/verify`, ...(missing ? { core_fields_left_blank: missing.split(',') } : {}) };
  }
  if (name === 'check_form_values') {
    // 422 is an answer here (the issues), not a failure.
    const res = await fetch(`${API}/api/v1/engine/check/${encodeURIComponent(arg.form_id)}${arg.compute ? '?compute=1' : ''}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(arg.data || {}) });
    if (res.status !== 200 && res.status !== 422) throw new Error(`${res.status} ${(await res.json().catch(() => ({}))).error || ''}`);
    return res.json();
  }
  if (name === 'verify_pdf') return api('POST', '/api/v1/verify', new Uint8Array(fs.readFileSync(arg.path)));
  throw new Error(`unknown tool ${name}`);
}

const send = (msg) => process.stdout.write(JSON.stringify({ jsonrpc: '2.0', ...msg }) + '\n');

readline.createInterface({ input: process.stdin }).on('line', async (line) => {
  let req;
  try { req = JSON.parse(line); } catch { return; }
  const { id, method, params } = req;
  if (id === undefined) return; // notification
  try {
    if (method === 'initialize') {
      return send({ id, result: { protocolVersion: params?.protocolVersion || '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'philforms', title: SITE.name, version: '1.0.0' } } });
    }
    if (method === 'tools/list') return send({ id, result: { tools: TOOL } });
    if (method === 'tools/call') {
      try {
        const result = await call(params.name, params.arguments || {});
        return send({ id, result: { content: [{ type: 'text', text: JSON.stringify(result, null, 1) }] } });
      } catch (e) {
        return send({ id, result: { isError: true, content: [{ type: 'text', text: e.message }] } });
      }
    }
    if (method === 'ping') return send({ id, result: {} });
    send({ id, error: { code: -32601, message: `Method not found: ${method}` } });
  } catch (e) {
    send({ id, error: { code: -32603, message: e.message } });
  }
});
