"""Android: CellIdentity* em bugreport/dumpsys (telephony.registry) e logcat de rádio.

Observação: bugreport/dumpsys mostram apenas o estado no momento da captura
(snapshot). Já linhas de logcat têm horário próprio, mas só cobrem o período
retido no buffer.
"""
import io
import os
import re
import zipfile

from ..models import CellRecord, clean_int
from ..util import sha256_file, walk
from datetime import datetime, timezone

NAME = "android"

IDENT_RE = re.compile(r"CellIdentity(Gsm|Wcdma|Lte|Nr|Cdma|Tdscdma):\s*\{(.*?)\}")
KV_RE = re.compile(r"m([A-Za-z0-9]+)=([^\s,}\]]+)")
LOGCAT_RE = re.compile(r"^(\d\d)-(\d\d)\s+(\d\d):(\d\d):(\d\d)\.(\d+)")
DUMPSTATE_RE = re.compile(r"==\s*dumpstate:\s*(\d{4})-(\d\d)-(\d\d)\s+(\d\d):(\d\d):(\d\d)")

TECH = {"Gsm": "GSM", "Wcdma": "WCDMA", "Lte": "LTE", "Nr": "NR", "Cdma": "CDMA", "Tdscdma": "TD-SCDMA"}
CELL_KEYS = {"GSM": ("Cid",), "WCDMA": ("Cid",), "TD-SCDMA": ("Cid",),
             "LTE": ("Ci",), "NR": ("Nci",), "CDMA": ("BasestationId",)}
AREA_KEYS = {"GSM": ("Lac",), "WCDMA": ("Lac",), "TD-SCDMA": ("Lac",),
             "LTE": ("Tac",), "NR": ("Tac",), "CDMA": ("NetworkId",)}
PCI_KEYS = ("Pci", "Psc", "Bsic")


def _pick(kv, keys):
    for k in keys:
        if k in kv:
            return clean_int(kv[k])
    return None


def _candidate(path):
    n = os.path.basename(path).lower()
    if n.endswith((".db", ".sqlite", ".png", ".jpg", ".jpeg", ".mp4", ".plist")):
        return False
    return n.endswith((".txt", ".log")) or any(
        w in n for w in ("bugreport", "dumpstate", "logcat", "radio", "telephony"))


def _lines_from_file(path):
    with open(path, "r", encoding="utf-8", errors="replace") as f:
        yield from f


def _parse_lines(lines, rel, sha, source_type, out):
    header_dt = None
    header_year = None
    seen = set()
    for line in lines:
        if header_dt is None:
            m = DUMPSTATE_RE.search(line)
            if m:
                y, mo, d, h, mi, s = map(int, m.groups())
                header_dt = datetime(y, mo, d, h, mi, s, tzinfo=timezone.utc)
                header_year = y
        if "CellIdentity" not in line:
            continue
        lm = LOGCAT_RE.match(line)
        for m in IDENT_RE.finditer(line):
            tech = TECH[m.group(1)]
            kv = dict(KV_RE.findall(m.group(2)))
            cell = _pick(kv, CELL_KEYS[tech])
            mcc = clean_int(kv.get("Mcc"))
            if cell is None and mcc is None:
                continue
            if lm:
                mo, d, h, mi, s, ms = map(int, lm.groups())
                if header_year:
                    ts = datetime(header_year, mo, d, h, mi, s, tzinfo=timezone.utc).isoformat()
                    tnote = "logcat (fuso do aparelho pode diferir de UTC)"
                else:
                    ts = None
                    tnote = "logcat sem ano: %02d-%02d %02d:%02d:%02d" % (mo, d, h, mi, s)
                stype = "logcat"
            else:
                ts = header_dt.isoformat() if header_dt else None
                tnote = "snapshot do bugreport (momento da captura, não de uso)"
                stype = source_type
            rec = CellRecord(
                platform="android", source_type=stype, source_file=rel, source_sha256=sha,
                tech=tech, mcc=mcc, mnc=clean_int(kv.get("Mnc")),
                area=_pick(kv, AREA_KEYS[tech]), cell_id=cell, pci=_pick(kv, PCI_KEYS),
                timestamp=ts, timestamp_note=tnote)
            k = (rec.key(), tnote)
            if k in seen:
                continue
            seen.add(k)
            out.append(rec)


def parse(root):
    out = []
    base = root if os.path.isdir(root) else os.path.dirname(root)
    for path in walk(root):
        rel = os.path.relpath(path, base)
        low = path.lower()
        if low.endswith(".zip"):
            try:
                with zipfile.ZipFile(path) as z:
                    for info in z.infolist():
                        n = os.path.basename(info.filename).lower()
                        if n.endswith(".txt") and ("bugreport" in n or "dumpstate" in n):
                            with z.open(info) as f:
                                lines = io.TextIOWrapper(f, encoding="utf-8", errors="replace")
                                _parse_lines(lines, rel + "!" + info.filename,
                                             sha256_file(path), "bugreport", out)
            except zipfile.BadZipFile:
                pass
            continue
        if _candidate(path):
            _parse_lines(_lines_from_file(path), rel, sha256_file(path), "dumpsys", out)
    return out
