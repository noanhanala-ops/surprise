"""Coleta (somente leitura) de artefatos de células de um Android conectado por USB via adb.

Requisitos: aparelho em posse do examinador, com autorização legal/do titular, depuração USB
habilitada e a chave RSA do computador autorizada NO aparelho. Esta ferramenta NÃO contorna
bloqueio de tela, NÃO explora vulnerabilidades e NÃO usa root: apenas executa comandos adb
de leitura. Cada comando, horário, código de saída e hash é registrado em acquisition_log.json.
"""
import csv
import getpass
import hashlib
import json
import os
import platform
import shutil
import subprocess
import sys
import time
from datetime import datetime, timezone

from . import __version__
from .parsers import android as android_parser


class AcquireError(Exception):
    pass


def _now():
    return datetime.now(timezone.utc)


def _adb(serial, *args, timeout=120, to_file=None):
    cmd = ["adb"] + (["-s", serial] if serial else []) + list(args)
    try:
        if to_file:
            with open(to_file, "wb") as f:
                p = subprocess.run(cmd, stdout=f, stderr=subprocess.PIPE, timeout=timeout)
            return p.returncode, b"", p.stderr
        p = subprocess.run(cmd, capture_output=True, timeout=timeout)
        return p.returncode, p.stdout, p.stderr
    except subprocess.TimeoutExpired:
        return 124, b"", b"timeout"


def find_device(serial=None):
    if not shutil.which("adb"):
        raise AcquireError("adb não encontrado no PATH (instale o Android platform-tools).")
    rc, out, err = _adb(None, "devices", "-l", timeout=30)
    if rc != 0:
        raise AcquireError("falha ao executar 'adb devices': %s" % err.decode(errors="replace"))
    found = []
    for line in out.decode(errors="replace").splitlines()[1:]:
        parts = line.split()
        if len(parts) >= 2:
            found.append((parts[0], parts[1]))
    if serial:
        found = [d for d in found if d[0] == serial]
    if not found:
        raise AcquireError("nenhum aparelho encontrado. Verifique cabo e depuração USB.")
    if len(found) > 1:
        raise AcquireError("vários aparelhos conectados; use --serial: %s" % ", ".join(d[0] for d in found))
    sn, state = found[0]
    if state == "unauthorized":
        raise AcquireError("aparelho não autorizou este computador: confirme o aviso de "
                           "depuração USB na tela do aparelho e tente de novo.")
    if state != "device":
        raise AcquireError("estado do aparelho: %s (esperado: device)" % state)
    return sn


def _sha256(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for c in iter(lambda: f.read(1 << 20), b""):
            h.update(c)
    return h.hexdigest()


def _device_time(serial):
    rc, out, _ = _adb(serial, "shell", "date", "-u", "+%Y-%m-%d %H:%M:%S", timeout=30)
    t = out.decode(errors="replace").strip()
    try:
        datetime.strptime(t, "%Y-%m-%d %H:%M:%S")
        return t
    except ValueError:
        return None


def acquire(outdir, serial=None, case_id="", examiner="", bugreport=True, log=print):
    sn = find_device(serial)
    os.makedirs(outdir, exist_ok=True)
    started = _now()
    steps = [
        ("getprop.txt", ["shell", "getprop"], 60),
        ("dumpsys_telephony_registry.txt", ["shell", "dumpsys", "telephony.registry"], 120),
        ("logcat_radio.txt", ["logcat", "-b", "radio", "-d"], 180),
    ]
    commands = []

    def record(name, args, timeout, bug=False):
        path = os.path.join(outdir, name)
        dtime = _device_time(sn)
        t0 = _now()
        log("coletando %s ..." % name)
        if bug:   # 'adb bugreport <arquivo>' grava o zip sozinho
            rc, _, err = _adb(sn, *args, path, timeout=timeout)
        else:
            rc, _, err = _adb(sn, *args, timeout=timeout, to_file=path)
        ok = os.path.exists(path)
        commands.append({
            "file": name, "adb_args": args + ([path] if bug else []), "started_utc": t0.isoformat(),
            "device_time_utc": dtime, "returncode": rc, "stderr": err.decode(errors="replace")[:500],
            "size": os.path.getsize(path) if ok else None, "sha256": _sha256(path) if ok else None})

    for name, args, timeout in steps:
        record(name, args, timeout)
    if bugreport:
        record("bugreport.zip", ["bugreport"], 900, bug=True)

    props = {}
    pp = os.path.join(outdir, "getprop.txt")
    if os.path.exists(pp):
        for line in open(pp, encoding="utf-8", errors="replace"):
            if line.startswith("[") and "]: [" in line:
                k, v = line.strip().split("]: [", 1)
                props[k[1:]] = v.rstrip("]")
    _, adbv, _ = _adb(None, "version", timeout=30)
    meta = {
        "tool": "cellforensics", "version": __version__, "case_id": case_id, "examiner": examiner,
        "operator_account": getpass.getuser(), "host": platform.node(), "host_os": platform.platform(),
        "adb_version": adbv.decode(errors="replace").strip().splitlines()[:1],
        "started_utc": started.isoformat(), "finished_utc": _now().isoformat(),
        "device": {"serial": sn, **{k: props.get(k) for k in (
            "ro.product.manufacturer", "ro.product.model", "ro.build.fingerprint",
            "ro.build.version.release", "ro.build.version.security_patch", "gsm.operator.alpha",
            "gsm.operator.numeric")}},
        "note": "Somente comandos adb de leitura. Sem root, sem contorno de bloqueio.",
        "commands": commands,
    }
    with open(os.path.join(outdir, "acquisition_log.json"), "w", encoding="utf-8") as f:
        json.dump(meta, f, ensure_ascii=False, indent=2)
    return meta


def monitor(outdir, serial=None, interval=30, duration=None, log=print):
    """Registra periodicamente a(s) célula(s) em uso, formando um histórico a partir de agora."""
    sn = find_device(serial)
    os.makedirs(outdir, exist_ok=True)
    path = os.path.join(outdir, "monitor_cells.csv")
    new = not os.path.exists(path)
    last = None
    end = time.time() + duration if duration else None
    with open(path, "a", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        if new:
            w.writerow(["timestamp_utc", "tech", "mcc", "mnc", "area", "cell_id", "pci"])
        try:
            while end is None or time.time() < end:
                rc, out, _ = _adb(sn, "shell", "dumpsys", "telephony.registry", timeout=60)
                now = _now()
                recs = []
                android_parser._parse_lines(out.decode(errors="replace").splitlines(), "live", "",
                                            "monitor", recs, header_dt=now)
                cells = sorted({(r.tech, r.mcc, r.mnc, r.area, r.cell_id, r.pci) for r in recs},
                               key=str)
                if cells != last:
                    for c in cells:
                        w.writerow([now.isoformat()] + ["" if v is None else v for v in c])
                    f.flush()
                    log("%s: %s" % (now.strftime("%H:%M:%S"), cells or "sem célula"))
                    last = cells
                time.sleep(interval)
        except KeyboardInterrupt:
            log("monitoramento encerrado.")
    return path
