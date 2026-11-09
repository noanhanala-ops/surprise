from dataclasses import dataclass, asdict
from typing import Optional

INT_UNAVAILABLE = {2147483647, 0x7FFFFFFF, 9223372036854775807, -1}


@dataclass
class CellRecord:
    platform: str                    # android | ios
    source_type: str                 # ex.: dumpsys, logcat, ios_locationd
    source_file: str                 # caminho relativo dentro da extração
    source_sha256: str               # hash do arquivo de origem
    tech: str = ""                   # GSM, WCDMA, LTE, NR, CDMA
    mcc: Optional[int] = None
    mnc: Optional[int] = None
    area: Optional[int] = None       # LAC (2G/3G) ou TAC (4G/5G)
    cell_id: Optional[int] = None    # CID / ECI / NCI
    pci: Optional[int] = None        # PCI/PSC
    timestamp: Optional[str] = None  # ISO 8601 UTC quando conhecido
    timestamp_note: str = ""         # ex.: "snapshot do bugreport", "sem ano"
    lat: Optional[float] = None
    lon: Optional[float] = None
    accuracy_m: Optional[float] = None
    coord_origin: str = ""           # device_cache | towerdb | ""
    note: str = ""

    def key(self):
        return (self.tech, self.mcc, self.mnc, self.area, self.cell_id, self.timestamp)

    def cell_key(self):
        return (self.mcc, self.mnc, self.area, self.cell_id)

    def to_dict(self):
        return asdict(self)


def clean_int(value):
    """Converte para int tratando valores 'indisponível' do Android (INT_MAX)."""
    if value is None:
        return None
    try:
        n = int(str(value).strip())
    except ValueError:
        return None
    return None if n in INT_UNAVAILABLE else n
