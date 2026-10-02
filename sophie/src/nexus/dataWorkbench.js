'use strict';

function parseCsv(text, delimiter = ',') {
  const rows = String(text || '').trim().split(/\r?\n/).filter(Boolean).map(row => row.split(delimiter).map(v => v.trim()));
  if (!rows.length) return { headers: [], rows: [] };
  return { headers: rows[0], rows: rows.slice(1) };
}

function numericColumns(table) {
  return table.headers.map((header, i) => {
    const values = table.rows.map(row => Number(row[i])).filter(Number.isFinite);
    if (!values.length || values.length < Math.max(1, table.rows.length * 0.5)) return null;
    const mean = values.reduce((a,b) => a + b, 0) / values.length;
    const variance = values.reduce((a,b) => a + ((b - mean) ** 2), 0) / values.length;
    return { header, count: values.length, min: Math.min(...values), max: Math.max(...values), mean, stdDev: Math.sqrt(variance) };
  }).filter(Boolean);
}

function analyzeCsv(text, delimiter = ',') {
  const table = parseCsv(text, delimiter);
  return { rows: table.rows.length, columns: table.headers.length, headers: table.headers, numeric: numericColumns(table) };
}

module.exports = { parseCsv, numericColumns, analyzeCsv };
