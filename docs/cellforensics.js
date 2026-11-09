/* cellforensics (versão navegador) - lê artefatos de antenas de extrações forenses.
 * Tudo roda localmente; nenhum arquivo é enviado a servidor algum.
 * Espelha o parser Python (pacote cellforensics/). */
(function () {
  "use strict";
  const VERSION = "0.1.0";
  const INT_UNAVAILABLE = new Set([2147483647, -1, 9223372036854775807]);
  const MAX_HASH_BYTES = 1.5 * 1024 * 1024 * 1024;

  const DISCLAIMER = "Os registros indicam células (antenas) observadas pelo aparelho segundo os " +
    "artefatos analisados. Coordenadas, quando presentes, são estimativas da cobertura da célula " +
    "e não a posição exata do aparelho. Cruze com os registros da operadora (extrato de ERBs) e " +
    "demais fontes antes de concluir.";

  const FIELDS = ["timestamp", "timestamp_note", "platform", "tech", "mcc", "mnc", "area", "cell_id",
    "pci", "lat", "lon", "accuracy_m", "coord_origin", "source_type", "source_file", "source_sha256", "note"];

  function cleanInt(v) {
    if (v === null || v === undefined) return null;
    const s = String(v).trim();
    if (!/^-?\d+$/.test(s)) return null;
    const n = Number(s);
    return INT_UNAVAILABLE.has(n) ? null : n;
  }

  async function sha256(blob) {
    if (blob.size > MAX_HASH_BYTES) return "não calculado (arquivo > 1,5 GB)";
    const buf = await blob.arrayBuffer();
    const d = await crypto.subtle.digest("SHA-256", buf);
    return Array.from(new Uint8Array(d), b => b.toString(16).padStart(2, "0")).join("");
  }

  async function* linesOf(stream) {
    const reader = stream.pipeThrough(new TextDecoderStream("utf-8")).getReader();
    let rest = "";
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      rest += value;
      let i;
      let start = 0;
      while ((i = rest.indexOf("\n", start)) >= 0) {
        yield rest.slice(start, i);
        start = i + 1;
      }
      rest = rest.slice(start);
    }
    if (rest) yield rest;
  }

  function mkRecord(o) {
    return Object.assign({
      platform: "", source_type: "", source_file: "", source_sha256: "", tech: "", mcc: null,
      mnc: null, area: null, cell_id: null, pci: null, timestamp: null, timestamp_note: "",
      lat: null, lon: null, accuracy_m: null, coord_origin: "", note: ""
    }, o);
  }
  const recKey = r => [r.tech, r.mcc, r.mnc, r.area, r.cell_id, r.timestamp].join("|");
  const cellKey = r => [r.mcc, r.mnc, r.area, r.cell_id].join("|");

  /* ---------------- Android ---------------- */
  const IDENT_RE = /CellIdentity(Gsm|Wcdma|Lte|Nr|Cdma|Tdscdma):\s*\{(.*?)\}/g;
  const KV_RE = /m([A-Za-z0-9]+)=([^\s,}\]]+)/g;
  const LOGCAT_RE = /^(\d\d)-(\d\d)\s+(\d\d):(\d\d):(\d\d)\.(\d+)/;
  const DUMPSTATE_RE = /==\s*dumpstate:\s*(\d{4})-(\d\d)-(\d\d)\s+(\d\d):(\d\d):(\d\d)/;
  const TECH = { Gsm: "GSM", Wcdma: "WCDMA", Lte: "LTE", Nr: "NR", Cdma: "CDMA", Tdscdma: "TD-SCDMA" };
  const CELL_KEYS = { GSM: ["Cid"], WCDMA: ["Cid"], "TD-SCDMA": ["Cid"], LTE: ["Ci"], NR: ["Nci"], CDMA: ["BasestationId"] };
  const AREA_KEYS = { GSM: ["Lac"], WCDMA: ["Lac"], "TD-SCDMA": ["Lac"], LTE: ["Tac"], NR: ["Tac"], CDMA: ["NetworkId"] };
  const PCI_KEYS = ["Pci", "Psc", "Bsic"];

  const pick = (kv, keys) => {
    for (const k of keys) if (k in kv) return cleanInt(kv[k]);
    return null;
  };
  const pad = (n, w = 2) => String(n).padStart(w, "0");
  const isoUtc = (y, mo, d, h, mi, s) =>
    `${y}-${pad(mo)}-${pad(d)}T${pad(h)}:${pad(mi)}:${pad(s)}+00:00`;

  async function parseAndroidLines(lines, rel, sha, sourceType, out) {
    let headerTs = null, headerYear = null;
    const seen = new Set();
    for await (const line of lines) {
      if (headerTs === null) {
        const m = DUMPSTATE_RE.exec(line);
        if (m) {
          const [y, mo, d, h, mi, s] = m.slice(1).map(Number);
          headerTs = isoUtc(y, mo, d, h, mi, s);
          headerYear = y;
        }
      }
      if (!line.includes("CellIdentity")) continue;
      const lm = LOGCAT_RE.exec(line);
      for (const m of line.matchAll(IDENT_RE)) {
        const tech = TECH[m[1]];
        const kv = {};
        for (const p of m[2].matchAll(KV_RE)) kv[p[1]] = p[2];
        const cell = pick(kv, CELL_KEYS[tech]);
        const mcc = cleanInt(kv.Mcc);
        if (cell === null && mcc === null) continue;
        let ts, tnote, stype;
        if (lm) {
          const [mo, d, h, mi, s] = lm.slice(1, 6).map(Number);
          if (headerYear) {
            ts = isoUtc(headerYear, mo, d, h, mi, s);
            tnote = "logcat (fuso do aparelho pode diferir de UTC)";
          } else {
            ts = null;
            tnote = `logcat sem ano: ${pad(mo)}-${pad(d)} ${pad(h)}:${pad(mi)}:${pad(s)}`;
          }
          stype = "logcat";
        } else {
          ts = headerTs;
          tnote = "snapshot do bugreport (momento da captura, não de uso)";
          stype = sourceType;
        }
        const rec = mkRecord({
          platform: "android", source_type: stype, source_file: rel, source_sha256: sha, tech, mcc,
          mnc: cleanInt(kv.Mnc), area: pick(kv, AREA_KEYS[tech]), cell_id: cell, pci: pick(kv, PCI_KEYS),
          timestamp: ts, timestamp_note: tnote
        });
        const k = recKey(rec) + "#" + tnote;
        if (seen.has(k)) continue;
        seen.add(k);
        out.push(rec);
      }
    }
  }

  /* ---------------- ZIP (sem dependências) ---------------- */
  async function zipEntries(blob) {
    const tailLen = Math.min(blob.size, 66000);
    const tail = new DataView(await blob.slice(blob.size - tailLen).arrayBuffer());
    let eocd = -1;
    for (let i = tailLen - 22; i >= 0; i--) {
      if (tail.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
    }
    if (eocd < 0) throw new Error("não é um ZIP válido");
    const count = tail.getUint16(eocd + 10, true);
    const cdSize = tail.getUint32(eocd + 12, true);
    const cdOff = tail.getUint32(eocd + 16, true);
    if (cdOff === 0xffffffff) throw new Error("ZIP64 não suportado");
    const cd = new DataView(await blob.slice(cdOff, cdOff + cdSize).arrayBuffer());
    const dec = new TextDecoder();
    const entries = [];
    let p = 0;
    for (let n = 0; n < count && p + 46 <= cd.byteLength; n++) {
      if (cd.getUint32(p, true) !== 0x02014b50) break;
      const method = cd.getUint16(p + 10, true);
      const csize = cd.getUint32(p + 20, true);
      const nlen = cd.getUint16(p + 28, true), xlen = cd.getUint16(p + 30, true), clen = cd.getUint16(p + 32, true);
      const lho = cd.getUint32(p + 42, true);
      const name = dec.decode(new Uint8Array(cd.buffer, cd.byteOffset + p + 46, nlen));
      entries.push({ name, method, csize, lho });
      p += 46 + nlen + xlen + clen;
    }
    return entries;
  }

  async function zipEntryStream(blob, e) {
    const lh = new DataView(await blob.slice(e.lho, e.lho + 30).arrayBuffer());
    const start = e.lho + 30 + lh.getUint16(26, true) + lh.getUint16(28, true);
    const data = blob.slice(start, start + e.csize);
    if (e.method === 0) return data.stream();
    if (e.method === 8) return data.stream().pipeThrough(new DecompressionStream("deflate-raw"));
    throw new Error("método de compressão ZIP não suportado: " + e.method);
  }

  /* ---------------- iOS ---------------- */
  const IOS_DBS = ["consolidated.db", "cache_encrypteda.db", "cache_encryptedb.db", "cache_encryptedc.db", "cache_encryptedd.db"];

  function iosTech(table) {
    const t = table.toLowerCase();
    if (t.includes("lte")) return "LTE";
    if (t.replace("number", "").includes("nr")) return "NR";
    if (t.includes("wcdma")) return "WCDMA";
    if (t.includes("cdma")) return "CDMA";
    return "GSM";
  }
  function cocoaIso(v) {
    const n = Number(v);
    if (v === null || v === undefined || !isFinite(n)) return null;
    const d = new Date(Date.UTC(2001, 0, 1) + n * 1000);
    return isNaN(d) ? null : d.toISOString().replace(".000Z", "+00:00").replace("Z", "+00:00");
  }

  function parseIosDb(SQL, bytes, rel, sha, out) {
    let db;
    try { db = new SQL.Database(bytes); } catch (e) { return; }
    try {
      const q = (sql) => { const r = db.exec(sql); return r.length ? r[0] : { columns: [], values: [] }; };
      const tables = q("SELECT name FROM sqlite_master WHERE type='table'").values.map(r => r[0]);
      for (const table of tables) {
        if (!table.toLowerCase().includes("celllocation")) continue;
        const qt = '"' + table.replace(/"/g, '""') + '"';
        const cols = {};
        for (const r of q(`PRAGMA table_info(${qt})`).values) cols[String(r[1]).toLowerCase()] = r[1];
        const col = (...names) => { for (const n of names) if (n in cols) return cols[n]; return null; };
        const cMcc = col("mcc"), cMnc = col("mnc"), cArea = col("lac", "tac"),
          cCell = col("ci", "cid", "cellid", "nci", "eci"), cPci = col("pci", "psc"),
          cTs = col("timestamp"), cLat = col("latitude"), cLon = col("longitude"),
          cAcc = col("horizontalaccuracy", "accuracy");
        if (!cCell || !cMcc) continue;
        const sel = [cMcc, cMnc, cArea, cCell, cPci, cTs, cLat, cLon, cAcc].filter(Boolean);
        const res = q(`SELECT ${sel.map(c => '"' + c + '"').join(", ")} FROM ${qt}`);
        for (const row of res.values) {
          const r = {};
          sel.forEach((c, i) => { r[c] = row[i]; });
          const lat = cLat ? r[cLat] : null;
          out.push(mkRecord({
            platform: "ios", source_type: "ios_locationd:" + table, source_file: rel, source_sha256: sha,
            tech: iosTech(table), mcc: cleanInt(r[cMcc]), mnc: cMnc ? cleanInt(r[cMnc]) : null,
            area: cArea ? cleanInt(r[cArea]) : null, cell_id: cleanInt(r[cCell]),
            pci: cPci ? cleanInt(r[cPci]) : null,
            timestamp: cTs ? cocoaIso(r[cTs]) : null,
            timestamp_note: cTs ? "época Cocoa convertida para UTC" : "sem timestamp",
            lat: lat === undefined ? null : lat, lon: cLon ? r[cLon] : null,
            accuracy_m: cAcc ? r[cAcc] : null,
            coord_origin: lat !== null && lat !== undefined ? "device_cache" : "",
            note: "coordenadas são do cache de localização da célula, não do aparelho"
          }));
        }
      }
    } finally { db.close(); }
  }

  /* ---------------- pipeline ---------------- */
  const baseName = p => p.split("/").pop().toLowerCase();
  function isAndroidCandidate(path) {
    const n = baseName(path);
    if (/\.(db|sqlite|png|jpe?g|mp4|plist)$/.test(n)) return false;
    return /\.(txt|log)$/.test(n) || ["bugreport", "dumpstate", "logcat", "radio", "telephony"].some(w => n.includes(w));
  }

  /* files: [{path: "pasta/arq", file: Blob}] */
  async function collect(files, SQL, onProgress) {
    const out = [];
    const sorted = files.slice().sort((a, b) => (a.path < b.path ? -1 : 1));
    let i = 0;
    for (const { path, file } of sorted) {
      i++;
      if (onProgress) onProgress(i, sorted.length, path);
      const n = baseName(path);
      try {
        if (n.endsWith(".zip")) {
          const entries = await zipEntries(file);
          const wanted = entries.filter(e => {
            const b = baseName(e.name);
            return b.endsWith(".txt") && (b.includes("bugreport") || b.includes("dumpstate"));
          });
          if (wanted.length) {
            const sha = await sha256(file);
            for (const e of wanted)
              await parseAndroidLines(linesOf(await zipEntryStream(file, e)), path + "!" + e.name, sha, "bugreport", out);
          }
        } else if (IOS_DBS.includes(n)) {
          if (SQL) parseIosDb(SQL, new Uint8Array(await file.arrayBuffer()), path, await sha256(file), out);
        } else if (isAndroidCandidate(path)) {
          await parseAndroidLines(linesOf(file.stream()), path, await sha256(file), "dumpsys", out);
        }
      } catch (err) {
        if (onProgress) onProgress(i, sorted.length, path, err);
      }
    }
    const seen = new Set();
    return out.filter(r => {
      const k = [r.platform, r.source_file, recKey(r), r.timestamp_note].join("#");
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
  }

  /* ---------------- towerdb (OpenCelliD CSV) ---------------- */
  async function resolveTowers(records, blob) {
    const wanted = new Set(records.filter(r => r.lat === null && !cellKey(r).includes("null")).map(cellKey));
    const found = new Map();
    let header = null;
    for await (const line of linesOf(blob.stream())) {
      const f = line.replace(/\r$/, "").split(",");
      if (!header) { header = f; continue; }
      const g = k => f[header.indexOf(k)];
      const key = [parseInt(g("mcc")), parseInt(g("net")), parseInt(g("area")), parseInt(g("cell"))].join("|");
      if (wanted.has(key)) found.set(key, [parseFloat(g("lat")), parseFloat(g("lon")), g("range")]);
    }
    let n = 0;
    for (const r of records) {
      const hit = found.get(cellKey(r));
      if (hit && r.lat === null) {
        r.lat = hit[0]; r.lon = hit[1];
        r.accuracy_m = hit[2] ? parseFloat(hit[2]) : null;
        r.coord_origin = "towerdb";
        r.note = (r.note ? r.note + "; " : "") + "posição estimada da torre (OpenCelliD)";
        n++;
      }
    }
    return n;
  }

  /* ---------------- relatórios ---------------- */
  const sortKey = r => (r.timestamp || "9999") + "|" + pad(r.mcc || 0, 5) + pad(r.mnc || 0, 5) +
    pad(r.area || 0, 10) + pad(r.cell_id || 0, 12);
  const sorted = recs => recs.slice().sort((a, b) => (sortKey(a) < sortKey(b) ? -1 : sortKey(a) > sortKey(b) ? 1 : 0));

  function summarize(records) {
    const cells = new Map();
    for (const r of sorted(records)) {
      const k = cellKey(r) + "|" + r.tech;
      let c = cells.get(k);
      if (!c) {
        c = { tech: r.tech, mcc: r.mcc, mnc: r.mnc, area: r.area, cell_id: r.cell_id,
          first_seen: r.timestamp, last_seen: r.timestamp, count: 0, lat: r.lat, lon: r.lon };
        cells.set(k, c);
      }
      c.count++;
      if (r.timestamp) { c.first_seen = c.first_seen || r.timestamp; c.last_seen = r.timestamp; }
      if (c.lat === null) { c.lat = r.lat; c.lon = r.lon; }
    }
    return Array.from(cells.values());
  }

  function sources(records) {
    const m = new Map();
    for (const r of records) {
      if (!m.has(r.source_file)) m.set(r.source_file, { file: r.source_file, sha256: r.source_sha256, type: r.source_type, records: 0 });
      m.get(r.source_file).records++;
    }
    return Array.from(m.values());
  }

  function toCsv(records) {
    const esc = v => {
      if (v === null || v === undefined) return "";
      const s = String(v);
      return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    };
    return [FIELDS.join(",")].concat(sorted(records).map(r => FIELDS.map(f => esc(r[f])).join(","))).join("\r\n") + "\r\n";
  }

  function toJson(records, inputLabel) {
    return JSON.stringify({
      tool: "cellforensics-web", version: VERSION, generated_at: new Date().toISOString(),
      input: inputLabel, disclaimer: DISCLAIMER, sources: sources(records),
      cells: summarize(records), records: sorted(records)
    }, null, 2);
  }

  const e = s => String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const osm = (lat, lon) => lat === null || lon === null ? "" :
    `<a href="https://www.openstreetmap.org/?mlat=${e(lat)}&amp;mlon=${e(lon)}#map=15/${e(lat)}/${e(lon)}" rel="noopener noreferrer">mapa</a>`;

  function toHtml(records, inputLabel) {
    const rows = sorted(records).map(r =>
      `<tr><td>${e(r.timestamp || "—")}</td><td>${e(r.platform)}</td><td>${e(r.tech)}</td><td>${e(r.mcc)}-${e(r.mnc)}</td>` +
      `<td>${e(r.area)}</td><td>${e(r.cell_id)}</td><td>${e(r.pci)}</td>` +
      `<td>${r.lat !== null ? e(r.lat + ", " + r.lon + " (" + r.coord_origin + ")") : "—"}</td><td>${osm(r.lat, r.lon)}</td><td>${e(r.source_file)}</td></tr>`).join("");
    const cells = summarize(records).map(c =>
      `<tr><td>${e(c.tech)}</td><td>${e(c.mcc)}-${e(c.mnc)}</td><td>${e(c.area)}</td><td>${e(c.cell_id)}</td>` +
      `<td>${e(c.first_seen || "—")}</td><td>${e(c.last_seen || "—")}</td><td>${c.count}</td></tr>`).join("");
    const src = sources(records).map(s =>
      `<tr><td>${e(s.file)}</td><td>${e(s.type)}</td><td><code>${e(s.sha256)}</code></td><td>${s.records}</td></tr>`).join("");
    return `<!doctype html><html lang="pt-BR"><meta charset="utf-8"><title>cellforensics</title>
<style>body{font:14px sans-serif;margin:2em}table{border-collapse:collapse;margin-bottom:2em}td,th{border:1px solid #bbb;padding:3px 8px}
th{background:#eee}.warn{background:#fff4d6;padding:8px;border:1px solid #e0b84a}</style>
<h1>Células observadas</h1><p class="warn">${e(DISCLAIMER)}</p>
<p>Entrada: ${e(inputLabel)} &middot; gerado em ${e(new Date().toISOString())} &middot; cellforensics-web ${VERSION}</p>
<h2>Resumo por célula</h2><table><tr><th>Tec.</th><th>MCC-MNC</th><th>LAC/TAC</th><th>Cell ID</th><th>Primeira</th><th>Última</th><th>Registros</th></tr>${cells}</table>
<h2>Linha do tempo</h2><table><tr><th>Horário (UTC)</th><th>Plat.</th><th>Tec.</th><th>MCC-MNC</th><th>LAC/TAC</th><th>Cell ID</th><th>PCI</th><th>Coordenadas</th><th></th><th>Origem</th></tr>${rows}</table>
<h2>Fontes e hashes (SHA-256)</h2><table><tr><th>Arquivo</th><th>Tipo</th><th>SHA-256</th><th>Registros</th></tr>${src}</table></html>`;
  }

  const CF = { VERSION, DISCLAIMER, collect, resolveTowers, summarize, sources, toCsv, toJson, toHtml, sorted };
  if (typeof module !== "undefined" && module.exports) module.exports = CF;
  else globalThis.CF = CF;
})();
