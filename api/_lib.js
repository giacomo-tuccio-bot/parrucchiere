const crypto = require('crypto');

const TIMEZONE = 'Europe/Rome';
const GOOGLE_SCOPE = 'https://www.googleapis.com/auth/calendar';
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const CALENDAR_API = 'https://www.googleapis.com/calendar/v3';

// Orari del salone: aperto dal martedì (2) al sabato (6), domenica e lunedì chiuso.
const OPEN_WEEKDAYS = [2, 3, 4, 5, 6];
const SHIFTS = [['09:00', '13:00'], ['14:00', '20:00']];
const SLOT_MINUTES = 40;
const BOOKING_DAYS_AHEAD = Number(process.env.BOOKING_DAYS_AHEAD || 60);

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

function romeToday() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TIMEZONE, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
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

// 09:00, 09:40 … 12:20 e 14:00, 14:40 … 19:20: ogni slot finisce entro la chiusura del turno.
function slotsForDate(date) {
  if (!isOpenDay(date)) return [];
  const slots = [];
  for (const [open, close] of SHIFTS) {
    for (let start = toMinutes(open); start + SLOT_MINUTES <= toMinutes(close); start += SLOT_MINUTES) {
      slots.push({ start: fromMinutes(start), end: fromMinutes(start + SLOT_MINUTES) });
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

async function getBusyWindows(startIso, endIso) {
  const { calendarId } = googleConfig();
  const data = await googleFetch('/freeBusy', {
    method: 'POST',
    body: JSON.stringify({ timeMin: startIso, timeMax: endIso, timeZone: TIMEZONE, items: [{ id: calendarId }] }),
  });
  return data?.calendars?.[calendarId]?.busy || [];
}

async function listEvents(startIso, endIso) {
  const { calendarId } = googleConfig();
  const query = new URLSearchParams({ timeMin: startIso, timeMax: endIso, singleEvents: 'true', orderBy: 'startTime', maxResults: '250' });
  const data = await googleFetch(`/calendars/${encodeURIComponent(calendarId)}/events?${query}`);
  return data.items || [];
}

// type: 'booking' (online), 'phone' (inserita dal salone), 'block' (orario bloccato)
async function createEvent({ type, date, start, end, summary, description }) {
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
  const { calendarId } = googleConfig();
  return googleFetch(`/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`);
}

async function deleteEvent(eventId) {
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
  if (!process.env.RESEND_API_KEY) return false;
  try {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: process.env.RESEND_FROM_EMAIL || 'Salone <onboarding@resend.dev>', ...payload }),
    });
    if (!response.ok) console.error('Errore Resend:', response.status, await response.text());
    return response.ok;
  } catch (error) {
    console.error('Errore invio email:', error);
    return false;
  }
}

module.exports = {
  TIMEZONE,
  SLOT_MINUTES,
  SHIFTS,
  clean,
  readBody,
  googleConfig,
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
