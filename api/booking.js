const {
  config, clean, readBody, dateIsValid, slotsForDate, slotHasStarted, isBookableDate,
  rangeIsFree, createEvent, sendEmail, findService,
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
  const service = findService(clean(body.service, 40));

  if (!service) return res.status(400).json({ ok: false, error: 'Scegli un servizio.' });
  if (!name || !phone || !date || !time) return res.status(400).json({ ok: false, error: 'Compila nome, telefono, giorno e orario.' });
  if (phone.replace(/\D/g, '').length < 9) return res.status(400).json({ ok: false, error: 'Numero di telefono non valido.' });
  if (email && !/^\S+@\S+\.\S+$/.test(email)) return res.status(400).json({ ok: false, error: 'Email non valida.' });
  if (body.privacy !== true && body.privacy !== 'on') return res.status(400).json({ ok: false, error: 'Per prenotare devi accettare l\'informativa privacy.' });
  if (!dateIsValid(date) || !isBookableDate(date)) return res.status(400).json({ ok: false, error: 'Giorno non prenotabile.' });

  const slot = slotsForDate(date, service.duration).find(s => s.start === time);
  if (!slot) return res.status(400).json({ ok: false, error: 'Orario non disponibile per questo servizio.' });
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
      summary: `✂️ ${service.name} – ${name}`,
      description: [
        'Prenotazione online',
        `Servizio: ${service.name}`,
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

  const when = `${date} dalle ${slot.start} alle ${slot.end}`;
  const salonEmail = process.env.SALON_EMAIL || config.email;
  if (salonEmail) {
    await sendEmail({
      to: [salonEmail],
      subject: `Nuova prenotazione · ${service.name} · ${name} · ${date} ${slot.start}`,
      text: `Nuova prenotazione\n\nServizio: ${service.name}\nCliente: ${name}\nTelefono: ${phone}\n${email ? `Email: ${email}\n` : ''}Quando: ${when}\nNote: ${notes || 'nessuna'}`,
    });
  }
  if (email) {
    await sendEmail({
      to: [email],
      subject: `Prenotazione confermata · ${config.name} · ${date} ${slot.start}`,
      text: `Ciao ${name},\n\nla tua prenotazione da ${config.name} è registrata.\n\nServizio: ${service.name}\nQuando: ${when}\n${config.address ? `Dove: ${config.address}\n` : ''}\nSe non puoi venire${config.phone ? `, chiamaci al ${config.phone}` : ', avvisaci'} per liberare l'orario.\n\nA presto!`,
    });
  }

  return res.status(200).json({ ok: true, eventId: event.id, date, start: slot.start, end: slot.end, service: service.name });
};
