const assert = require("assert");
const zlib = require("zlib");
const initSqlJs = require("../../docs/vendor/sql-wasm.js");
const CF = require("../../docs/cellforensics.js");

const BUGREPORT = `== dumpstate: 2024-03-10 14:30:00
mCellIdentity=CellIdentityLte:{ mCi=12345678 mPci=101 mTac=4000 mEarfcn=1300 mMcc=724 mMnc=10 mAlphaLong=X}
mCellInfo=[CellInfoGsm:{mCellIdentityGsm=CellIdentityGsm:{mLac=2147483647, mCid=555, mMcc=724, mMnc=05}}]
03-09 10:11:12.345  1000  1  D RILJ: CellIdentityLte:{mCi=999, mPci=7, mTac=1, mMcc=724, mMnc=11}
`;

function zipOf(name, content, deflate) {
  const data = Buffer.from(content);
  const comp = deflate ? zlib.deflateRawSync(data) : data;
  const nm = Buffer.from(name);
  const lh = Buffer.alloc(30); lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(deflate ? 8 : 0, 8);
  lh.writeUInt32LE(comp.length, 18); lh.writeUInt32LE(data.length, 22); lh.writeUInt16LE(nm.length, 26);
  const local = Buffer.concat([lh, nm, comp]);
  const cd = Buffer.alloc(46); cd.writeUInt32LE(0x02014b50, 0); cd.writeUInt16LE(deflate ? 8 : 0, 10);
  cd.writeUInt32LE(comp.length, 20); cd.writeUInt32LE(data.length, 24); cd.writeUInt16LE(nm.length, 28);
  cd.writeUInt32LE(0, 42);
  const cdFull = Buffer.concat([cd, nm]);
  const eocd = Buffer.alloc(22); eocd.writeUInt32LE(0x06054b50, 0); eocd.writeUInt16LE(1, 8); eocd.writeUInt16LE(1, 10);
  eocd.writeUInt32LE(cdFull.length, 12); eocd.writeUInt32LE(local.length, 16);
  return Buffer.concat([local, cdFull, eocd]);
}

(async () => {
  const SQL = await initSqlJs();
  const db = new SQL.Database();
  db.run("CREATE TABLE LteCellLocation (MCC INT, MNC INT, TAC INT, CI INT, PCI INT, Timestamp REAL, Latitude REAL, Longitude REAL, HorizontalAccuracy REAL)");
  db.run("INSERT INTO LteCellLocation VALUES (724,10,4000,12345678,101,731000000.0,-23.55,-46.63,800)");
  const dbBytes = db.export(); db.close();

  const files = [
    { path: "x/bugreport-test.txt", file: new Blob([BUGREPORT]) },
    { path: "x/ext #1/cache_encryptedB.db", file: new Blob([dbBytes]) },
    { path: "x/br.zip", file: new Blob([zipOf("bugreport-z.txt", BUGREPORT, true)]) },
    { path: "x/ignored.bin", file: new Blob(["CellIdentityLte:{mCi=1}"]) },
  ];
  const recs = await CF.collect(files, SQL);

  const lte = recs.find(r => r.platform === "android" && r.cell_id === 12345678 && r.source_file === "x/bugreport-test.txt");
  assert.deepStrictEqual([lte.tech, lte.mcc, lte.mnc, lte.area, lte.pci], ["LTE", 724, 10, 4000, 101]);
  assert.ok(lte.timestamp.startsWith("2024-03-10T14:30:00"));
  assert.strictEqual(recs.find(r => r.cell_id === 555).area, null);
  const log = recs.find(r => r.cell_id === 999 && r.source_file === "x/bugreport-test.txt");
  assert.strictEqual(log.source_type, "logcat");
  assert.ok(log.timestamp.startsWith("2024-03-09T10:11:12"));
  assert.ok(recs.some(r => r.source_file === "x/br.zip!bugreport-z.txt" && r.cell_id === 12345678), "zip deflate");
  const ios = recs.filter(r => r.platform === "ios");
  assert.strictEqual(ios.length, 1);
  assert.deepStrictEqual([ios[0].tech, ios[0].cell_id, ios[0].lat], ["LTE", 12345678, -23.55]);
  assert.ok(ios[0].timestamp.startsWith("2024-03-"));
  assert.ok(!recs.some(r => r.source_file.includes("ignored")));
  assert.strictEqual(recs[0].source_sha256.length, 64);

  const tower = new Blob(["radio,mcc,net,area,cell,unit,lon,lat,range\nLTE,724,10,4000,12345678,0,-46.6,-23.5,500\n"]);
  const n = await CF.resolveTowers(recs, tower);
  assert.ok(n >= 1 && recs.some(r => r.coord_origin === "towerdb"));

  assert.ok(CF.toCsv(recs).split("\r\n")[0].startsWith("timestamp,"));
  assert.ok(JSON.parse(CF.toJson(recs, "t")).cells.length >= 3);
  assert.ok(CF.toHtml(recs, "<t>").includes("&lt;t&gt;"));
  console.log("ok:", recs.length, "registros");
})().catch(e => { console.error(e); process.exit(1); });
