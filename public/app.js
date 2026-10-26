(() => {
  const $ = id => document.getElementById(id);
  const WEEKDAYS = ['Lun', 'Mar', 'Mer', 'Gio', 'Ven', 'Sab', 'Dom'];
  const monthFmt = new Intl.DateTimeFormat('it-IT', { month: 'long', year: 'numeric' });
  const dayFmt = new Intl.DateTimeFormat('it-IT', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' });

  const todayKey = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Rome' }).format(new Date());
  const [ty, tm] = todayKey.split('-').map(Number);
  let view = { year: ty, month: tm - 1 };
  let monthData = {};
  let selectedDate = null;
  let selectedTime = null;

  const pad = n => String(n).padStart(2, '0');
  const monthKey = () => `${view.year}-${pad(view.month + 1)}`;
  const prettyDate = date => dayFmt.format(new Date(`${date}T12:00:00Z`));
  const slotEnd = time => {
    const [h, m] = time.split(':').map(Number);
    const total = h * 60 + m + 40;
    return `${pad(Math.floor(total / 60))}:${pad(total % 60)}`;
  };

  async function loadMonth() {
    const key = monthKey();
    monthData = {};
    renderCalendar();
    try {
      const res = await fetch(`/api/availability?month=${key}`);
      const data = await res.json();
      if (key !== monthKey()) return;
      monthData = data.ok ? data.days : {};
    } catch {
      monthData = {};
    }
    renderCalendar();
  }

  function renderCalendar() {
    $('monthLabel').textContent = monthFmt.format(new Date(view.year, view.month, 1));
    $('prevMonth').disabled = view.year === ty && view.month === tm - 1;
    const grid = $('calendar');
    grid.innerHTML = WEEKDAYS.map(d => `<div class="wd">${d}</div>`).join('');
    const offset = (new Date(view.year, view.month, 1).getDay() + 6) % 7;
    const days = new Date(view.year, view.month + 1, 0).getDate();
    for (let i = 0; i < offset; i++) grid.insertAdjacentHTML('beforeend', '<span></span>');
    for (let d = 1; d <= days; d++) {
      const key = `${monthKey()}-${pad(d)}`;
      const info = monthData[key];
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'day' + (key === selectedDate ? ' selected' : '');
      btn.textContent = d;
      const bookable = info && key >= todayKey && info.status !== 'full';
      btn.disabled = !bookable;
      if (info && key >= todayKey) btn.insertAdjacentHTML('beforeend', `<span class="dot ${info.status}"></span>`);
      btn.addEventListener('click', () => selectDate(key));
      grid.appendChild(btn);
    }
  }

  async function selectDate(date) {
    selectedDate = date;
    selectedTime = null;
    renderCalendar();
    updateSummary();
    $('slotsBox').innerHTML = '<p class="muted">Caricamento orari…</p>';
    try {
      const res = await fetch(`/api/availability?date=${date}`);
      const data = await res.json();
      if (!data.ok) throw new Error(data.error);
      renderSlots(data);
    } catch {
      $('slotsBox').innerHTML = '<p class="msg err">Impossibile caricare gli orari. Riprova tra poco.</p>';
    }
  }

  function renderSlots(data) {
    const all = [...data.freeSlots, ...data.busySlots].sort();
    if (!all.length) {
      $('slotsBox').innerHTML = '<p class="muted">Il salone è chiuso in questo giorno.</p>';
      return;
    }
    const free = new Set(data.freeSlots);
    const group = (label, list) => list.length ? `<div class="shift-label">${label}</div><div class="slots">${list.map(t =>
      `<button type="button" class="slot${t === selectedTime ? ' selected' : ''}" data-time="${t}" ${free.has(t) ? '' : 'disabled'}>${t}</button>`).join('')}</div>` : '';
    $('slotsBox').innerHTML = `<p class="muted" style="margin:0;text-transform:capitalize">${prettyDate(data.date)}</p>` +
      group('Mattina', all.filter(t => t < '13:00')) + group('Pomeriggio', all.filter(t => t >= '13:00'));
    $('slotsBox').querySelectorAll('.slot:not(:disabled)').forEach(btn => btn.addEventListener('click', () => {
      selectedTime = btn.dataset.time;
      $('slotsBox').querySelectorAll('.slot').forEach(b => b.classList.toggle('selected', b === btn));
      updateSummary();
    }));
  }

  function updateSummary() {
    $('summary').textContent = selectedDate && selectedTime
      ? `Taglio · ${prettyDate(selectedDate)} · ${selectedTime}–${slotEnd(selectedTime)}`
      : 'Nessun orario selezionato';
    $('submitBtn').disabled = !(selectedDate && selectedTime);
  }

  $('prevMonth').addEventListener('click', () => {
    view.month--; if (view.month < 0) { view.month = 11; view.year--; }
    loadMonth();
  });
  $('nextMonth').addEventListener('click', () => {
    view.month++; if (view.month > 11) { view.month = 0; view.year++; }
    loadMonth();
  });

  $('bookingForm').addEventListener('submit', async event => {
    event.preventDefault();
    const msg = $('formMsg');
    const form = new FormData(event.target);
    $('submitBtn').disabled = true;
    msg.innerHTML = '<p class="msg">Invio in corso…</p>';
    try {
      const res = await fetch('/api/booking', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...Object.fromEntries(form), date: selectedDate, time: selectedTime }),
      });
      const data = await res.json();
      if (!data.ok) {
        msg.innerHTML = `<p class="msg err">${data.error || 'Prenotazione non riuscita.'}</p>`;
        if (data.code === 'SLOT_UNAVAILABLE') { selectDate(selectedDate); loadMonth(); }
        updateSummary();
        return;
      }
      msg.innerHTML = `<p class="msg ok">Prenotazione confermata! Ti aspettiamo ${prettyDate(data.date)} alle ${data.start}.</p>`;
      event.target.reset();
      const date = selectedDate;
      selectedTime = null;
      updateSummary();
      selectDate(date);
      loadMonth();
    } catch {
      msg.innerHTML = '<p class="msg err">Errore di connessione. Riprova.</p>';
      updateSummary();
    }
  });

  loadMonth();
})();
