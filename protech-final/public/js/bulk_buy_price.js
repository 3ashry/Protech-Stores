const PRICE_UPDATE_LIST = [["PBCA16008", 466.0], ["PBCA16008L", 525.0], ["TABLI203235", 1700.0], ["TABLI20682", 1959.0], ["TABLI20781", 1011.0], ["TAC02271", 194.0], ["TAC061801", 195.0], ["TAC101203", 50.0], ["TAC11204001", 40.0], ["TAC1200014", 11.75], ["TAC1200024", 12.3], ["TAC1200034", 15.5], ["TAC1200154", 12.0], ["TAC1200354", 13.75], ["TAC1200404", 14.75], ["TAC1200454", 17.4], ["TAC1200504", 19.3], ["TAC1200554", 21.7], ["TAC1200704", 33.0], ["TAC1200904", 49.5], ["TAC1200954", 56.0], ["TAC1201104", 71.0], ["TAC1201204", 78.0], ["TAC1201404", 120.0], ["TAC1521182", 137.0], ["TAC15333011", 268.0], ["TAC15333012", 268.0], ["TAC16HL133", 125.0], ["TAC16PH233", 128.0], ["TAC180251", 84.07], ["TAC180351", 138.0], ["TAC2111253", 78.0], ["TAC2111803", 172.0], ["TAC211201", 48.0], ["TAC2144052", 4590.0], ["TAC2151801", 260.0], ["TAC2152301", 380.0], ["TAC2161802", 45.0], ["TAC2164051", 4770.0], ["TAC2211801", 42.5], ["TAC2212301", 57.0], ["TAC2231801", 63.0], ["TAC2232301", 93.0], ["TAC231522", 264.0], ["TAC2316252", 385.95], ["TAC2331403", 290.0], ["TAC260610", 29.0], ["TAC260812", 40.0], ["TAC261012", 61.0], ["TAC261215", 70.0], ["TAC261415", 89.0], ["TAC271331", 119.5], ["TAC310501", 36.0], ["TAC310601", 37.0], ["TAC310602", 42.5], ["TAC310801", 38.0], ["TAC310802", 41.5], ["TAC310805", 79.0], ["TAC311002", 46.0], ["TAC311003C", 61.0], ["TAC311202", 57.0], ["TAC311202C", 62.0], ["TAC311204", 83.0], ["TAC311604", 113.0], ["TAC311803", 175.0], ["TAC312003", 153.7], ["TAC312404", 182.0], ["TAC331120", 284.0], ["TAC4513201", 178.0], ["TAC451601", 248.0], ["TAC52644D", 42.0], ["TAC52922EF", 115.0], ["TAC918151", 1.25], ["TAC918251", 140.0], ["TAC918301", 128.0], ["TAC918401", 189.75], ["TACB0701", 520.0], ["TACG211212", 149.0], ["TACIM16HL133", 123.0], ["TACIM16PH263", 325.0], ["TACIM71PH2150", 36.0], ["TACIM72HL665", 29.5], ["TACIM72PH265", 29.0], ["TACLI2012", 1485.0], ["TACSD18306", 255.0], ["TACSD30306", 195.0], ["TACSD3091", 83.0], ["TACSDL11306", 430.0], ["TACSDL11806", 350.0], ["TACSE0056", 148.0], ["TACSE0061", 160.0], ["TAGLI207625", 2050.0], ["TAGLI2120272", 4130.0], ["TAGLI261521", 1901.0], ["TAGLI4108112", 3106.0], ["TAGLI76012", 1685.0], ["TAKMG2012", 97.0], ["TAKMG5031", 104.0], ["TAKMG6020", 110.0], ["TAKMG7072", 140.0], ["TAKMG8081", 160.0], ["TAPLI1676", 2190.0], ["TAPLI20151", 4107.91], ["TAPLI20181", 3374.0], ["TAPLI42181", 4080.0], ["TAT3031", 85.0], ["TAT40111", 8100.0], ["TAT83301", 799.0], ["TATK053", 835.0], ["TB20078", 653.0], ["TB8036", 1263.0], ["TBC2201", 5700.0], ["TBG15015", 1157.0], ["TBLI20085", 2999.0], ["TCBNLI2008", 3999.0], ["TCBNLI3508", 4199.75], ["TCBNLI5008", 6139.0], ["TCKLI20256", 4369.0], ["TCKLI202598", 7150.0], ["TCKLI20273", 4485.0], ["TCKLI20286", 3422.0], ["TCKLI20358", 5337.0], ["TCLI2034", 905.0], ["TCNLI9008", 11580.0], ["TCSNLI6008", 6420.0], ["TCSPA081", 26.0], ["TCSPA111", 38.12], ["TCSPA241", 114.35], ["TCSPA271", 159.0], ["TCSPA301", 196.35], ["TCSPA321", 219.45], ["TCSPAR171", 105.0], ["TCSPAR191", 118.22], ["TD45658", 648.0], ["TD55108", 727.0], ["TD551082", 727.0], ["TDBLI203582", 5790.0], ["TDDM38001", 12405.0], ["TDLI122061", 720.0], ["TDLI12456", 547.0], ["TDLI206681", 895.0], ["TDLI206686", 3713.0], ["TDP133501", 3390.0], ["TDP207505", 12299.0], ["TDSLI2042006", 2100.0], ["TDSLI204281", 2450.0], ["TDWS10508", 2273.0], ["TESA3301", 1300.0], ["TET1606", 305.0], ["TET160923", 1451.0], ["TET360732", 353.0], ["TETGA031", 1650.0], ["TETHT01", 1310.0], ["TETWM01", 999.0], ["TFBCLI20285", 4800.0], ["TFBCPK1012", 1260.0], ["TFBCPK2212", 1358.0], ["TFBCPM20221", 2350.0], ["TFBLI1620", 410.0], ["TFBLI42201", 870.0], ["TFCLI20411", 610.0], ["TFCLI2064", 1290.0], ["TFCLI42021", 590.0], ["TG10711556", 1105.0], ["TG10711576", 853.0], ["TG1071366", 795.0], ["TG10911576", 955.0], ["TG10912556", 1064.0], ["TG1091366", 1029.0], ["TG11012556", 1295.0], ["TG110125565", 1506.0], ["TG12223026", 2369.0], ["TG1252306", 3050.0], ["TG1262306", 3455.0], ["TG211166", 2399.0], ["TG513326", 816.0], ["TG5133261", 1258.0], ["TG5451811", 3999.0], ["TG5502011", 4339.0], ["TG5622611", 6300.0], ["TGGLI1201", 299.0], ["TGSLI201262", 4890.0], ["TGT11176", 10400.0], ["TGT113026", 2058.0], ["TGT612131", 2594.3], ["TGTSB51201", 353.93], ["TGTSB51603", 340.0], ["TGTSB51801", 415.0], ["TGTSC51201", 334.13], ["TGTSC51603", 317.63], ["TGTSC51801", 440.0], ["TGTSL8200", 80.0], ["TGTST0206", 110.0], ["TH110266", 2211.0], ["TH1153216", 3299.0], ["TH118366", 3614.0], ["TH2130016", 3211.0], ["TH215456", 6390.0], ["TH217068", 5673.0], ["THCH61008D", 95.0], ["THCH61016", 128.0], ["THCT070", 1512.0], ["THDIS12102L", 77.0], ["THDIS12122L", 77.0], ["THDIS12132L", 77.0], ["THDIS12142L", 77.0], ["THDIS12172L", 88.0], ["THDIS12192L", 88.0], ["THDIS12212L", 88.0], ["THDIS12222L", 99.0], ["THDIS12242L", 105.0], ["THHCS63402", 45.0], ["THISTD12141", 625.0], ["THKISD34082L", 1600.0], ["THKISPA0603", 1000.0], ["THKPT0201", 380.0], ["THKTHP22166", 4999.0], ["THKTHP41667", 2446.0], ["THKTHP41728", 7211.0], ["THKTHP90076", 351.0], ["THKTHP90097", 590.0], ["THMH621500", 248.0], ["THMH62200", 78.0], ["THMH622000", 289.5], ["THMH62500", 119.0], ["THPS3308", 200.0], ["THPS63022", 103.0], ["THPTCS73281", 26301.0], ["THPTCS73561", 24211.0], ["THPTCS83962", 29474.0], ["THPTCS84362", 35458.0], ["THRB8702", 171.0], ["THRRTB2712", 1343.0], ["THSPS12166", 44.0], ["THSTH61500", 236.0], ["THT0601", 149.0], ["THT1010103", 141.0], ["THT1010123", 192.0], ["THT101083", 101.0], ["THT101086", 168.0], ["THT101126", 310.0], ["THT102286", 288.0], ["THT106146", 127.0], ["THT106191", 105.0], ["THT106392", 132.0], ["THT109022", 448.0], ["THT109042", 564.0], ["THT109062", 669.0], ["THT109202", 1526.0], ["THT109302", 3415.0], ["THT11051", 155.0], ["THT110606P", 80.0], ["THT11101", 235.0], ["THT11151", 380.0], ["THT113126", 242.0], ["THT113186", 344.0], ["THT113246", 465.0], ["THT113366", 805.0], ["THT113426", 1210.0], ["THT118871", 111.0], ["THT12001", 2687.0], ["THT121251", 1699.0], ["THT123146", 315.98], ["THT13342", 21.35], ["THT1346802", 469.0], ["THT1346803", 585.0], ["THT141462", 735.0], ["THT1516001", 315.0], ["THT15246", 279.0], ["THT1611", 1820.0], ["THT171006", 146.0], ["THT171186", 317.0], ["THT171246", 465.0], ["THT20115", 285.0], ["THT210706", 132.0], ["THT220606S", 125.0], ["THT230512", 85.0], ["THT230606", 116.0], ["THT230612", 89.5], ["THT250216", 36.0], ["THT250226", 38.0], ["THT250826", 130.0], ["THT260606", 153.0], ["THT290801", 126.5], ["THT291908", 20.75], ["THT39102", 26.0], ["THT421802", 2300.0], ["THT431362", 395.0], ["THT511815", 35.0], ["THT5136288", 215.0], ["THT524101", 173.0], ["THT524121", 205.0], ["THT576002", 1200.0], ["THT576003B", 260.0], ["THT661301", 91.0], ["THT666301", 180.0], ["THT66L12", 970.0], ["THT91486", 80.85], ["THT918326", 230.0], ["THT918516", 435.0], ["THT952316", 35.0], ["THTC510706", 185.0], ["THTC560806", 262.0], ["THTGP336", 270.0], ["THTK591282", 216.0], ["THTMF386", 189.0], ["THTMN256", 59.0], ["THTMN356", 61.0], ["THTMN656", 62.0], ["THTMN756", 65.0], ["THTRS2101", 380.0], ["THTS41001", 343.0], ["THTST12173L", 53.0], ["THTWB61001", 724.0], ["THWB61201", 2200.0], ["TIDLI201368", 5910.0], ["TIDLI201455", 800.0], ["TIDLI201668", 5811.0], ["TIDLI205581", 899.0], ["TIDLI206681", 1000.0], ["TIDLI208688", 3156.0], ["TIDLI426981", 2106.0], ["TIDLI429982", 3685.0], ["TIUCC01", 22.0], ["TIWLI20105", 6860.0], ["TIWLI20135", 8948.0], ["TIWLI20236", 2948.0], ["TIWLI20455", 1885.0], ["TIWLI42461", 2980.0], ["TKSDS0226", 73.0], ["TL7508226", 1875.0], ["TLL301201", 4166.0], ["TLL306502", 2548.0], ["TLL306505", 3375.0], ["TLLT01152", 780.0], ["TLMLI20186", 13416.0], ["TLT6001", 1616.0], ["TMSLI20212", 5820.0], ["TMT126101", 165.0], ["TMT19945", 831.0], ["TMT210016", 195.0], ["TMT24036", 81.0], ["TMT26036", 108.0], ["TMT34316", 34.0], ["TMT34519", 60.0], ["TMT34825", 106.0], ["TMT51036", 1280.0], ["TMT510369", 1079.0], ["TMT5310002", 910.0], ["TMT5310004", 1075.0], ["TMT5360011", 265.0], ["TMXLI2001", 2763.2], ["TMXLI20162", 4850.0], ["TOPLI2001", 1345.67], ["TOS230912", 1100.0], ["TOSLI230705", 3927.36], ["TOSLI250382", 4700.0], ["TOSLI251296", 2210.0], ["TOSLL0502", 1968.0], ["TP1016", 35900.0], ["TP135006E", 16838.0], ["TP155001", 24707.0], ["TP165006", 28500.0], ["TP175006", 29900.0], ["TP3206", 6500.0], ["TP3306", 6947.0], ["TP630", 8990.0], ["TP7060", 16979.55], ["TPBX1121", 116.0], ["TPVP1382", 2990.0], ["TPVP1452", 3357.75], ["TPWLI2036", 1191.0], ["TR111226", 3200.0], ["TRHLI202689", 5178.0], ["TRHLI20286", 2999.0], ["TRHLI20288", 3299.0], ["TRHLI422482", 4650.0], ["TRHLI422882", 4948.0], ["TRLF4415", 980.0], ["TS223558", 3364.0], ["TSDLI0442", 422.0], ["TSGLI2004", 1051.0], ["TSGLI200414", 2550.0], ["TSLI1402", 1799.0], ["TSLI4218511", 3999.0], ["TSSLI203083", 3473.0], ["TSTLI2040386", 12999.0], ["TT401116", 314.0], ["TT45061", 979.0], ["TTVLI20018", 2053.0], ["TTVLI2010", 1076.0], ["TTVT16025", 470.0], ["TVCAIHP03", 510.0], ["TW213059", 2648.0], ["TW216059", 3316.0], ["TW225069", 6179.0], ["TWLC1256", 4475.0], ["TWLI043006", 577.0], ["TWP137026", 1212.0], ["TWP93706", 2050.0], ["TWPS102", 711.0], ["TWS10501", 3916.0], ["TWTLI20182", 2416.0], ["WAAC501", 830.0], ["WAAM572", 1280.0], ["WAC1361", 9.45], ["WAC1392", 39.0], ["WAC1393", 37.0], ["WAC3314", 79.25], ["WAG852401", 2300.0], ["WAL1A12", 5150.0], ["WAT1512", 1765.0], ["WAT3512", 1023.0], ["WBP1102", 95.0], ["WBY1A151", 1475.0], ["WCDP521", 1587.58], ["WCDP522", 2091.85], ["WCDS540", 989.0], ["WCE2402", 75.0], ["WCE7402", 138.0], ["WCG3109", 61.25], ["WCJ1501", 66.25], ["WCJ2501", 98.0], ["WCP4306", 88.0], ["WCP4312", 104.54], ["WCP4318", 117.48], ["WCP4324", 132.33], ["WCP4386", 64.25], ["WCP5376", 22.45], ["WCT1606", 69.5], ["WCT1608", 89.5], ["WCV4415", 430.8], ["WDC1K04", 125.0], ["WEB1520", 1409.29], ["WEH1A03", 119.0], ["WEH1A06", 159.48], ["WEH1A08", 168.0], ["WEL5606", 220.0], ["WETH1A02", 9105.2], ["WFCT552", 87.0], ["WFE1658", 52.5], ["WGA3575", 225.62], ["WGM3A18", 8284.0], ["WGP2A03", 79.77], ["WGP3A04", 123.0], ["WGZ1204", 237.5], ["WHD1201", 22.5], ["WHD1206", 25.9], ["WHD1207", 28.7], ["WHD1208", 31.32], ["WHJ1D10", 7540.75], ["WHJ3502", 728.9], ["WHP1A11", 1999.01], ["WHP1A12", 2999.73], ["WHP3A10", 2780.0], ["WHP3A12", 1940.58], ["WHQ1A10", 10999.0], ["WHQ2A20", 21963.0], ["WJC1520", 1099.0], ["WJG1401", 79.75], ["WJH1418", 376.0], ["WJSQ1168", 6680.0], ["WKJ14152", 395.5], ["WKJ1451", 127.25], ["WKJ1457", 140.5], ["WKR1G25", 78.0], ["WLE2M12", 4414.4], ["WLE8M12", 4730.5], ["WLS1565", 1620.0], ["WLWP5631", 2899.0], ["WLYP5181", 1988.0], ["WLYP546", 2149.75], ["WMB4506", 65.0], ["WMJ1K12", 34.61], ["WMQ2512", 44.0], ["WMS3201", 195.25], ["WMS8230", 226.25], ["WMUP5021", 1620.0], ["WNH1R30", 12169.0], ["WNY1440", 81.25], ["WNY2440", 80.6], ["WPDL440", 99.25], ["WPL0C05", 232.5], ["WPL6C08", 75.0], ["WPM2A060", 15472.0], ["WPN1023", 9.76], ["WPT2303", 37.75], ["WPT2306", 45.75], ["WQD1665", 61.32], ["WQE15801", 3660.0], ["WQF2A16", 29279.0], ["WRY1D131", 806.19], ["WRYP1504", 882.17], ["WSC1210", 21.0], ["WSC1227", 49.56], ["WSC1232", 66.33], ["WSH1303", 76.0], ["WSJ1K04", 32.5], ["WSN1E15", 201.9], ["WSN1E17", 262.8], ["WSV7K01", 78.25], ["WSWD081", 6021.0], ["WTC2K01", 249.0], ["WTG3116", 206.49], ["WTH1113", 44.14], ["WTH1117", 56.07], ["WTH1119", 52.5], ["WTH1E12", 71.01], ["WTH3119", 127.08], ["WTN1001", 150.0], ["WUB1501", 23.0], ["WWF1K16", 35.75], ["WWF1K25", 44.25], ["WWF1K30", 50.75], ["WWF1K32", 50.75], ["WWF1K35", 54.5], ["WWPCA03", 2350.0], ["WXC1A02", 11980.25], ["WXD12001", 3409.14], ["WXK1502", 199.0], ["WXN1536", 159.25], ["WXY1004", 999.0], ["WXZ2008", 120.0], ["WZY1418", 395.0]];

