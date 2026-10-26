// Configurazione del salone: per un nuovo cliente basta modificare questo file.
module.exports = {
  name: 'Il Salone',
  tagline: 'Prenota il tuo appuntamento in pochi secondi',
  description: 'Scegli il servizio, il giorno e l\'orario: la prenotazione finisce subito nella nostra agenda.',
  // Contatti (lascia vuoto quello che non serve)
  address: 'Via Roma 1, Città',
  mapsUrl: '',
  phone: '',
  whatsapp: '', // es. 393331234567 (con prefisso, senza +)
  email: '',
  instagram: '', // es. ilsalone

  // Dati per la privacy policy
  owner: 'Il Salone di Nome Cognome',
  vatNumber: '',

  colors: {
    accent: '#b0884f',
    accentDark: '#8f6b38',
    dark: '#1d1b19',
  },

  timezone: 'Europe/Rome',
  // 0 = domenica … 6 = sabato. Aperto dal martedì al sabato.
  openWeekdays: [2, 3, 4, 5, 6],
  shifts: [['09:00', '13:00'], ['14:00', '20:00']],
  // Gli appuntamenti iniziano ogni 40 minuti dall'apertura di ogni turno.
  slotStep: 40,
  bookingDaysAhead: 60,

  // Durata in minuti. Il prezzo è solo informativo (lascia '' per nasconderlo).
  services: [
    { id: 'taglio', name: 'Taglio', duration: 40, price: 'da 15 €' },
    { id: 'taglio-piega', name: 'Taglio + piega', duration: 80, price: 'da 30 €' },
    { id: 'piega', name: 'Piega', duration: 40, price: 'da 15 €' },
    { id: 'colore', name: 'Colore + piega', duration: 120, price: 'da 45 €' },
    { id: 'barba', name: 'Barba', duration: 40, price: 'da 10 €' },
  ],
};
