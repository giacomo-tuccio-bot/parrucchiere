(() => {
  const $ = id => document.getElementById(id);
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const dayFmt = new Intl.DateTimeFormat('it-IT', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
  const todayKey = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Rome' }).format(new Date());
  const addDays = (date, n) => {
    const d = new Date(`${date}T12:00:00Z`);
    d.setUTCDate(d.getUTCDate() + n);
    return d.toISOString().slice(0, 10);
  };
  const TYPE_LABEL = { free: 'libero', booking: 'online', phone: 'telefono', block: 'bloccato', external: 'Google' };

  let pin = '';
  try { pin = sessionStorage.getItem('salonPin') || ''; } catch {}
  let date = todayKey();
  let day = null;
  let phoneTime = null;
  let services = [];
  Salon.ready.then(config => {
    services = config.services;
    $('phoneService').innerHTML = services.map(s => `<option value="${esc(s.id)}">${esc(s.name)} (${s.duration} min)</option>`).join('');
  });
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});

  async function api(method, payload, query = '') {
    const res = await fetch(`/api/admin${query}`, {
      method,
      headers: { 'Content-Type': 'application/json', 'x-admin-pin': pin },
      body: payload ? JSON.stringify(payload) : undefined,
    });
    const data = await res.json().catch(() => ({ ok: false, error: 'Risposta non valida dal server.' }));
    if (res.status === 401) logout(data.error);
    return data;
  }

  function showMsg(text, kind = 'ok') {
    $('panelMsg').innerHTML = text ? `<p class="msg ${kind}">${esc(text)}</p>` : '';
  }

  function logout(message) {
    pin = '';
    try { sessionStorage.removeItem('salonPin'); } catch {}
    $('panel').classList.add('hidden');
    $('logoutBtn').classList.add('hidden');
    $('loginForm').classList.remove('hidden');
    $('loginMsg').innerHTML = message ? `<p class="msg err">${esc(message)}</p>` : '';
  }

  async function loadDay() {
    $('dayTitle').textContent = dayFmt.format(new Date(`${date}T12:00:00Z`));
    $('datePicker').value = date;
    $('slotList').innerHTML = '<p class="muted">Caricamento…</p>';
    const data = await api('GET', null, `?date=${date}`);
    if (!data.ok) {
      if (pin) $('slotList').innerHTML = `<p class="msg err">${esc(data.error)}</p>`;
      return false;
    }
    day = data;
    render();
    return true;
  }

  function eventInfo(id) {
    const event = day.events.find(e => e.id === id);
    if (!event) return '';
    const phone = (event.description.match(/Telefono: (.+)/) || [])[1];
    const notes = (event.description.match(/Note: (.+)/) || [])[1];
    return `<strong>${esc(event.summary)}</strong>` +
      (phone ? ` · <a href="tel:${esc(phone)}">${esc(phone)}</a>` : '') +
      (notes && notes !== 'nessuna' ? `<br><span class="muted">${esc(notes)}</span>` : '') +
      (event.type === 'block' || event.type === 'external' ? ` <span class="muted">(${esc(event.label)})</span>` : '');
  }

  function render() {
    $('rangeCard').classList.toggle('hidden', !day.open);
    if (!day.open) {
      const others = day.events.map(e => `<div class="slot-row"><span class="time">${esc(e.label)}</span><span class="info">${eventInfo(e.id)}</span></div>`).join('');
      $('slotList').innerHTML = '<p class="muted">Salone chiuso (domenica e lunedì).</p>' + others;
      $('blockSelected').disabled = true;
      return;
    }
    $('slotList').innerHTML = day.slots.map(slot => {
      const event = slot.eventId && day.events.find(e => e.id === slot.eventId);
      let actions = '';
      if (slot.status === 'free' && !slot.past) {
        actions = `<button class="btn sm" data-act="phone" data-time="${slot.start}">📞 Prenota</button>
          <button class="btn dark sm" data-act="block" data-time="${slot.start}">🔒 Blocca</button>`;
      } else if (slot.status === 'block') {
        actions = `<button class="btn ghost sm" data-act="delete" data-id="${esc(slot.eventId)}">🔓 Sblocca</button>`;
      } else if (slot.status === 'booking' || slot.status === 'phone') {
        actions = `<button class="btn ghost sm" data-act="cancel" data-id="${esc(slot.eventId)}">Annulla</button>`;
      } else if (slot.status === 'external' && event?.link) {
        actions = `<a class="btn ghost sm" href="${esc(event.link)}" target="_blank" rel="noopener">Apri in Google</a>`;
      }
      const checkbox = slot.status === 'free' && !slot.past
        ? `<input type="checkbox" class="pick" value="${slot.start}" aria-label="Seleziona ${slot.start}">`
        : '<span style="width:18px"></span>';
      return `<div class="slot-row ${slot.status}${slot.past ? ' past' : ''}">
        ${checkbox}
        <span class="time">${slot.start}–${slot.end}</span>
        <span class="info"><span class="tag ${slot.status}">${TYPE_LABEL[slot.status]}</span>${slot.eventId ? eventInfo(slot.eventId) : ''}</span>
        <span class="actions">${actions}</span>
      </div>`;
    }).join('');
    updateSelection();
  }

  function selectedStarts() {
    return [...document.querySelectorAll('.pick:checked')].map(c => c.value);
  }

  function updateSelection() {
    const n = selectedStarts().length;
    $('blockSelected').disabled = !n;
    $('blockSelected').textContent = n ? `🔒 Blocca selezionati (${n})` : '🔒 Blocca selezionati';
  }

  async function run(payload, okText) {
    showMsg('Salvataggio…', 'info');
    const data = await api('POST', payload);
    if (!data.ok) return showMsg(data.error || 'Operazione non riuscita.', 'err');
    showMsg(okText);
    loadDay();
  }

  $('slotList').addEventListener('change', e => { if (e.target.classList.contains('pick')) updateSelection(); });
  $('slotList').addEventListener('click', e => {
    const btn = e.target.closest('button[data-act]');
    if (!btn) return;
    const { act, time, id } = btn.dataset;
    if (act === 'block') run({ action: 'block-slots', date, starts: [time], reason: $('blockReason').value }, `Orario ${time} bloccato.`);
    if (act === 'delete') run({ action: 'delete', eventId: id }, 'Orario sbloccato.');
    if (act === 'cancel' && confirm('Annullare questo appuntamento? Verrà eliminato da Google Calendar.')) run({ action: 'delete', eventId: id }, 'Appuntamento annullato.');
    if (act === 'phone') {
      phoneTime = time;
      $('phoneForm').reset();
      if (services[0]) $('phoneService').value = services[0].id;
      $('phoneSummary').textContent = `${dayFmt.format(new Date(`${date}T12:00:00Z`))} · ${time}`;
      $('phoneDialog').showModal();
      $('phoneName').focus();
    }
  });

  $('blockSelected').addEventListener('click', () => {
    const starts = selectedStarts();
    run({ action: 'block-slots', date, starts, reason: $('blockReason').value }, `${starts.length} orari bloccati.`);
  });

  $('rangeForm').addEventListener('submit', e => {
    e.preventDefault();
    const start = $('rangeStart').value;
    const end = $('rangeEnd').value;
    run({ action: 'block-range', date, start, end, reason: $('rangeReason').value }, `Bloccato dalle ${start} alle ${end}.`);
  });

  $('blockDay').addEventListener('click', () => {
    if (confirm('Chiudere tutta la giornata? Nessuno potrà più prenotare online.')) {
      run({ action: 'block-day', date, reason: $('rangeReason').value }, 'Giornata chiusa.');
    }
  });

  $('phoneForm').addEventListener('submit', e => {
    e.preventDefault();
    $('phoneDialog').close();
    run({
      action: 'phone', date, time: phoneTime, service: $('phoneService').value,
      name: $('phoneName').value, phone: $('phoneNumber').value, notes: $('phoneNotes').value,
    }, `Appuntamento delle ${phoneTime} salvato.`);
  });
  $('phoneCancel').addEventListener('click', () => $('phoneDialog').close());

  const goTo = next => { date = next; showMsg(''); loadDay(); };
  $('prevDay').addEventListener('click', () => goTo(addDays(date, -1)));
  $('nextDay').addEventListener('click', () => goTo(addDays(date, 1)));
  $('todayBtn').addEventListener('click', () => goTo(todayKey()));
  $('datePicker').addEventListener('change', e => { if (e.target.value) goTo(e.target.value); });
  $('logoutBtn').addEventListener('click', () => logout());

  async function enter() {
    $('loginForm').classList.add('hidden');
    $('panel').classList.remove('hidden');
    $('logoutBtn').classList.remove('hidden');
    if (await loadDay()) {
      try { sessionStorage.setItem('salonPin', pin); } catch {}
    }
  }

  $('loginForm').addEventListener('submit', e => {
    e.preventDefault();
    pin = $('pin').value;
    $('loginMsg').innerHTML = '';
    enter();
  });

  if (pin) enter();
})();
