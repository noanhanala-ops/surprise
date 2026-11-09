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


def _acquire_main(argv):
    from . import acquire
    ap = argparse.ArgumentParser(
        prog="cellforensics acquire|monitor",
        description="Coleta somente-leitura de um Android conectado por USB (adb). Exige "
                    "autorização legal/do titular, depuração USB habilitada e confirmação no aparelho.")
    ap.add_argument("mode", choices=["acquire", "monitor"])
    ap.add_argument("-o", "--output", default="coleta", help="pasta de saída")
    ap.add_argument("--serial", help="serial do aparelho (se houver mais de um)")
    ap.add_argument("--case-id", default="", help="identificador do caso")
    ap.add_argument("--examiner", default="", help="nome do examinador")
    ap.add_argument("--no-bugreport", action="store_true", help="pula o bugreport (demorado)")
    ap.add_argument("--no-analyze", action="store_true", help="não gera o relatório ao final")
    ap.add_argument("--interval", type=int, default=30, help="monitor: segundos entre leituras")
    ap.add_argument("--duration", type=int, help="monitor: duração total em segundos")
    args = ap.parse_args(argv)
    try:
        if args.mode == "monitor":
            print("saída:", acquire.monitor(args.output, args.serial, args.interval, args.duration))
            return 0
        meta = acquire.acquire(args.output, args.serial, args.case_id, args.examiner,
                               bugreport=not args.no_bugreport)
    except acquire.AcquireError as e:
        print("erro: %s" % e, file=sys.stderr)
        return 2
    failed = [c["file"] for c in meta["commands"] if c["returncode"] != 0]
    if failed:
        print("atenção: comandos com falha (ver acquisition_log.json): %s" % ", ".join(failed))
    if not args.no_analyze:
        return main([args.output, "-o", os.path.join(args.output, "analise")])
    return 0


def main(argv=None):
    argv = sys.argv[1:] if argv is None else argv
    if argv and argv[0] in ("acquire", "monitor"):
        return _acquire_main(argv)
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
