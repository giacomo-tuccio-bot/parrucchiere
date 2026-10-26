// Carica la configurazione del salone e la applica alla pagina (nome, colori, banner demo).
window.Salon = (() => {
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const DAY_NAMES = ['Domenica', 'Lunedì', 'Martedì', 'Mercoledì', 'Giovedì', 'Venerdì', 'Sabato'];

  // Righe orari raggruppando i giorni con lo stesso stato, es. "Martedì – Sabato: 9:00–13:00 · 14:00–20:00"
  function hoursRows(config) {
    const hours = config.shifts.map(([a, b]) => `${a.replace(/^0/, '')}–${b.replace(/^0/, '')}`).join(' · ');
    const order = [1, 2, 3, 4, 5, 6, 0];
    const rows = [];
    for (const day of order) {
      const value = config.openWeekdays.includes(day) ? hours : 'Chiuso';
      const last = rows[rows.length - 1];
      if (last && last.value === value) last.days.push(day);
      else rows.push({ days: [day], value });
    }
    return rows.map(r => ({
      label: r.days.length > 1 ? `${DAY_NAMES[r.days[0]]} – ${DAY_NAMES[r.days[r.days.length - 1]]}` : DAY_NAMES[r.days[0]],
      value: r.value,
    }));
  }

  const ready = fetch('/api/config')
    .then(res => res.json())
    .then(config => {
      const root = document.documentElement.style;
      if (config.colors?.accent) root.setProperty('--accent', config.colors.accent);
      if (config.colors?.accentDark) root.setProperty('--accent2', config.colors.accentDark);
      if (config.colors?.dark) root.setProperty('--ink', config.colors.dark);
      document.querySelectorAll('[data-salon-name]').forEach(el => { el.textContent = config.name; });
      document.title = document.title ? `${document.title} · ${config.name}` : config.name;
      const banner = document.getElementById('demoBanner');
      if (banner && config.demo) banner.classList.remove('hidden');
      return config;
    });

  return { ready, esc, hoursRows };
})();
