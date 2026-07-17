import React from 'react';

const STATUS = {
  READY: 'ok',
  BUILDING: 'warn',
  ERROR: 'err',
  CANCELED: 'muted',
};

export function StatusBadge({ status }) {
  return <span className={`status status-${STATUS[status] || 'muted'}`}>{status || '?'}</span>;
}

export function humanBytes(n) {
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

export function timeAgo(iso) {
  if (!iso) return '–';
  const secs = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  if (secs < 60) return `${secs}s ago`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}
