const crypto = require('crypto');
const {
  clean, readBody, adminPin, findService, TIMEZONE, zonedTimeToUtcIso, addDays, toMinutes, fromMinutes,
  dateIsValid, timeIsValid, slotsForDate, openingWindow, overlaps, slotRange, slotHasStarted,
  listEvents, createEvent, getEvent, deleteEvent, rangeIsFree,
} = require('./_lib');

function pinMatches(pin) {
  const expected = adminPin();
  if (!expected) return false;
  const a = crypto.createHash('sha256').update(String(pin || '')).digest();
  const b = crypto.createHash('sha256').update(expected).digest();
  return crypto.timingSafeEqual(a, b);
}

function eventRange(event) {
  if (event.start?.dateTime) return { start: event.start.dateTime, end: event.end.dateTime };
  // Evento di tutto il giorno (es. ferie inserite direttamente su Google Calendar)
  return { start: zonedTimeToUtcIso(event.start.date, '00:00'), end: zonedTimeToUtcIso(event.end.date, '00:00') };
}

function describeEvent(event) {
  const range = eventRange(event);
  const fmt = iso => new Intl.DateTimeFormat('it-IT', { timeZone: TIMEZONE, hour: '2-digit', minute: '2-digit' }).format(new Date(iso));
  return {
    id: event.id,
    type: event.extendedProperties?.private?.salonType || 'external',
    summary: event.summary || '(senza titolo)',
    description: event.description || '',
    allDay: !event.start?.dateTime,
    start: range.start,
    end: range.end,
    label: event.start?.dateTime ? `${fmt(range.start)}–${fmt(range.end)}` : 'tutto il giorno',
    link: event.htmlLink || null,
  };
}

async function dayView(date) {
  const slots = slotsForDate(date);
  const events = (await listEvents(zonedTimeToUtcIso(date, '00:00'), zonedTimeToUtcIso(addDays(date, 1), '00:00')))
    .filter(e => e.status !== 'cancelled' && e.transparency !== 'transparent')
    .map(describeEvent);
  return {
    date,
    open: slots.length > 0,
    events,
    slots: slots.map(slot => {
      const range = slotRange(date, slot);
      const event = events.find(e => overlaps(range.start, range.end, e.start, e.end));
      return {
        start: slot.start,
        end: slot.end,
        past: slotHasStarted(date, slot),
        status: event ? event.type : 'free',
        eventId: event?.id || null,
      };
    }),
  };
}

// Unisce slot consecutivi in un solo intervallo: 09:00 + 09:40 → 09:00–10:20
function mergeSlots(date, starts) {
  const wanted = new Set(starts);
  const ranges = [];
  for (const slot of slotsForDate(date).filter(s => wanted.has(s.start))) {
    const last = ranges[ranges.length - 1];
    if (last && last.end === slot.start) last.end = slot.end;
    else ranges.push({ start: slot.start, end: slot.end });
  }
  return ranges;
}

function blockSummary(reason) {
  return `🔒 Bloccato${reason ? ` – ${reason}` : ''}`;
}

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store, max-age=0');
  if (!adminPin()) return res.status(500).json({ ok: false, error: 'ADMIN_PIN non configurato su Vercel.' });
  if (!pinMatches(req.headers['x-admin-pin'])) return res.status(401).json({ ok: false, error: 'PIN non corretto.' });

  try {
    if (req.method === 'GET') {
      const date = clean(req.query?.date, 20);
      if (!dateIsValid(date)) return res.status(400).json({ ok: false, error: 'Data non valida.' });
      return res.status(200).json({ ok: true, ...(await dayView(date)) });
    }

    if (req.method !== 'POST') {
      res.setHeader('Allow', 'GET, POST');
      return res.status(405).json({ ok: false, error: 'Metodo non consentito.' });
    }

    const body = readBody(req);
    const action = clean(body.action, 30);
    const date = clean(body.date, 20);
    const reason = clean(body.reason, 120);

    if (action === 'delete') {
      const eventId = clean(body.eventId, 200);
      if (!eventId) return res.status(400).json({ ok: false, error: 'Evento mancante.' });
      const event = await getEvent(eventId);
      if (!event.extendedProperties?.private?.salonType) {
        return res.status(403).json({ ok: false, error: 'Questo evento è stato creato su Google Calendar: modificalo da lì.' });
      }
      await deleteEvent(eventId);
      return res.status(200).json({ ok: true });
    }

    if (!dateIsValid(date)) return res.status(400).json({ ok: false, error: 'Data non valida.' });

    if (action === 'block-slots') {
      const starts = Array.isArray(body.starts) ? body.starts.map(s => clean(s, 5)) : [];
      const ranges = mergeSlots(date, starts);
      if (!ranges.length) return res.status(400).json({ ok: false, error: 'Seleziona almeno un orario.' });
      for (const range of ranges) {
        await createEvent({ type: 'block', date, ...range, summary: blockSummary(reason), description: 'Orario bloccato dal pannello del salone.' });
      }
      return res.status(200).json({ ok: true, blocked: ranges });
    }

    if (action === 'block-range' || action === 'block-day') {
      const hours = openingWindow();
      const start = action === 'block-day' ? hours.start : clean(body.start, 5);
      const end = action === 'block-day' ? hours.end : clean(body.end, 5);
      if (!timeIsValid(start) || !timeIsValid(end) || toMinutes(start) >= toMinutes(end)) {
        return res.status(400).json({ ok: false, error: 'Intervallo orario non valido.' });
      }
      await createEvent({
        type: 'block', date, start, end,
        summary: action === 'block-day' ? `🔒 Chiuso${reason ? ` – ${reason}` : ''}` : blockSummary(reason),
        description: 'Orario bloccato dal pannello del salone.',
      });
      return res.status(200).json({ ok: true, blocked: [{ start, end }] });
    }

    if (action === 'phone') {
      const name = clean(body.name, 80);
      const phone = clean(body.phone, 40);
      const notes = clean(body.notes, 1000);
      const start = clean(body.time, 5);
      const service = findService(clean(body.service, 40));
      if (!name) return res.status(400).json({ ok: false, error: 'Inserisci il nome del cliente.' });
      if (!service) return res.status(400).json({ ok: false, error: 'Scegli un servizio.' });
      if (!timeIsValid(start)) return res.status(400).json({ ok: false, error: 'Orario non valido.' });
      const end = fromMinutes(toMinutes(start) + service.duration);
      if (!(await rangeIsFree(date, start, end))) {
        return res.status(409).json({ ok: false, error: `Non c'è spazio per ${service.name} (${service.duration} min) dalle ${start}: l'orario si sovrappone a un altro appuntamento o blocco.` });
      }
      const event = await createEvent({
        type: 'phone', date, start, end,
        summary: `📞 ${service.name} – ${name}`,
        description: ['Prenotazione telefonica', `Servizio: ${service.name}`, `Cliente: ${name}`, phone ? `Telefono: ${phone}` : null, `Note: ${notes || 'nessuna'}`].filter(Boolean).join('\n'),
      });
      return res.status(200).json({ ok: true, eventId: event.id });
    }

    return res.status(400).json({ ok: false, error: 'Azione non riconosciuta.' });
  } catch (error) {
    console.error('Errore pannello salone:', error);
    return res.status(502).json({ ok: false, error: 'Operazione su Google Calendar non riuscita.', provider: error.message });
  }
};
