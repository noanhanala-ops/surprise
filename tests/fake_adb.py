#!/usr/bin/env python3
"""adb falso para testes: simula um aparelho autorizado."""
import sys
a = sys.argv[1:]
if a[:2] == ["-s", "ABC123"]:
    a = a[2:]
if a[0] == "devices":
    print("List of devices attached\nABC123\tdevice product:x model:Pixel")
elif a[0] == "version":
    print("Android Debug Bridge version 1.0.41")
elif a[:2] == ["shell", "date"]:
    print("2024-03-10 14:30:00")
elif a[:2] == ["shell", "getprop"]:
    print("[ro.product.model]: [Pixel 7]\n[ro.build.version.release]: [14]")
elif a[:3] == ["shell", "dumpsys", "telephony.registry"]:
    print("mCellIdentity=CellIdentityLte:{ mCi=12345678 mPci=101 mTac=4000 mMcc=724 mMnc=10}")
elif a[:3] == ["logcat", "-b", "radio"]:
    print("03-09 10:11:12.345  1000  1  D RILJ: CellIdentityLte:{mCi=999, mPci=7, mTac=1, mMcc=724, mMnc=11}")
elif a[0] == "bugreport":
    open(a[1], "wb").write(b"PK\x05\x06" + b"\0" * 18)
else:
    sys.exit(1)
