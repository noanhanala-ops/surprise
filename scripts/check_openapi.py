#!/usr/bin/env python3
"""Valida docs/api/openapi.yaml: YAML válido, $refs resolvem, operações com summary e responses."""
import os, re, sys, yaml
root = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
path = os.path.join(root, "docs/api/openapi.yaml")
text = open(path, encoding="utf-8").read()
spec = yaml.safe_load(text)
bad = []
for ref in set(re.findall(r"#/components/(\w+)/(\w+)", text)):
    if ref[1] not in spec["components"].get(ref[0], {}):
        bad.append("/".join(ref))
ops = 0
for p, item in spec["paths"].items():
    for m, op in item.items():
        ops += 1
        if "responses" not in op or "summary" not in op:
            bad.append(f"{m.upper()} {p}: falta summary/responses")
print(f"paths={len(spec['paths'])} operations={ops} problemas={bad}")
sys.exit(1 if bad else 0)
