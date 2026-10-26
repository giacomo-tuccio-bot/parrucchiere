(async () => {
  const $ = id => document.getElementById(id);
  const { esc } = Salon;
  const WEEKDAYS = ['Lun', 'Mar', 'Mer', 'Gio', 'Ven', 'Sab', 'Dom'];
  const monthFmt = new Intl.DateTimeFormat('it-IT', { month: 'long', year: 'numeric' });
  const dayFmt = new Intl.DateTimeFormat('it-IT', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' });
  const pad = n => String(n).padStart(2, '0');
  const durationLabel = min => min < 60 ? `${min} min` : `${Math.floor(min / 60)} h${min % 60 ? ` ${min % 60} min` : ''}`;

  const config = await Salon.ready;
  renderInfo(config);

  const todayKey = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Rome' }).format(new Date());
  const [ty, tm] = todayKey.split('-').map(Number);
  let view = { year: ty, month: tm - 1 };
  let monthData = {};
  let service = config.services[0];
  let selectedDate = null;
  let selectedTime = null;

  const monthKey = () => `${view.year}-${pad(view.month + 1)}`;
  const prettyDate = date => dayFmt.format(new Date(`${date}T12:00:00Z`));
  const endTime = time => {
    const [h, m] = time.split(':').map(Number);
    const total = h * 60 + m + service.duration;
    return `${pad(Math.floor(total / 60))}:${pad(total % 60)}`;
  };

  function renderInfo(c) {
    $('heroTitle').textContent = c.name;
    $('heroText').textContent = c.tagline + '. ' + c.description;
    const rows = Salon.hoursRows(c);
    const closed = rows.filter(r => r.value === 'Chiuso').map(r => r.label.toLowerCase());
    $('heroHours').innerHTML = rows.filter(r => r.value !== 'Chiuso').map(r => `<span class="pill">${esc(r.label)} · ${esc(r.value)}</span>`).join('') +
      (closed.length ? `<span class="pill">Chiuso ${esc(closed.reverse().join(' e '))}</span>` : '');
    $('servicesList').innerHTML = c.services.map(s => `
      <div class="service">
        <div><strong>${esc(s.name)}</strong><span class="muted">${durationLabel(s.duration)}</span></div>
        ${s.price ? `<span class="price">${esc(s.price)}</span>` : ''}
      </div>`).join('');
    $('hoursTable').innerHTML = Salon.hoursRows(c).map(r => `<tr><th>${esc(r.label)}</th><td>${esc(r.value)}</td></tr>`).join('');
    const wa = c.whatsapp ? `https://wa.me/${encodeURIComponent(c.whatsapp.replace(/\D/g, ''))}` : '';
    const maps = c.mapsUrl || (c.address ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(c.address)}` : '');
    $('contactCard').innerHTML = `
      <h2>${esc(c.name)}</h2>
      ${c.address ? `<p>📍 ${esc(c.address)}</p>` : ''}
      ${c.phone ? `<p>📞 <a href="tel:${esc(c.phone.replace(/\s/g, ''))}">${esc(c.phone)}</a></p>` : ''}
      ${c.email ? `<p>✉️ <a href="mailto:${esc(c.email)}">${esc(c.email)}</a></p>` : ''}
      ${c.instagram ? `<p>📷 <a href="https://instagram.com/${esc(c.instagram)}" target="_blank" rel="noopener">@${esc(c.instagram)}</a></p>` : ''}
      <div class="toolbar">
        ${maps ? `<a class="btn ghost sm" href="${esc(maps)}" target="_blank" rel="noopener">Indicazioni stradali</a>` : ''}
        ${wa ? `<a class="btn sm" href="${esc(wa)}" target="_blank" rel="noopener">Scrivici su WhatsApp</a>` : ''}
      </div>`;
    if (wa) {
      $('waFloat').href = wa;
      $('waFloat').classList.remove('hidden');
    }
    $('footerName').textContent = `© ${new Date().getFullYear()} ${c.name}${c.vatNumber ? ` · P.IVA ${c.vatNumber}` : ''}`;
    $('serviceChips').innerHTML = c.services.map((s, i) =>
      `<button type="button" class="chip${i === 0 ? ' selected' : ''}" data-id="${esc(s.id)}">${esc(s.name)}<small>${durationLabel(s.duration)}</small></button>`).join('');
  }

  async function loadMonth() {
    const key = monthKey();
    const serviceId = service.id;
    monthData = {};
    renderCalendar();
    try {
      const res = await fetch(`/api/availability?month=${key}&service=${encodeURIComponent(serviceId)}`);
      const data = await res.json();
      if (key !== monthKey() || serviceId !== service.id) return;
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
      btn.disabled = !(info && key >= todayKey && info.status !== 'full');
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
      const res = await fetch(`/api/availability?date=${date}&service=${encodeURIComponent(service.id)}`);
      const data = await res.json();
      if (!data.ok) throw new Error(data.error);
      if (date === selectedDate) renderSlots(data);
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
    if (!data.freeSlots.length) {
      $('slotsBox').innerHTML = `<p class="muted">Nessun orario libero per ${esc(service.name)} in questo giorno. Prova un altro giorno.</p>`;
      return;
    }
    const free = new Set(data.freeSlots);
    const afternoon = config.shifts[1]?.[0] || '24:00';
    const group = (label, list) => list.length ? `<div class="shift-label">${label}</div><div class="slots">${list.map(t =>
      `<button type="button" class="slot" data-time="${t}" ${free.has(t) ? '' : 'disabled'}>${t}</button>`).join('')}</div>` : '';
    $('slotsBox').innerHTML = `<p class="muted" style="margin:0;text-transform:capitalize">${prettyDate(data.date)}</p>` +
      group('Mattina', all.filter(t => t < afternoon)) + group('Pomeriggio', all.filter(t => t >= afternoon));
    $('slotsBox').querySelectorAll('.slot:not(:disabled)').forEach(btn => btn.addEventListener('click', () => {
      selectedTime = btn.dataset.time;
      $('slotsBox').querySelectorAll('.slot').forEach(b => b.classList.toggle('selected', b === btn));
      updateSummary();
      if (window.innerWidth < 820) $('bookingForm').scrollIntoView({ behavior: 'smooth' });
    }));
  }

  function updateSummary() {
    $('summary').textContent = selectedDate && selectedTime
      ? `${service.name} · ${prettyDate(selectedDate)} · ${selectedTime}–${endTime(selectedTime)}`
      : `${service.name} · scegli giorno e orario`;
    $('submitBtn').disabled = !(selectedDate && selectedTime);
  }

  $('serviceChips').addEventListener('click', e => {
    const chip = e.target.closest('.chip');
    if (!chip) return;
    service = config.services.find(s => s.id === chip.dataset.id);
    $('serviceChips').querySelectorAll('.chip').forEach(c => c.classList.toggle('selected', c === chip));
    loadMonth();
    if (selectedDate) selectDate(selectedDate);
    else updateSummary();
  });
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
        body: JSON.stringify({ ...Object.fromEntries(form), privacy: $('privacy').checked, service: service.id, date: selectedDate, time: selectedTime }),
      });
      const data = await res.json();
      if (!data.ok) {
        msg.innerHTML = `<p class="msg err">${esc(data.error || 'Prenotazione non riuscita.')}</p>`;
        if (data.code === 'SLOT_UNAVAILABLE') { selectDate(selectedDate); loadMonth(); }
        else updateSummary();
        return;
      }
      msg.innerHTML = `<p class="msg ok">Prenotazione confermata! ${esc(data.service)} ${esc(prettyDate(data.date))} alle ${esc(data.start)}. Ti aspettiamo!</p>`;
      event.target.reset();
      selectDate(selectedDate);
      loadMonth();
    } catch {
      msg.innerHTML = '<p class="msg err">Errore di connessione. Riprova.</p>';
      updateSummary();
    }
  });

  updateSummary();
  loadMonth();
})();
