const {
  clean, readBody, dateIsValid, slotsForDate, slotHasStarted, isBookableDate,
  rangeIsFree, createEvent, sendEmail,
} = require('./_lib');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ ok: false, error: 'Metodo non consentito.' });
  }

  const body = readBody(req);
  const name = clean(body.name, 80);
  const phone = clean(body.phone, 40);
  const email = clean(body.email, 160);
  const notes = clean(body.notes, 1000);
  const date = clean(body.date, 20);
  const time = clean(body.time, 10);

  if (!name || !phone || !date || !time) return res.status(400).json({ ok: false, error: 'Compila nome, telefono, giorno e orario.' });
  if (phone.replace(/\D/g, '').length < 9) return res.status(400).json({ ok: false, error: 'Numero di telefono non valido.' });
  if (email && !/^\S+@\S+\.\S+$/.test(email)) return res.status(400).json({ ok: false, error: 'Email non valida.' });
  if (!dateIsValid(date) || !isBookableDate(date)) return res.status(400).json({ ok: false, error: 'Giorno non prenotabile.' });

  const slot = slotsForDate(date).find(s => s.start === time);
  if (!slot) return res.status(400).json({ ok: false, error: 'Orario non valido: il salone è aperto dal martedì al sabato.' });
  if (slotHasStarted(date, slot)) {
    return res.status(409).json({ ok: false, code: 'SLOT_UNAVAILABLE', error: 'Questo orario è già passato. Scegline un altro.' });
  }

  let event;
  try {
    if (!(await rangeIsFree(date, slot.start, slot.end))) {
      return res.status(409).json({ ok: false, code: 'SLOT_UNAVAILABLE', error: 'Questo orario è appena stato occupato. Scegline un altro.' });
    }
    event = await createEvent({
      type: 'booking',
      date,
      start: slot.start,
      end: slot.end,
      summary: `✂️ Taglio – ${name}`,
      description: [
        'Prenotazione online',
        `Cliente: ${name}`,
        `Telefono: ${phone}`,
        email ? `Email: ${email}` : null,
        `Note: ${notes || 'nessuna'}`,
      ].filter(Boolean).join('\n'),
    });
  } catch (error) {
    console.error('Errore Google Calendar:', error);
    return res.status(502).json({ ok: false, error: 'Non è stato possibile registrare la prenotazione. Riprova o chiamaci.' });
  }

  const summary = `${date} alle ${slot.start} (fino alle ${slot.end})`;
  if (process.env.SALON_EMAIL) {
    await sendEmail({
      to: [process.env.SALON_EMAIL],
      subject: `Nuova prenotazione · ${name} · ${date} ${slot.start}`,
      text: `Nuova prenotazione taglio\n\nCliente: ${name}\nTelefono: ${phone}\n${email ? `Email: ${email}\n` : ''}Quando: ${summary}\nNote: ${notes || 'nessuna'}`,
    });
  }
  if (email) {
    await sendEmail({
      to: [email],
      subject: `Prenotazione confermata · ${date} ${slot.start}`,
      text: `Ciao ${name},\n\nla tua prenotazione per un taglio è registrata: ${summary}.\nSe non puoi venire, chiamaci per liberare l'orario.\n\nA presto!`,
    });
  }

  return res.status(200).json({ ok: true, eventId: event.id, date, start: slot.start, end: slot.end });
};
