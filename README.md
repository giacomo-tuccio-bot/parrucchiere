# Prenotazioni parrucchiere

Sito del salone con prenotazione online collegata a Google Calendar e agenda per lo staff.

## Funzioni
- **Sito del salone** (`/`): presentazione, listino servizi con durata e prezzo, contatti, mappa, orari, pulsante WhatsApp.
- **Prenotazione online**: il cliente sceglie servizio → giorno → orario e lascia nome e telefono (email facoltativa per la conferma). Gli orari disponibili dipendono dalla durata del servizio.
- **Agenda salone** (`/admin`, protetta da PIN, installabile sul telefono come app):
  - vista del giorno: libero / online / telefono / bloccato / evento Google;
  - **📞 Prenota**: appuntamenti presi al telefono, con scelta del servizio;
  - **🔒 Blocca / 🔓 Sblocca** orari singoli o multipli, intervalli liberi (es. 15:10–16:30) e giornate intere;
  - annullamento appuntamenti.
- **Google Calendar condiviso**: tutto finisce nel calendario del salone, che si condivide con i dipendenti. Gli eventi inseriti a mano su Google rendono l'orario non prenotabile.
- **Privacy** (`/privacy`): informativa GDPR e consenso obbligatorio alla prenotazione.
- **Email** facoltative (Resend): avviso al salone e conferma al cliente.
- **Modalità demo**: agenda di esempio senza Google, per presentare l'app.

## Personalizzare per un salone
Tutto è in **`salon.config.js`**: nome, testi, contatti, colori, giorni e turni di apertura, intervallo tra gli appuntamenti, servizi (nome, durata, prezzo), dati per la privacy.

## Configurazione Google Calendar
1. Crea un calendario dedicato al salone su Google Calendar.
2. Su Google Cloud crea un progetto, abilita la **Google Calendar API** e crea un **service account** con una chiave JSON.
3. Nelle impostazioni del calendario → *Condividi con persone specifiche* aggiungi l'email del service account con permesso **"Apportare modifiche agli eventi"**.
4. **Dipendenti**: condividi lo stesso calendario con il loro account Google ("Apportare modifiche agli eventi" se devono gestirlo, "Visualizzare tutti i dettagli" se devono solo vederlo).
5. Copia l'ID del calendario (*Integra calendario → ID calendario*).

## Deploy su Vercel
Importa il repository su Vercel e imposta le variabili di `.env.example`:
- demo: solo `DEMO_MODE=1` (PIN `1234`);
- produzione: `GOOGLE_CLIENT_EMAIL`, `GOOGLE_PRIVATE_KEY`, `GOOGLE_CALENDAR_ID`, `ADMIN_PIN`; facoltative `RESEND_API_KEY`, `RESEND_FROM_EMAIL`, `SALON_EMAIL`.

## Avvio locale
```bash
DEMO_MODE=1 npx vercel dev
```
