# Backend einrichten (Firebase)

Diese Anleitung schaltet die App von „lokaler Demo-Modus" auf ein echtes
Backend um: **Registrierung/Login**, **Cloud-Speicherung** aller Daten
(Beispiele, Stiltexte, Logo, Exposé-Projekte) und optional einen
**Server-Proxy**, der Ihren Anthropic-API-Key sicher auf dem Server hält
(nie im Browser sichtbar).

Solange Sie diese Schritte nicht durchführen, läuft die App unverändert im
lokalen Demo-Modus weiter (Login akzeptiert jede Eingabe, Daten liegen nur
im Browser). Nichts bricht, wenn Sie das hier überspringen.

**Kosten:** Auth + Firestore + Storage sind im kostenlosen Firebase-Tier
("Spark") für die Nutzung durch einen Makler völlig ausreichend. Der
optionale Server-Proxy (Cloud Functions) benötigt den kostenpflichtigen
"Blaze"-Tarif (nutzungsbasiert, mit großzügigem kostenlosem Kontingent –
bei normaler Nutzung fällt in der Regel nichts oder nur ein sehr kleiner
Betrag an).

---

## 1. Firebase-Projekt anlegen

1. https://console.firebase.google.com öffnen → **„Projekt hinzufügen"**.
2. Namen vergeben (z. B. „expose-ki"), Google Analytics kann deaktiviert
   bleiben.

## 2. Anmeldung (Authentication) aktivieren

1. Im Projekt links **„Authentication"** → **„Get started"**.
2. Anbieter **„E-Mail/Passwort"** aktivieren.

## 3. Datenbank (Firestore) anlegen

1. Links **„Firestore Database"** → **„Datenbank erstellen"**.
2. Modus **„Produktionsmodus"** wählen, beliebige Region (z. B.
   `eur3 (europe-west)`).
3. Die Sicherheitsregeln werden gleich per Kommandozeile ersetzt (Schritt 6).

## 4. Datei-Speicher (Storage) aktivieren

1. Links **„Storage"** → **„Los geht's"**.
2. Produktionsmodus, gleiche Region wie Firestore.

## 5. Web-App registrieren (Zugangsdaten holen)

1. Projekt-Übersicht (Zahnrad oben links → **„Projekteinstellungen"**).
2. Unten bei **„Meine Apps"** → **„Web"**-Symbol (`</>`) → Namen vergeben
   (z. B. „Expose-KI-Web") → **„App registrieren"**.
3. Es erscheint ein Code-Block mit `firebaseConfig = { apiKey: "...", ... }`.
   Diese Werte im nächsten Schritt eintragen.

## 6. Firebase CLI installieren und Projekt verbinden

Auf Ihrem Rechner (im geklonten Repo-Ordner):

```bash
npm install -g firebase-tools
firebase login
firebase use --add        # das eben erstellte Projekt auswählen
```

## 7. Sicherheitsregeln deployen

Die Regeln liegen bereits im Repo (`firestore.rules`, `storage.rules`) –
sie sorgen dafür, dass **jeder Nutzer ausschließlich seine eigenen Daten**
lesen/schreiben kann.

```bash
firebase deploy --only firestore:rules,storage:rules
```

## 8. Zugangsdaten in GitHub hinterlegen

Diese Werte sind **nicht geheim** (öffentliche Web-Konfiguration), werden
aber als Repository-Variablen gepflegt, damit der automatische Deploy sie
in den Build einbetten kann.

1. Repo auf GitHub öffnen → **Settings → Secrets and variables → Actions**
   → Reiter **„Variables"** → **„New repository variable"**.
2. Für jeden Wert aus der `firebaseConfig` (Schritt 5) eine Variable anlegen:

   | Variablenname                          | Wert aus firebaseConfig |
   |-----------------------------------------|--------------------------|
   | `VITE_FIREBASE_API_KEY`                 | `apiKey`                 |
   | `VITE_FIREBASE_AUTH_DOMAIN`             | `authDomain`              |
   | `VITE_FIREBASE_PROJECT_ID`              | `projectId`               |
   | `VITE_FIREBASE_STORAGE_BUCKET`          | `storageBucket`           |
   | `VITE_FIREBASE_MESSAGING_SENDER_ID`     | `messagingSenderId`       |
   | `VITE_FIREBASE_APP_ID`                  | `appId`                  |

3. Reiter **„Actions"** → letzten Workflow-Lauf **„Re-run all jobs"**
   (oder einfach neu pushen).
4. Nach ~2 Minuten: Seite hart neu laden (Strg+F5). Die Login-Seite zeigt
   jetzt **„Jetzt registrieren"** statt des Demo-Hinweises → Backend ist aktiv.

Ab hier: Konto registrieren, anmelden – alle Daten landen jetzt in Firestore
und Storage statt nur im Browser.

---

## 9. (Empfohlen) Server-Proxy für den Anthropic-Key

Ohne diesen Schritt trägt jeder Makler seinen eigenen Anthropic-Key im
Datenbereich ein (er bleibt im Browser). Mit diesem Schritt läuft der
KI-Aufruf stattdessen über eine Cloud Function – der Schlüssel bleibt
serverseitig geheim.

**Voraussetzung:** Blaze-Tarif aktivieren (Firebase Console → unten links
„Auf Blaze upgraden"; erforderlich, da Cloud Functions ausgehende
Netzwerkaufrufe zu externen APIs nur im Blaze-Tarif erlauben).

```bash
cd functions
npm install
cd ..
firebase functions:secrets:set ANTHROPIC_API_KEY
# Ihren Anthropic-Key eingeben, wenn danach gefragt wird

firebase deploy --only functions
```

Nach dem Deploy zeigt die Konsole eine URL wie:
```
https://us-central1-<ihr-projekt>.cloudfunctions.net/anthropicProxy
```

Diese URL als weitere Repository-Variable hinterlegen:

| Variablenname       | Wert                                             |
|----------------------|---------------------------------------------------|
| `VITE_AI_PROXY_URL`  | die oben angezeigte Function-URL                  |

Danach wieder **Actions → Re-run all jobs**. Ab jetzt zeigt der
Datenbereich „Server-Proxy aktiv" – ein eigener API-Key ist für die Makler
nicht mehr nötig.

---

## Fehlerbehebung

- **Login-Seite zeigt weiterhin „Demo-Zugang"**: Die Repository-Variablen
  wurden nicht übernommen. Prüfen, ob der Workflow-Lauf (Actions-Tab) nach
  dem Setzen der Variablen erneut gelaufen ist, und hart neu laden.
- **„Missing or insufficient permissions"**: Sicherheitsregeln wurden noch
  nicht deployt (Schritt 7) oder der Nutzer ist nicht angemeldet.
- **Cloud Function „nicht erreichbar"**: Blaze-Tarif nicht aktiv, Secret
  nicht gesetzt, oder `VITE_AI_PROXY_URL` falsch/nicht neu deployt.
- **„Sitzung abgelaufen"** bei der KI-Analyse: Kurz ab- und wieder anmelden
  (Firebase-Sitzungstoken erneuert sich dabei).
