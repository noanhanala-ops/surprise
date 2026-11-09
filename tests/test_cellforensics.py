import json
import os
import sqlite3
import tempfile
import unittest

from cellforensics.cli import collect, main

BUGREPORT = """== dumpstate: 2024-03-10 14:30:00
mCellIdentity=CellIdentityLte:{ mCi=12345678 mPci=101 mTac=4000 mEarfcn=1300 mMcc=724 mMnc=10 mAlphaLong=X}
mCellInfo=[CellInfoGsm:{mCellIdentityGsm=CellIdentityGsm:{mLac=2147483647, mCid=555, mMcc=724, mMnc=05}}]
03-09 10:11:12.345  1000  1  D RILJ: CellIdentityLte:{mCi=999, mPci=7, mTac=1, mMcc=724, mMnc=11}
"""


def make_ios_db(path):
    con = sqlite3.connect(path)
    con.execute("CREATE TABLE LteCellLocation (MCC INT, MNC INT, TAC INT, CI INT, PCI INT,"
                " Timestamp REAL, Latitude REAL, Longitude REAL, HorizontalAccuracy REAL)")
    con.execute("INSERT INTO LteCellLocation VALUES (724,10,4000,12345678,101,731000000.0,"
                "-23.55,-46.63,800)")
    con.commit()
    con.close()


class Tests(unittest.TestCase):
    def setUp(self):
        self.d = tempfile.mkdtemp()
        with open(os.path.join(self.d, "bugreport-test.txt"), "w") as f:
            f.write(BUGREPORT)
        make_ios_db(os.path.join(self.d, "cache_encryptedB.db"))

    def test_android(self):
        recs = [r for r in collect(self.d) if r.platform == "android"]
        lte = [r for r in recs if r.cell_id == 12345678][0]
        self.assertEqual((lte.tech, lte.mcc, lte.mnc, lte.area, lte.pci), ("LTE", 724, 10, 4000, 101))
        self.assertTrue(lte.timestamp.startswith("2024-03-10T14:30:00"))
        gsm = [r for r in recs if r.cell_id == 555][0]
        self.assertIsNone(gsm.area)  # INT_MAX tratado como indisponível
        log = [r for r in recs if r.cell_id == 999][0]
        self.assertEqual(log.source_type, "logcat")
        self.assertTrue(log.timestamp.startswith("2024-03-09T10:11:12"))

    def test_ios(self):
        recs = [r for r in collect(self.d) if r.platform == "ios"]
        self.assertEqual(len(recs), 1)
        r = recs[0]
        self.assertEqual((r.tech, r.cell_id, r.lat), ("LTE", 12345678, -23.55))
        self.assertTrue(r.timestamp.startswith("2024-03-"))

    def test_ios_path_with_special_chars(self):
        d = os.path.join(self.d, "ext #1 ?x")
        os.makedirs(d)
        make_ios_db(os.path.join(d, "cache_encryptedB.db"))
        recs = [r for r in collect(d) if r.platform == "ios"]
        self.assertEqual(len(recs), 1)

    def test_cli_outputs(self):
        out = os.path.join(self.d, "out")
        self.assertEqual(main([self.d, "-o", out]), 0)
        for n in ("cells.csv", "cells.json", "report.html"):
            self.assertTrue(os.path.getsize(os.path.join(out, n)) > 0)
        doc = json.load(open(os.path.join(out, "cells.json")))
        self.assertEqual(len(doc["sources"][0]["sha256"]), 64)

    def test_towerdb(self):
        csvp = os.path.join(self.d, "t.csv")
        with open(csvp, "w") as f:
            f.write("radio,mcc,net,area,cell,unit,lon,lat,range\nLTE,724,10,4000,12345678,0,-46.6,-23.5,500\n"
                    "GSM,724,5,1,555,0,-43.1,-22.9,900\n")
        out = os.path.join(self.d, "o2")
        main([os.path.join(self.d, "bugreport-test.txt"), "-o", out, "--towerdb", csvp])
        doc = json.load(open(os.path.join(out, "cells.json")))
        self.assertTrue(any(r["coord_origin"] == "towerdb" for r in doc["records"]))


class AcquireTests(unittest.TestCase):
    def setUp(self):
        self.d = tempfile.mkdtemp()
        bindir = os.path.join(self.d, "bin")
        os.makedirs(bindir)
        os.symlink(os.path.abspath(os.path.join(os.path.dirname(__file__), "fake_adb.py")),
                   os.path.join(bindir, "adb"))
        self._path = os.environ["PATH"]
        os.environ["PATH"] = bindir + os.pathsep + self._path

    def tearDown(self):
        os.environ["PATH"] = self._path

    def test_acquire_and_analyze(self):
        out = os.path.join(self.d, "coleta")
        self.assertEqual(main(["acquire", "-o", out, "--case-id", "C1", "--examiner", "X"]), 0)
        log = json.load(open(os.path.join(out, "acquisition_log.json")))
        self.assertEqual(log["case_id"], "C1")
        self.assertEqual(log["device"]["ro.product.model"], "Pixel 7")
        self.assertTrue(all(c["sha256"] for c in log["commands"]))
        doc = json.load(open(os.path.join(out, "analise", "cells.json")))
        snap = [r for r in doc["records"] if r["cell_id"] == 12345678][0]
        self.assertTrue(snap["timestamp"].startswith("2024-03-10T14:30:00"))
        self.assertTrue(any(r["cell_id"] == 999 and r["source_type"] == "logcat" for r in doc["records"]))

    def test_no_device(self):
        os.environ["PATH"] = self.d  # sem adb
        self.assertEqual(main(["acquire", "-o", os.path.join(self.d, "x")]), 2)

    def test_monitor(self):
        from cellforensics import acquire
        p = acquire.monitor(os.path.join(self.d, "mon"), interval=1, duration=1, log=lambda *_: None)
        rows = open(p).read().strip().splitlines()
        self.assertEqual(len(rows), 2)  # cabeçalho + 1 mudança (leituras iguais não repetem)


if __name__ == "__main__":
    unittest.main()
