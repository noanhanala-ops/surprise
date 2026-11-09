"""iOS: caches do locationd (consolidated.db, cache_encrypted*.db).

Tabelas '*CellLocation' guardam células observadas pelo aparelho, com
timestamp (época Cocoa, 2001-01-01 UTC) e coordenadas ESTIMADAS DA CÉLULA
(cache da Apple), não a posição do aparelho. Os nomes de tabelas/colunas variam
entre versões do iOS; o parser é tolerante e mapeia colunas por nome.
"""
import os
import sqlite3
from datetime import datetime, timedelta, timezone

from ..models import CellRecord, clean_int
from ..util import sha256_file, walk

NAME = "ios"
COCOA_EPOCH = datetime(2001, 1, 1, tzinfo=timezone.utc)
DB_NAMES = ("consolidated.db", "cache_encrypteda.db", "cache_encryptedb.db",
            "cache_encryptedc.db", "cache_encryptedd.db")


def _tech(table):
    t = table.lower()
    if "lte" in t:
        return "LTE"
    if "nr" in t.replace("number", ""):
        return "NR"
    if "wcdma" in t:
        return "WCDMA"
    if "cdma" in t:
        return "CDMA"
    return "GSM"


def _cocoa(v):
    try:
        return (COCOA_EPOCH + timedelta(seconds=float(v))).isoformat()
    except (TypeError, ValueError, OverflowError):
        return None


def _col(cols, *names):
    for n in names:
        if n in cols:
            return cols[n]
    return None


def _parse_db(path, rel, sha, out):
    uri = "file:%s?mode=ro&immutable=1" % path
    try:
        con = sqlite3.connect(uri, uri=True)
    except sqlite3.Error:
        return
    try:
        tables = [r[0] for r in con.execute(
            "SELECT name FROM sqlite_master WHERE type='table'")]
        for table in tables:
            if "celllocation" not in table.lower():
                continue
            info = con.execute('PRAGMA table_info("%s")' % table.replace('"', '""')).fetchall()
            cols = {r[1].lower(): r[1] for r in info}
            c_mcc, c_mnc = _col(cols, "mcc"), _col(cols, "mnc")
            c_area = _col(cols, "lac", "tac")
            c_cell = _col(cols, "ci", "cid", "cellid", "nci", "eci")
            c_pci = _col(cols, "pci", "psc")
            c_ts = _col(cols, "timestamp")
            c_lat, c_lon = _col(cols, "latitude"), _col(cols, "longitude")
            c_acc = _col(cols, "horizontalaccuracy", "accuracy")
            if not (c_cell and c_mcc):
                continue
            sel = [c for c in (c_mcc, c_mnc, c_area, c_cell, c_pci, c_ts, c_lat, c_lon, c_acc) if c]
            q = 'SELECT %s FROM "%s"' % (", ".join('"%s"' % c for c in sel),
                                         table.replace('"', '""'))
            for row in con.execute(q):
                r = dict(zip(sel, row))
                out.append(CellRecord(
                    platform="ios", source_type="ios_locationd:" + table,
                    source_file=rel, source_sha256=sha, tech=_tech(table),
                    mcc=clean_int(r.get(c_mcc)), mnc=clean_int(r.get(c_mnc)) if c_mnc else None,
                    area=clean_int(r.get(c_area)) if c_area else None,
                    cell_id=clean_int(r.get(c_cell)),
                    pci=clean_int(r.get(c_pci)) if c_pci else None,
                    timestamp=_cocoa(r.get(c_ts)) if c_ts else None,
                    timestamp_note="época Cocoa convertida para UTC" if c_ts else "sem timestamp",
                    lat=r.get(c_lat) if c_lat else None, lon=r.get(c_lon) if c_lon else None,
                    accuracy_m=r.get(c_acc) if c_acc else None,
                    coord_origin="device_cache" if c_lat and r.get(c_lat) is not None else "",
                    note="coordenadas são do cache de localização da célula, não do aparelho"))
    except sqlite3.Error:
        pass
    finally:
        con.close()


def parse(root):
    out = []
    base = root if os.path.isdir(root) else os.path.dirname(root)
    for path in walk(root):
        if os.path.basename(path).lower() in DB_NAMES:
            _parse_db(os.path.abspath(path), os.path.relpath(path, base), sha256_file(path), out)
    return out
