const crypto = require('crypto');
const config = require('../salon.config.js');

const TIMEZONE = config.timezone || 'Europe/Rome';
const GOOGLE_SCOPE = 'https://www.googleapis.com/auth/calendar';
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const CALENDAR_API = 'https://www.googleapis.com/calendar/v3';

const OPEN_WEEKDAYS = config.openWeekdays;
const SHIFTS = config.shifts;
const SLOT_STEP = config.slotStep;
const BOOKING_DAYS_AHEAD = Number(process.env.BOOKING_DAYS_AHEAD || config.bookingDaysAhead || 60);
// Modalità demo: agenda finta in memoria, nessun collegamento a Google. Utile per presentare l'app.
const DEMO = /^(1|true|yes|si)$/i.test(String(process.env.DEMO_MODE || ''));

let tokenCache = { token: null, expiresAt: 0 };

function clean(value, max = 500) {
  return String(value ?? '').trim().slice(0, max);
}

function base64url(value) {
  return Buffer.from(value).toString('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}

function readBody(req) {
  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch { body = {}; }
  }
  return body || {};
}

function adminPin() {
  return String(process.env.ADMIN_PIN || (DEMO ? '1234' : ''));
}

function publicConfig() {
  const { owner, vatNumber, timezone, ...rest } = config;
  return { ...rest, owner, vatNumber, bookingDaysAhead: BOOKING_DAYS_AHEAD, demo: DEMO };
}

function findService(id) {
  return config.services.find(s => s.id === id) || null;
}

function googleConfig() {
  const clientEmail = clean(process.env.GOOGLE_CLIENT_EMAIL, 300);
  const calendarId = clean(process.env.GOOGLE_CALENDAR_ID, 500);
  const privateKey = String(process.env.GOOGLE_PRIVATE_KEY || '').replace(/\\n/g, '\n').trim();
  if (!clientEmail || !calendarId || !privateKey) throw new Error('Google Calendar non configurato su Vercel.');
  return { clientEmail, calendarId, privateKey };
}

async function getGoogleToken() {
  if (tokenCache.token && Date.now() < tokenCache.expiresAt - 60_000) return tokenCache.token;
  const { clientEmail, privateKey } = googleConfig();
  const now = Math.floor(Date.now() / 1000);
  const header = base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const payload = base64url(JSON.stringify({
    iss: clientEmail,
    scope: GOOGLE_SCOPE,
    aud: GOOGLE_TOKEN_URL,
    iat: now,
    exp: now + 3600,
  }));
  const unsigned = `${header}.${payload}`;
  const signature = crypto.createSign('RSA-SHA256').update(unsigned).end().sign(privateKey);
  const assertion = `${unsigned}.${base64url(signature)}`;

  const response = await fetch(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion,
    }),
  });
  const data = await response.json();
  if (!response.ok || !data.access_token) throw new Error(data.error_description || 'Autenticazione Google non riuscita.');
  tokenCache = { token: data.access_token, expiresAt: Date.now() + Number(data.expires_in || 3600) * 1000 };
  return tokenCache.token;
}

async function googleFetch(path, options = {}) {
  const token = await getGoogleToken();
  const response = await fetch(`${CALENDAR_API}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  });
  if (response.status === 204) return {};
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data?.error?.message || `Errore Google Calendar (${response.status}).`);
  return data;
}

function zonedTimeToUtcIso(date, time) {
  const [year, month, day] = date.split('-').map(Number);
  const [hour, minute] = time.split(':').map(Number);
  const target = Date.UTC(year, month - 1, day, hour, minute, 0);
  let guess = target;
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: TIMEZONE,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hourCycle: 'h23',
  });
  for (let i = 0; i < 3; i++) {
    const parts = Object.fromEntries(formatter.formatToParts(new Date(guess)).filter(p => p.type !== 'literal').map(p => [p.type, p.value]));
    const represented = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour), Number(parts.minute), Number(parts.second));
    const diff = target - represented;
    if (!diff) break;
    guess += diff;
  }
  return new Date(guess).toISOString();
}

function romeDate(iso) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TIMEZONE, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(iso));
}

function romeToday() {
  return romeDate(new Date().toISOString());
}

function addDays(date, days) {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function toMinutes(time) {
  const [h, m] = time.split(':').map(Number);
  return h * 60 + m;
}

function fromMinutes(minutes) {
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
}

function dateIsValid(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T12:00:00Z`));
}

