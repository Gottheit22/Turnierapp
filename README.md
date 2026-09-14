# Tennis-Turnier – Web-App (Next.js + Firebase)

Gruppenphase, automatische Tabelle, Halbfinale und Finale – als echte Web-App,
die für alle mit dem Link live synchron ist (kein Login nötig).

## 1. Firebase-Projekt anlegen

1. In der [Firebase Console](https://console.firebase.google.com/) ein neues
   Projekt anlegen (kostenlos, kein Projekt-Limit wie bei Supabase).
2. Im Projekt: **Build → Firestore Database → Datenbank erstellen**.
   - Modus: "Im Testmodus starten" reicht zum Ausprobieren, aber wir setzen
     gleich eigene Regeln.
   - Region frei wählen (z. B. `eur3 (europe-west)`).
3. Unter **Firestore Database → Regeln** den Inhalt von `firestore.rules`
   einfügen und veröffentlichen. Das erlaubt offenen Lese-/Schreibzugriff nur
   auf das Turnier-Dokument (kein Passwort, wie gewünscht).
4. Eine Web-App registrieren: **Projektübersicht → Web-Symbol (</>) → App
   registrieren**. Firebase zeigt dir danach ein Konfigurationsobjekt mit
   `apiKey`, `authDomain`, `projectId` usw. – diese Werte brauchst du gleich
   für Vercel.

## 2. Code zu GitHub pushen

```bash
cd tennis-turnier-web
git init
git add .
git commit -m "Tennis-Turnier Web-App (Firebase)"
git branch -M main
git remote add origin https://github.com/DEIN-USERNAME/tennis-turnier-web.git
git push -u origin main
```

## 3. In Vercel deployen

1. In Vercel: **New Project → Import** und das eben gepushte GitHub-Repo
   auswählen.
2. Bei **Environment Variables** die sechs Werte aus der Firebase-Konfiguration
   eintragen (siehe `.env.local.example` für die Namen):
   - `NEXT_PUBLIC_FIREBASE_API_KEY`
   - `NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN`
   - `NEXT_PUBLIC_FIREBASE_PROJECT_ID`
   - `NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET`
   - `NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID`
   - `NEXT_PUBLIC_FIREBASE_APP_ID`
3. **Deploy** klicken. Nach ein bis zwei Minuten bekommst du eine
   `*.vercel.app`-URL.

## 4. Nutzen

Die fertige URL kannst du an alle Spielerinnen schicken – jede kann darüber
Ergebnisse eintragen, alle sehen den gleichen Stand live (dank Firestore
Realtime, ohne Neuladen der Seite).

**Hinweis zur Offenheit:** Da du dich für "kein Passwort" entschieden hast,
kann grundsätzlich jede Person mit dem Link auch Ergebnisse ändern oder den
"Zurücksetzen"-Button nutzen. Für ein privates Freundinnen-Turnier ist das in
der Regel unproblematisch – falls sich das später ändern soll, lassen sich
die Firestore-Regeln leicht auf ein einfaches Passwort oder einen geheimen
Link-Parameter umstellen.

## Lokal testen (optional)

```bash
npm install
cp .env.local.example .env.local   # Werte aus der Firebase-Konfiguration eintragen
npm run dev
```

Dann `http://localhost:3000` öffnen.
