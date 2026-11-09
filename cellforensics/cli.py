import argparse
import os
import sys

from . import report, towerdb
from .parsers import PARSERS


def collect(path):
    records = []
    for p in PARSERS:
        records.extend(p.parse(path))
    seen, unique = set(), []
    for r in records:
        k = (r.platform, r.source_file, r.key(), r.timestamp_note)
        if k not in seen:
            seen.add(k)
            unique.append(r)
    return unique


def main(argv=None):
    ap = argparse.ArgumentParser(
        prog="cellforensics",
        description="Extrai células (antenas) de uma extração forense Android/iOS já adquirida "
                    "(pasta ou arquivo). Somente leitura; não acessa aparelhos nem redes.")
    ap.add_argument("input", help="pasta da extração, bugreport (.txt/.zip) ou banco .db")
    ap.add_argument("-o", "--output", default="cellforensics_out", help="pasta de saída")
    ap.add_argument("--format", default="csv,json,html", help="csv,json,html (padrão: todos)")
    ap.add_argument("--towerdb", help="CSV do OpenCelliD para estimar coordenadas das torres")
    args = ap.parse_args(argv)

    if not os.path.exists(args.input):
        print("entrada não encontrada: %s" % args.input, file=sys.stderr)
        return 2
    records = collect(args.input)
    if args.towerdb:
        n = towerdb.resolve(records, args.towerdb)
        print("coordenadas estimadas via towerdb: %d registros" % n)
    os.makedirs(args.output, exist_ok=True)
    fmts = {f.strip() for f in args.format.split(",")}
    if "csv" in fmts:
        report.write_csv(records, os.path.join(args.output, "cells.csv"))
    if "json" in fmts:
        report.write_json(records, os.path.join(args.output, "cells.json"), args.input)
    if "html" in fmts:
        report.write_html(records, os.path.join(args.output, "report.html"), args.input)
    print("%d registros, %d células distintas -> %s" % (
        len(records), len(report.summarize(records)), args.output))
    if not records:
        print("nenhum artefato reconhecido nesta entrada", file=sys.stderr)
    return 0