function timeIsValid(value) {
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
}

function isOpenDay(date) {
  return OPEN_WEEKDAYS.includes(new Date(`${date}T12:00:00Z`).getUTCDay());
}

// Orari di inizio per un servizio: ogni SLOT_STEP minuti dall'apertura del turno,
// purché il servizio finisca entro la chiusura dello stesso turno.
function slotsForDate(date, duration = SLOT_STEP) {
  if (!isOpenDay(date)) return [];
  const slots = [];
  for (const [open, close] of SHIFTS) {
    for (let start = toMinutes(open); start + duration <= toMinutes(close); start += SLOT_STEP) {
      slots.push({ start: fromMinutes(start), end: fromMinutes(start + duration) });
    }
  }
  return slots;
}

function openingWindow() {
  return { start: SHIFTS[0][0], end: SHIFTS[SHIFTS.length - 1][1] };
}

function overlaps(aStart, aEnd, bStart, bEnd) {
  return new Date(aStart).getTime() < new Date(bEnd).getTime() && new Date(aEnd).getTime() > new Date(bStart).getTime();
}

function slotRange(date, slot) {
  return { start: zonedTimeToUtcIso(date, slot.start), end: zonedTimeToUtcIso(date, slot.end) };
}

function slotHasStarted(date, slot) {
  return Date.now() >= new Date(zonedTimeToUtcIso(date, slot.start)).getTime();
}

function isBookableDate(date) {
  const today = romeToday();
  return date >= today && date <= addDays(today, BOOKING_DAYS_AHEAD);
}

// ---------- Agenda demo in memoria ----------
const demoStore = { events: new Map(), seeded: new Set(), seq: 0 };
const DEMO_NAMES = ['Giulia R.', 'Marco B.', 'Sara L.', 'Luca M.', 'Francesca D.', 'Andrea P.', 'Chiara S.', 'Davide G.', 'Elena F.', 'Paolo C.', 'Martina V.', 'Simone T.'];

