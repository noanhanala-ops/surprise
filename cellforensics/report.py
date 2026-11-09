import csv
import json
import os
from collections import OrderedDict
from datetime import datetime, timezone
from html import escape

from . import __version__

FIELDS = ["timestamp", "timestamp_note", "platform", "tech", "mcc", "mnc", "area", "cell_id",
          "pci", "lat", "lon", "accuracy_m", "coord_origin", "source_type", "source_file",
          "source_sha256", "note"]

DISCLAIMER = ("Os registros indicam células (antenas) observadas pelo aparelho segundo os "
              "artefatos analisados. Coordenadas, quando presentes, são estimativas da "
              "cobertura da célula e não a posição exata do aparelho. Cruze com os registros "
              "da operadora (extrato de ERBs) e demais fontes antes de concluir.")


def sort_key(r):
    return (r.timestamp or "9999", r.mcc or 0, r.mnc or 0, r.area or 0, r.cell_id or 0)


def summarize(records):
    cells = OrderedDict()
    for r in sorted(records, key=sort_key):
        c = cells.setdefault(r.cell_key() + (r.tech,), {
            "tech": r.tech, "mcc": r.mcc, "mnc": r.mnc, "area": r.area, "cell_id": r.cell_id,
            "first_seen": r.timestamp, "last_seen": r.timestamp, "count": 0,
            "lat": r.lat, "lon": r.lon})
        c["count"] += 1
        if r.timestamp:
            c["first_seen"] = c["first_seen"] or r.timestamp
            c["last_seen"] = r.timestamp
        if c["lat"] is None:
            c["lat"], c["lon"] = r.lat, r.lon
    return list(cells.values())


def sources(records):
    out = OrderedDict()
    for r in records:
        out.setdefault(r.source_file, {"file": r.source_file, "sha256": r.source_sha256,
                                       "type": r.source_type, "records": 0})["records"] += 1
    return list(out.values())


def write_csv(records, path):
    with open(path, "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=FIELDS, extrasaction="ignore")
        w.writeheader()
        for r in sorted(records, key=sort_key):
            w.writerow(r.to_dict())


def write_json(records, path, input_path):
    doc = {
        "tool": "cellforensics", "version": __version__,
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "input": os.path.abspath(input_path), "disclaimer": DISCLAIMER,
        "sources": sources(records), "cells": summarize(records),
        "records": [r.to_dict() for r in sorted(records, key=sort_key)],
    }
    with open(path, "w", encoding="utf-8") as f:
        json.dump(doc, f, ensure_ascii=False, indent=2)


def _osm(lat, lon):
    if lat is None or lon is None:
        return ""
    return ('<a href="https://www.openstreetmap.org/?mlat=%s&amp;mlon=%s#map=15/%s/%s">mapa</a>'
            % (lat, lon, lat, lon))


def write_html(records, path, input_path):
    e = escape
    rows = "".join(
        "<tr><td>%s</td><td>%s</td><td>%s</td><td>%s-%s</td><td>%s</td><td>%s</td><td>%s</td>"
        "<td>%s</td><td>%s</td><td>%s</td></tr>" % (
            e(str(r.timestamp or "—")), e(r.platform), e(r.tech), e(str(r.mcc)), e(str(r.mnc)),
            e(str(r.area)), e(str(r.cell_id)), e(str(r.pci)),
            e("%s, %s (%s)" % (r.lat, r.lon, r.coord_origin)) if r.lat is not None else "—",
            _osm(r.lat, r.lon), e(r.source_file))
        for r in sorted(records, key=sort_key))
    cells = "".join(
        "<tr><td>%s</td><td>%s-%s</td><td>%s</td><td>%s</td><td>%s</td><td>%s</td><td>%s</td></tr>" % (
            e(c["tech"]), e(str(c["mcc"])), e(str(c["mnc"])), e(str(c["area"])), e(str(c["cell_id"])),
            e(str(c["first_seen"] or "—")), e(str(c["last_seen"] or "—")), c["count"])
        for c in summarize(records))
    src = "".join("<tr><td>%s</td><td>%s</td><td><code>%s</code></td><td>%d</td></tr>" % (
        e(s["file"]), e(s["type"]), e(s["sha256"]), s["records"]) for s in sources(records))
    html = """<!doctype html><html lang="pt-BR"><meta charset="utf-8">
<title>cellforensics</title><style>body{{font:14px sans-serif;margin:2em}}
table{{border-collapse:collapse;margin-bottom:2em}}td,th{{border:1px solid #bbb;padding:3px 8px}}
th{{background:#eee}}.warn{{background:#fff4d6;padding:8px;border:1px solid #e0b84a}}</style>
<h1>Células observadas</h1><p class="warn">{disc}</p>
<p>Entrada: {inp} &middot; gerado em {now} &middot; cellforensics {ver}</p>
<h2>Resumo por célula</h2><table><tr><th>Tec.</th><th>MCC-MNC</th><th>LAC/TAC</th><th>Cell ID</th>
<th>Primeira</th><th>Última</th><th>Registros</th></tr>{cells}</table>
<h2>Linha do tempo</h2><table><tr><th>Horário (UTC)</th><th>Plat.</th><th>Tec.</th><th>MCC-MNC</th>
<th>LAC/TAC</th><th>Cell ID</th><th>PCI</th><th>Coordenadas</th><th></th><th>Origem</th></tr>{rows}</table>
<h2>Fontes e hashes (SHA-256)</h2><table><tr><th>Arquivo</th><th>Tipo</th><th>SHA-256</th>
<th>Registros</th></tr>{src}</table></html>""".format(
        disc=e(DISCLAIMER), inp=e(os.path.abspath(input_path)),
        now=datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC"), ver=__version__,
        cells=cells, rows=rows, src=src)
    with open(path, "w", encoding="utf-8") as f:
        f.write(html)
