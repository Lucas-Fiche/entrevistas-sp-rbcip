/**
 * Exportação de dados para CSV e XLSX — 100% no navegador, sem bibliotecas.
 * O XLSX é montado como um pacote ZIP (Office Open XML) válido, usando
 * armazenamento sem compressão (método "stored").
 *
 * API pública:
 *   Exportador.csv(nomeArquivo, aoa)
 *   Exportador.xlsx(nomeArquivo, nomePlanilha, aoa)
 *   (aoa = array de arrays; a primeira linha é o cabeçalho)
 */
(function () {
  "use strict";

  var enc = new TextEncoder();

  // ---------- CRC32 (necessário para o ZIP) ----------
  var CRC_TABLE = (function () {
    var t = new Uint32Array(256);
    for (var n = 0; n < 256; n++) {
      var c = n;
      for (var k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      t[n] = c >>> 0;
    }
    return t;
  })();
  function crc32(bytes) {
    var c = 0xffffffff;
    for (var i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  }

  function concat(arrays) {
    var len = arrays.reduce(function (s, a) { return s + a.length; }, 0);
    var out = new Uint8Array(len);
    var p = 0;
    arrays.forEach(function (a) { out.set(a, p); p += a.length; });
    return out;
  }

  // ---------- Escritor de ZIP (stored) ----------
  function zip(files) {
    function pushLE(arr, val, n) { for (var i = 0; i < n; i++) arr.push((val >>> (8 * i)) & 0xff); }
    var locais = [];
    var central = [];
    var offset = 0;

    files.forEach(function (f) {
      var crc = crc32(f.bytes);
      var size = f.bytes.length;
      var nome = enc.encode(f.name);

      var lh = [];
      pushLE(lh, 0x04034b50, 4); pushLE(lh, 20, 2); pushLE(lh, 0, 2); pushLE(lh, 0, 2);
      pushLE(lh, 0, 2); pushLE(lh, 0, 2);
      pushLE(lh, crc, 4); pushLE(lh, size, 4); pushLE(lh, size, 4);
      pushLE(lh, nome.length, 2); pushLE(lh, 0, 2);
      var lhArr = Uint8Array.from(lh);
      locais.push(lhArr, nome, f.bytes);

      var cd = [];
      pushLE(cd, 0x02014b50, 4); pushLE(cd, 20, 2); pushLE(cd, 20, 2); pushLE(cd, 0, 2); pushLE(cd, 0, 2);
      pushLE(cd, 0, 2); pushLE(cd, 0, 2);
      pushLE(cd, crc, 4); pushLE(cd, size, 4); pushLE(cd, size, 4);
      pushLE(cd, nome.length, 2); pushLE(cd, 0, 2); pushLE(cd, 0, 2); pushLE(cd, 0, 2); pushLE(cd, 0, 2);
      pushLE(cd, 0, 4); pushLE(cd, offset, 4);
      central.push(Uint8Array.from(cd), nome);

      offset += lhArr.length + nome.length + f.bytes.length;
    });

    var centralBytes = concat(central);
    var eocd = [];
    pushLE(eocd, 0x06054b50, 4); pushLE(eocd, 0, 2); pushLE(eocd, 0, 2);
    pushLE(eocd, files.length, 2); pushLE(eocd, files.length, 2);
    pushLE(eocd, centralBytes.length, 4); pushLE(eocd, offset, 4); pushLE(eocd, 0, 2);

    return concat(locais.concat([centralBytes, Uint8Array.from(eocd)]));
  }

  // ---------- XLSX ----------
  function escXml(s) {
    return String(s)
      .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  }
  function refColuna(ci) {
    var s = "";
    ci++;
    while (ci > 0) { var m = (ci - 1) % 26; s = String.fromCharCode(65 + m) + s; ci = Math.floor((ci - 1) / 26); }
    return s;
  }

  function xlsxBytes(aoa, nomePlanilha) {
    var linhasXml = "";
    aoa.forEach(function (row, ri) {
      var cells = "";
      row.forEach(function (val, ci) {
        var ref = refColuna(ci) + (ri + 1);
        if (typeof val === "number" && isFinite(val)) {
          cells += '<c r="' + ref + '"><v>' + val + "</v></c>";
        } else {
          cells += '<c r="' + ref + '" t="inlineStr"><is><t xml:space="preserve">' + escXml(val == null ? "" : val) + "</t></is></c>";
        }
      });
      linhasXml += '<row r="' + (ri + 1) + '">' + cells + "</row>";
    });

    var sheet =
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>' +
      linhasXml + "</sheetData></worksheet>";
    var workbook =
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
      '<sheets><sheet name="' + escXml(nomePlanilha || "Planilha1") + '" sheetId="1" r:id="rId1"/></sheets></workbook>';
    var wbRels =
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>';
    var rels =
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>';
    var contentTypes =
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
      '<Default Extension="xml" ContentType="application/xml"/>' +
      '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
      '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>' +
      "</Types>";

    return zip([
      { name: "[Content_Types].xml", bytes: enc.encode(contentTypes) },
      { name: "_rels/.rels", bytes: enc.encode(rels) },
      { name: "xl/workbook.xml", bytes: enc.encode(workbook) },
      { name: "xl/_rels/workbook.xml.rels", bytes: enc.encode(wbRels) },
      { name: "xl/worksheets/sheet1.xml", bytes: enc.encode(sheet) },
    ]);
  }

  // ---------- CSV ----------
  function csvText(aoa) {
    var sep = ";"; // ponto e vírgula: melhor compatibilidade com Excel pt-BR
    function celula(v) {
      if (v == null) v = "";
      v = String(v);
      if (/[";\n\r]/.test(v)) v = '"' + v.replace(/"/g, '""') + '"';
      return v;
    }
    return "﻿" + aoa.map(function (row) { return row.map(celula).join(sep); }).join("\r\n");
  }

  // ---------- Download ----------
  function baixar(nome, conteudo, mime) {
    var blob = new Blob([conteudo], { type: mime });
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url;
    a.download = nome;
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { document.body.removeChild(a); URL.revokeObjectURL(url); }, 0);
  }

  window.Exportador = {
    csv: function (nome, aoa) {
      baixar(nome, csvText(aoa), "text/csv;charset=utf-8");
    },
    xlsx: function (nome, nomePlanilha, aoa) {
      baixar(nome, xlsxBytes(aoa, nomePlanilha), "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    },
  };
})();
