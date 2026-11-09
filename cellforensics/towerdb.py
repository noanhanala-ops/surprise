"""Resolução opcional de coordenadas via CSV do OpenCelliD.

Colunas: radio,mcc,net,area,cell,unit,lon,lat,range,samples,... Resultado é
uma ESTIMATIVA da localização da torre/área de cobertura, não do aparelho.
"""
import csv


def resolve(records, csv_path):
    wanted = {r.cell_key() for r in records if r.lat is None and None not in r.cell_key()}
    found = {}
    with open(csv_path, newline="", encoding="utf-8", errors="replace") as f:
        for row in csv.DictReader(f):
            try:
                k = (int(row["mcc"]), int(row["net"]), int(row["area"]), int(row["cell"]))
            except (KeyError, ValueError):
                continue
            if k in wanted:
                found[k] = (float(row["lat"]), float(row["lon"]), row.get("range"))
    n = 0
    for r in records:
        hit = found.get(r.cell_key())
        if hit and r.lat is None:
            r.lat, r.lon = hit[0], hit[1]
            r.accuracy_m = float(hit[2]) if hit[2] else None
            r.coord_origin = "towerdb"
            r.note = (r.note + "; " if r.note else "") + "posição estimada da torre (OpenCelliD)"
            n += 1
    return n