function demoRandom(seed) {
  let h = 2166136261;
  for (const c of seed) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return () => {
    h = Math.imul(h ^ (h >>> 15), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    return ((h ^= h >>> 16) >>> 0) / 4294967296;
  };
}

function demoAdd({ type, date, start, end, summary, description }) {
  const event = {
    id: `demo${++demoStore.seq}`,
    summary,
    description,
    start: { dateTime: zonedTimeToUtcIso(date, start) },
    end: { dateTime: zonedTimeToUtcIso(date, end) },
    extendedProperties: { private: { salonType: type } },
  };
  demoStore.events.set(event.id, event);
  return event;
}

function demoSeed(date) {
  if (demoStore.seeded.has(date)) return;
  demoStore.seeded.add(date);
  if (!isOpenDay(date)) return;
  const rand = demoRandom(date);
  for (const [open, close] of SHIFTS) {
    let cursor = toMinutes(open);
    while (cursor + SLOT_STEP <= toMinutes(close)) {
      const service = config.services[Math.floor(rand() * config.services.length)];
      const fits = cursor + service.duration <= toMinutes(close);
      if (fits && rand() < 0.3) {
        const name = DEMO_NAMES[Math.floor(rand() * DEMO_NAMES.length)];
        const phoneBooking = rand() < 0.35;
        demoAdd({
          type: phoneBooking ? 'phone' : 'booking',
          date,
          start: fromMinutes(cursor),
          end: fromMinutes(cursor + service.duration),
          summary: `${phoneBooking ? '📞' : '✂️'} ${service.name} – ${name}`,
          description: `${phoneBooking ? 'Prenotazione telefonica' : 'Prenotazione online'}\nServizio: ${service.name}\nCliente: ${name}\nTelefono: 333 000 0000\nNote: nessuna`,
        });
        cursor += Math.ceil(service.duration / SLOT_STEP) * SLOT_STEP;
      } else {
        cursor += SLOT_STEP;
      }
    }
  }
}

function demoEvents(startIso, endIso) {
  for (let d = addDays(romeDate(startIso), -1); d <= romeDate(endIso); d = addDays(d, 1)) demoSeed(d);
  return [...demoStore.events.values()]
    .filter(e => overlaps(startIso, endIso, e.start.dateTime, e.end.dateTime))
    .sort((a, b) => a.start.dateTime.localeCompare(b.start.dateTime));
}

// ---------- Accesso al calendario (Google o demo) ----------
async function getBusyWindows(startIso, endIso) {
  if (DEMO) return demoEvents(startIso, endIso).map(e => ({ start: e.start.dateTime, end: e.end.dateTime }));
  const { calendarId } = googleConfig();
  const data = await googleFetch('/freeBusy', {
    method: 'POST',
    body: JSON.stringify({ timeMin: startIso, timeMax: endIso, timeZone: TIMEZONE, items: [{ id: calendarId }] }),
  });
  return data?.calendars?.[calendarId]?.busy || [];
}

async function listEvents(startIso, endIso) {
  if (DEMO) return demoEvents(startIso, endIso);
  const { calendarId } = googleConfig();
  const query = new URLSearchParams({ timeMin: startIso, timeMax: endIso, singleEvents: 'true', orderBy: 'startTime', maxResults: '250' });
  const data = await googleFetch(`/calendars/${encodeURIComponent(calendarId)}/events?${query}`);
  return data.items || [];
}

// type: 'booking' (online), 'phone' (inserita dal salone), 'block' (orario bloccato)
async function createEvent({ type, date, start, end, summary, description }) {
  if (DEMO) {
    demoSeed(date);
    return demoAdd({ type, date, start, end, summary, description });
  }
  const { calendarId } = googleConfig();
  return googleFetch(`/calendars/${encodeURIComponent(calendarId)}/events?sendUpdates=none`, {
    method: 'POST',
    body: JSON.stringify({
      summary,
      description,
      start: { dateTime: `${date}T${start}:00`, timeZone: TIMEZONE },
      end: { dateTime: `${date}T${end}:00`, timeZone: TIMEZONE },
      transparency: 'opaque',
      colorId: type === 'block' ? '8' : type === 'phone' ? '5' : '2',
      extendedProperties: { private: { salonType: type } },
    }),
  });
}

async function getEvent(eventId) {
  if (DEMO) {
    const event = demoStore.events.get(eventId);
    if (!event) throw new Error('Evento non trovato.');
    return event;
  }
  const { calendarId } = googleConfig();
  return googleFetch(`/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`);
}

async function deleteEvent(eventId) {
  if (DEMO) return demoStore.events.delete(eventId);
  const { calendarId } = googleConfig();
  return googleFetch(`/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}?sendUpdates=none`, { method: 'DELETE' });
}

async function rangeIsFree(date, start, end) {
  const startIso = zonedTimeToUtcIso(date, start);
  const endIso = zonedTimeToUtcIso(date, end);
  const busy = await getBusyWindows(startIso, endIso);
  return !busy.some(window => overlaps(startIso, endIso, window.start, window.end));
}

async function sendEmail(payload) {
  if (DEMO || !process.env.RESEND_API_KEY) return false;
  try {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: process.env.RESEND_FROM_EMAIL || `${config.name} <onboarding@resend.dev>`, ...payload }),
    });
    if (!response.ok) console.error('Errore Resend:', response.status, await response.text());
    return response.ok;
  } catch (error) {
    console.error('Errore invio email:', error);
    return false;
  }
}

module.exports = {
  config,
  DEMO,
  TIMEZONE,
  SLOT_STEP,
  clean,
  readBody,
  adminPin,
  publicConfig,
  findService,
  zonedTimeToUtcIso,
  romeToday,
  addDays,
  toMinutes,
  fromMinutes,
  dateIsValid,
  timeIsValid,
  isOpenDay,
  slotsForDate,
  openingWindow,
  overlaps,
  slotRange,
  slotHasStarted,
  isBookableDate,
  getBusyWindows,
  listEvents,
  createEvent,
  getEvent,
  deleteEvent,
  rangeIsFree,
  sendEmail,
};
