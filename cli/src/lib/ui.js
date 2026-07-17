'use strict';

// Minimal ANSI styling + logging helpers. No external deps so the CLI stays light.
const useColor = process.stdout.isTTY && !process.env.NO_COLOR;

function paint(code, s) {
  return useColor ? `[${code}m${s}[0m` : String(s);
}

const c = {
  bold: (s) => paint('1', s),
  dim: (s) => paint('2', s),
  red: (s) => paint('31', s),
  green: (s) => paint('32', s),
  yellow: (s) => paint('33', s),
  blue: (s) => paint('34', s),
  magenta: (s) => paint('35', s),
  cyan: (s) => paint('36', s),
  gray: (s) => paint('90', s),
};

const symbols = {
  ok: c.green('✓'),
  err: c.red('✗'),
  info: c.cyan('›'),
  dot: c.gray('•'),
  arrow: c.magenta('▲'), // Vercel's triangle, lightly borrowed
};

const log = {
  raw: (...a) => console.log(...a),
  info: (msg) => console.log(`${symbols.info} ${msg}`),
  step: (msg) => console.log(`${symbols.dot} ${c.dim(msg)}`),
  ok: (msg) => console.log(`${symbols.ok} ${msg}`),
  warn: (msg) => console.log(`${c.yellow('!')} ${msg}`),
  error: (msg) => console.error(`${symbols.err} ${c.red(msg)}`),
  brand: (msg) => console.log(`${symbols.arrow} ${c.bold(msg)}`),
};

function fail(msg, code = 1) {
  log.error(msg);
  process.exit(code);
}

function humanBytes(n) {
  if (n == null) return '–';
  const units = ['B', 'KB', 'MB', 'GB'];
  let i = 0;
  let v = Number(n);
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i += 1;
  }
  return `${v.toFixed(v < 10 && i > 0 ? 1 : 0)}${units[i]}`;
}

function ago(iso) {
  if (!iso) return '–';
  const then = new Date(iso).getTime();
  const secs = Math.max(0, Math.floor((Date.now() - then) / 1000));
  if (secs < 60) return `${secs}s ago`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

// Render an array of objects as a padded table given [key, header] columns.
function table(rows, columns) {
  if (rows.length === 0) return '';
  const widths = columns.map(([key, header]) =>
    Math.max(header.length, ...rows.map((r) => stripAnsi(String(r[key] ?? '')).length)),
  );
  const line = (cells) =>
    cells.map((cell, i) => pad(cell, widths[i])).join('  ');
  const out = [c.dim(line(columns.map(([, h]) => h)))];
  for (const r of rows) out.push(line(columns.map(([k]) => String(r[k] ?? ''))));
  return out.join('\n');
}

function stripAnsi(s) {
  // eslint-disable-next-line no-control-regex
  return s.replace(/\[[0-9;]*m/g, '');
}

function pad(s, width) {
  const visible = stripAnsi(s).length;
  return s + ' '.repeat(Math.max(0, width - visible));
}

module.exports = { c, symbols, log, fail, humanBytes, ago, table, stripAnsi };