// ═══════════════════════════════════════════════════════════════════
//  BULK BUY-PRICE IMPORT (one-off — El Ashry TOTAL & WADFOW 07/15 list)
//
//  Preview → Apply. For each PDF code that matches an existing product:
//     buy_price := round(v21 * 0.95, 2)
//  Only products whose buy_price actually changes are PATCHed. Unmatched
//  PDF codes and DB products missing from the PDF are reported so you
//  can decide manually.
// ═══════════════════════════════════════════════════════════════════

function _openBuyPricePreview() {
  const dbByCode = new Map();
  for (const p of (cache.products || [])) {
    const k = String(p.code || '').toUpperCase().trim();
    if (k) dbByCode.set(k, p);
  }
  const dbCodes = new Set(dbByCode.keys());
  const pdfCodes = new Set();

  const changes = [];         // {product, oldBuy, newBuy}
  const unchanged = [];       // codes matched but new == old
  const unmatched = [];       // pdf codes not in DB
  for (const [rawCode, v21] of PRICE_UPDATE_LIST) {
    const code = String(rawCode).toUpperCase().trim();
    pdfCodes.add(code);
    const newBuy = Math.round(v21 * 0.95 * 100) / 100;
    const p = dbByCode.get(code);
    if (!p) { unmatched.push({ code, v21, newBuy }); continue; }
    const oldBuy = Number(p.buy_price || 0);
    if (Math.abs(oldBuy - newBuy) < 0.005) unchanged.push({ code, buy: oldBuy });
    else changes.push({ product: p, oldBuy, newBuy });
  }
  const dbNotInPdf = [];
  for (const c of dbCodes) if (!pdfCodes.has(c)) dbNotInPdf.push(c);

  const chgHtml = changes.length
    ? changes.slice(0, 500).map(c => `
        <tr>
          <td><span class="badge b-orange">${esc(c.product.code)}</span></td>
          <td style="font-size:12px">${esc(c.product.name || '')}</td>
          <td style="text-align:end">${fmt(c.oldBuy)}</td>
          <td style="text-align:end;color:var(--green);font-weight:700">${fmt(c.newBuy)}</td>
          <td style="text-align:end;font-size:11px;color:${c.newBuy>c.oldBuy?'#dc2626':'#16a34a'}">
            ${(c.newBuy - c.oldBuy).toFixed(2)}
          </td>
        </tr>`).join('')
      + (changes.length > 500 ? `<tr><td colspan="5" style="text-align:center;color:var(--muted)">…and ${changes.length - 500} more</td></tr>` : '')
    : `<tr><td colspan="5" style="text-align:center;color:var(--muted)">Nothing to change</td></tr>`;

  const unmatchedHtml = unmatched.length
    ? `<div style="margin-top:12px;background:#fef3c7;border:1px solid #fbbf24;border-radius:8px;padding:10px">
         <div style="font-weight:800;color:#92400e;margin-bottom:6px">⚠️ ${unmatched.length} PDF codes not in your store (add manually if needed):</div>
         <div style="font-family:monospace;font-size:12px;max-height:140px;overflow:auto;white-space:pre-wrap;user-select:all">${unmatched.map(u=>u.code).join('\n')}</div>
       </div>`
    : '';

  const orphanHtml = dbNotInPdf.length
    ? `<div style="margin-top:8px;background:#f3f4f6;border:1px solid #d1d5db;border-radius:8px;padding:10px">
         <div style="font-weight:700;color:#374151;margin-bottom:6px">ℹ️ ${dbNotInPdf.length} store products not in this PDF (buy price unchanged):</div>
         <div style="font-family:monospace;font-size:11px;max-height:100px;overflow:auto;white-space:pre-wrap;user-select:all">${dbNotInPdf.slice(0,600).join('\n')}${dbNotInPdf.length>600?'\n…':''}</div>
       </div>`
    : '';

  const html = `
    <div class="modal open" id="buy-price-modal">
      <div class="modal-content" style="max-width:900px">
        <div class="modal-header">
          <span class="modal-title">Bulk update buy prices — El Ashry 07/15</span>
          <button class="modal-close" onclick="_closeBuyPricePreview()">×</button>
        </div>
        <div class="modal-body">
          <div class="stat-grid" style="margin-bottom:12px">
            <div class="stat-card green"><div class="stat-val">${changes.length}</div><div class="stat-label">Will update</div></div>
            <div class="stat-card blue"><div class="stat-val">${unchanged.length}</div><div class="stat-label">Already correct</div></div>
            <div class="stat-card orange"><div class="stat-val">${unmatched.length}</div><div class="stat-label">Not in store</div></div>
            <div class="stat-card gray"><div class="stat-val">${dbNotInPdf.length}</div><div class="stat-label">Not in PDF</div></div>
          </div>
          <div class="table-wrap" style="max-height:52vh;overflow:auto;border:1px solid #e5e7eb;border-radius:8px">
            <table>
              <thead><tr>
                <th>Code</th><th>Name</th>
                <th style="text-align:end">Old buy</th>
                <th style="text-align:end">New buy</th>
                <th style="text-align:end">Δ</th>
              </tr></thead>
              <tbody>${chgHtml}</tbody>
            </table>
          </div>
          ${unmatchedHtml}
          ${orphanHtml}
          <div style="margin-top:14px;font-size:12px;color:var(--muted)">
            Formula: <code>buy_price = v21 × 0.95</code>, rounded to 2 decimals. Matching is by exact <code>code</code> (case-insensitive).
          </div>
        </div>
        <div class="modal-footer">
          <button class="btn btn-ghost" onclick="_closeBuyPricePreview()">Cancel</button>
          <button class="btn btn-primary" id="buy-price-apply-btn" ${changes.length ? '' : 'disabled'}
                  onclick="_applyBuyPriceUpdates(${JSON.stringify(changes.map(c=>({id:c.product.id, code:c.product.code, newBuy:c.newBuy}))).replace(/"/g,'&quot;')})">
            Apply ${changes.length} update${changes.length===1?'':'s'}
          </button>
        </div>
      </div>
    </div>`;
  const mount = document.createElement('div');
  mount.id = 'buy-price-mount';
  mount.innerHTML = html;
  document.body.appendChild(mount);
}

function _closeBuyPricePreview() {
  const m = document.getElementById('buy-price-mount');
  if (m) m.remove();
}

async function _applyBuyPriceUpdates(items) {
  const btn = document.getElementById('buy-price-apply-btn');
  if (!btn) return;
  btn.disabled = true;
  const total = items.length;
  let done = 0, failed = 0;
  const failedCodes = [];
  for (const it of items) {
    btn.textContent = `Applying ${++done}/${total}…`;
    try {
      await dbUpdate('products', it.id, { buy_price: it.newBuy });
      const i = cache.products.findIndex(p => p.id === it.id);
      if (i >= 0) cache.products[i] = { ...cache.products[i], buy_price: it.newBuy };
    } catch (e) {
      failed++;
      failedCodes.push(it.code);
      console.warn('bulk buy-price update failed for', it.code, e);
    }
  }
  renderInventory();
  _closeBuyPricePreview();
  if (failed) {
    alert(`Done: ${total - failed} updated, ${failed} failed.\nFailed codes:\n${failedCodes.join(', ')}`);
  } else {
    showToast(`✅ Updated buy price for ${total} products`);
  }
}
