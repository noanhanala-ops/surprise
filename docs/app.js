(function () {
  "use strict";
  const $ = id => document.getElementById(id);
  let SQL = null, files = [], records = [], towerFile = null;

  const sqlReady = initSqlJs({ locateFile: f => "vendor/" + f }).then(s => { SQL = s; }).catch(() => {
    $("status").textContent = "Aviso: não foi possível carregar o leitor SQLite; arquivos iOS (.db) não serão lidos.";
  });

  function addFiles(list) {
    for (const f of list) {
      files.push({ path: f.path || f.webkitRelativePath || f.name, file: f.file || f });
    }
    $("count").textContent = files.length + " arquivo(s) selecionado(s)";
    $("run").disabled = files.length === 0;
  }

  async function walkEntry(entry, prefix, acc) {
    if (entry.isFile) {
      await new Promise(res => entry.file(file => { acc.push({ path: prefix + entry.name, file }); res(); }, res));
    } else if (entry.isDirectory) {
      const reader = entry.createReader();
      for (;;) {
        const batch = await new Promise(res => reader.readEntries(res, () => res([])));
        if (!batch.length) break;
        for (const child of batch) await walkEntry(child, prefix + entry.name + "/", acc);
      }
    }
  }

  const drop = $("drop");
  drop.addEventListener("dragover", ev => { ev.preventDefault(); drop.classList.add("over"); });
  drop.addEventListener("dragleave", () => drop.classList.remove("over"));
  drop.addEventListener("drop", async ev => {
    ev.preventDefault(); drop.classList.remove("over");
    const acc = [];
    const items = ev.dataTransfer.items ? Array.from(ev.dataTransfer.items) : [];
    const entries = items.map(i => i.webkitGetAsEntry && i.webkitGetAsEntry()).filter(Boolean);
    if (entries.length) for (const en of entries) await walkEntry(en, "", acc);
    else for (const f of ev.dataTransfer.files) acc.push({ path: f.name, file: f });
    addFiles(acc);
  });
  $("pickFiles").addEventListener("change", ev => addFiles(Array.from(ev.target.files)));
  $("pickDir").addEventListener("change", ev => addFiles(Array.from(ev.target.files)));
  $("towerdb").addEventListener("change", ev => { towerFile = ev.target.files[0] || null; });
  $("clear").addEventListener("click", () => {
    files = []; records = []; towerFile = null;
    $("count").textContent = ""; $("run").disabled = true; $("results").hidden = true; $("status").textContent = "";
  });

  function download(name, text, type) {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([text], { type }));
    a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  }

  $("run").addEventListener("click", async () => {
    $("run").disabled = true;
    $("status").textContent = "Processando…";
    await sqlReady;
    const errors = [];
    records = await CF.collect(files, SQL, (i, n, p, err) => {
      if (err) errors.push(p + ": " + err.message);
      else $("status").textContent = "Processando " + i + "/" + n + ": " + p;
    });
    if (towerFile) {
      const n = await CF.resolveTowers(records, towerFile);
      $("status").textContent = "Coordenadas estimadas via base de torres: " + n + " registros.";
    }
    const cells = CF.summarize(records);
    $("status").textContent = records.length + " registro(s), " + cells.length + " célula(s) distinta(s)." +
      (errors.length ? " Falhas em " + errors.length + " arquivo(s): " + errors.slice(0, 3).join("; ") : "") +
      (records.length ? "" : " Nenhum artefato reconhecido.");
    const tb = $("cells").querySelector("tbody");
    tb.textContent = "";
    for (const c of cells) {
      const tr = document.createElement("tr");
      [c.tech, c.mcc + "-" + c.mnc, c.area, c.cell_id, c.first_seen || "—", c.last_seen || "—", c.count]
        .forEach(v => { const td = document.createElement("td"); td.textContent = v === null ? "—" : v; tr.appendChild(td); });
      tb.appendChild(tr);
    }
    $("results").hidden = records.length === 0;
    $("run").disabled = false;
  });

  const label = () => files.length + " arquivo(s) selecionado(s) no navegador";
  $("dlCsv").addEventListener("click", () => download("cells.csv", CF.toCsv(records), "text/csv"));
  $("dlJson").addEventListener("click", () => download("cells.json", CF.toJson(records, label()), "application/json"));
  $("dlHtml").addEventListener("click", () => download("report.html", CF.toHtml(records, label()), "text/html"));
})();
