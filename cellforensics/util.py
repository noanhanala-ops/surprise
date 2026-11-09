import hashlib
import os

_cache = {}


def sha256_file(path):
    if path in _cache:
        return _cache[path]
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    _cache[path] = h.hexdigest()
    return _cache[path]


def walk(root):
    """Itera arquivos de forma determinística (ordem estável para relatórios reprodutíveis)."""
    if os.path.isfile(root):
        yield root
        return
    for dirpath, dirnames, filenames in os.walk(root):
        dirnames.sort()
        for name in sorted(filenames):
            yield os.path.join(dirpath, name)
