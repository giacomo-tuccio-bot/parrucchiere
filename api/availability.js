const {
  clean, zonedTimeToUtcIso, slotsForDate, openingWindow, overlaps, slotRange,
  slotHasStarted, isBookableDate, getBusyWindows,
} = require('./_lib');

function availabilityForDate(date, busy) {
  const slots = slotsForDate(date);
  const bookable = isBookableDate(date);
  const freeSlots = [];
  const busySlots = [];
  for (const slot of slots) {
    const range = slotRange(date, slot);
    const taken = !bookable || slotHasStarted(date, slot) || busy.some(w => overlaps(range.start, range.end, w.start, w.end));
    (taken ? busySlots : freeSlots).push(slot.start);
  }
  return {
    totalSlots: slots.length,
    freeSlots,
    busySlots,
    status: !slots.length || !freeSlots.length ? 'full' : busySlots.length ? 'partial' : 'free',
  };
}

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ ok: false, error: 'Metodo non consentito.' });
  }

  const date = clean(req.query?.date, 20);
  const month = clean(req.query?.month, 10);
  const validDate = /^\d{4}-\d{2}-\d{2}$/.test(date);
  const validMonth = /^\d{4}-\d{2}$/.test(month);
  if (!validDate && !validMonth) return res.status(400).json({ ok: false, error: 'Data o mese non valido.' });

  const dates = [];
  if (validMonth) {
    const [year, monthNumber] = month.split('-').map(Number);
    const last = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();
    for (let day = 1; day <= last; day++) {
      const d = `${month}-${String(day).padStart(2, '0')}`;
      if (slotsForDate(d).length) dates.push(d);
    }
  } else if (slotsForDate(date).length) {
    dates.push(date);
  }

  res.setHeader('Cache-Control', 'no-store, max-age=0');
  if (!dates.length) {
    return validMonth
      ? res.status(200).json({ ok: true, month, days: {} })
      : res.status(200).json({ ok: true, date, totalSlots: 0, freeSlots: [], busySlots: [], status: 'closed' });
  }

  try {
    const hours = openingWindow();
    const busy = await getBusyWindows(
      zonedTimeToUtcIso(dates[0], hours.start),
      zonedTimeToUtcIso(dates[dates.length - 1], hours.end),
    );
    if (validMonth) {
      const days = {};
      for (const d of dates) days[d] = availabilityForDate(d, busy);
      return res.status(200).json({ ok: true, month, days });
    }
    return res.status(200).json({ ok: true, date, ...availabilityForDate(date, busy) });
  } catch (error) {
    console.error('Errore disponibilità Google Calendar:', error);
    return res.status(502).json({ ok: false, error: 'Disponibilità temporaneamente non disponibile.' });
  }
};
