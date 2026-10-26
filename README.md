# Prenotazioni parrucchiere

Sito di prenotazione tagli collegato a Google Calendar, con pannello per il salone.

## Funzioni
- **Pagina clienti** (`/`): calendario mensile con disponibilità, scelta dell'orario, prenotazione con nome e telefono (email facoltativa).
- **Orari**: aperto dal martedì al sabato, 9:00–13:00 e 14:00–20:00. Domenica e lunedì chiuso.
- **Slot da 40 minuti**: mattina 9:00, 9:40, 10:20, 11:00, 11:40, 12:20; pomeriggio 14:00, 14:40 … 19:20.
- **Area salone** (`/admin`, protetta da PIN):
  - vista giornaliera di tutti gli slot (libero / online / telefono / bloccato / evento Google);
  - **📞 Prenota**: inserisce un appuntamento preso al telefono;
  - **🔒 Blocca / 🔓 Sblocca** un singolo orario, oppure più orari selezionati in una volta;
  - **Blocca intervallo** con orario libero (es. 15:10–16:30) e motivo;
  - **Chiudi tutto il giorno** (ferie, festività);
  - annullamento degli appuntamenti.
- Tutto vive su **Google Calendar**: qualsiasi evento presente nel calendario (anche inserito a mano da un collega) rende l'orario non prenotabile.

Gli orari sono definiti in `api/_lib.js` (`OPEN_WEEKDAYS`, `SHIFTS`, `SLOT_MINUTES`).

## Configurazione Google Calendar
1. Crea un calendario dedicato al salone su Google Calendar.
2. Su Google Cloud crea un progetto, abilita la **Google Calendar API** e crea un **service account** con una chiave JSON.
3. Nelle impostazioni del calendario → *Condividi con persone specifiche* aggiungi l'email del service account con permesso **"Apportare modifiche agli eventi"**.
4. **Dipendenti**: condividi lo stesso calendario con il loro account Google (permesso "Apportare modifiche agli eventi" se devono gestirlo, "Visualizzare tutti i dettagli" se devono solo vederlo). Vedranno tutte le prenotazioni dal telefono nell'app Google Calendar.
5. Copia l'ID del calendario (*Integra calendario → ID calendario*).

## Deploy su Vercel
Importa questo repository su Vercel (nessuna impostazione di build da cambiare) e imposta le variabili di `.env.example`:
`GOOGLE_CLIENT_EMAIL`, `GOOGLE_PRIVATE_KEY`, `GOOGLE_CALENDAR_ID`, `ADMIN_PIN` (obbligatorie), `RESEND_API_KEY`, `RESEND_FROM_EMAIL`, `SALON_EMAIL` (facoltative, per le email di conferma).

## Avvio locale
```bash
npx vercel dev
```
