const dateTime = new Intl.DateTimeFormat('id-ID', {
  day: 'numeric',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
});

const dateOnly = new Intl.DateTimeFormat('id-ID', { day: 'numeric', month: 'short', year: 'numeric' });

export function formatDateTime(ms: number): string {
  return dateTime.format(ms);
}

export function formatDate(ms: number): string {
  return dateOnly.format(ms);
}
