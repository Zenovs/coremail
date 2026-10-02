<p align="center">
<pre>
  ██████╗ ██████╗ ██████╗ ███████╗███╗   ███╗ █████╗ ██╗██╗
 ██╔════╝██╔═══██╗██╔══██╗██╔════╝████╗ ████║██╔══██╗██║██║
 ██║     ██║   ██║██████╔╝█████╗  ██╔████╔██║███████║██║██║
 ██║     ██║   ██║██╔══██╗██╔══╝  ██║╚██╔╝██║██╔══██║██║██║
 ╚██████╗╚██████╔╝██║  ██║███████╗██║ ╚═╝ ██║██║  ██║██║███████╗
  ╚═════╝ ╚═════╝ ╚═╝  ╚═╝╚══════╝╚═╝     ╚═╝╚═╝  ╚═╝╚═╝╚══════╝
                  D e s k t o p   E - M a i l   C l i e n t
</pre>
</p>

<p align="center">
  <img src="assets/icon.png" width="96" height="96" alt="CoreMail Desktop">
</p>

<p align="center">
  <strong>Lightweight open-source email client for Linux, Windows &amp; macOS — IMAP/SMTP + Microsoft 365</strong>
</p>

<p align="center">
  <a href="https://github.com/Zenovs/coremail/releases/latest">
    <img src="https://img.shields.io/github/v/release/Zenovs/coremail?label=Release&color=06b6d4" alt="Release">
  </a>
  <a href="LICENSE">
    <img src="https://img.shields.io/badge/License-MIT-green.svg" alt="MIT License">
  </a>
  <img src="https://img.shields.io/badge/Platform-Linux%20%7C%20Windows%20%7C%20macOS-6366f1" alt="Platform">
  <img src="https://img.shields.io/badge/Electron-28-47848f?logo=electron" alt="Electron">
  <img src="https://img.shields.io/badge/Built%20with-React%2018-61dafb?logo=react" alt="React">
</p>

<p align="center">
  🌐 <a href="https://coremail.ch"><strong>coremail.ch</strong></a> · 📦 <a href="https://github.com/Zenovs/coremail/releases/latest">Releases</a> · 🐛 <a href="https://github.com/Zenovs/coremail/issues">Issues</a>
</p>

---

## What is CoreMail?

CoreMail Desktop ist ein **freier, schlanker E-Mail-Client** für **Linux, Windows und macOS**, gebaut mit Electron und React. Unterstützt IMAP/SMTP-Server und **Microsoft 365 / Exchange via OAuth2** (kein App-Passwort nötig). Schnell, lokal, ohne Cloud-Tracking — und ressourcenschonend genug für den Raspberry Pi.

**Key Highlights:**
- **Multi-Plattform** — Linux (AppImage, .deb, .rpm), Windows, macOS
- **Mehrere Konten parallel** — IMAP/SMTP + Microsoft 365 Graph API
- **Volltextsuche** mit SQLite/FTS5 — findet jede Mail in <50 ms, auch offline
- **List-Unsubscribe** — One-Click-Abmeldung von Newslettern (RFC 8058)
- **Mehrere Signaturen pro Konto** — Standard wählbar, Picker beim Verfassen
- **Lokaler Spam-Filter** mit Phishing/Virus-Erkennung — rein heuristisch
- **Carbon Design System Icons** — einheitliche, monochrome UI
- **11 Themes** (Dark, Light, Glas, Retro, Foundations, …)
- **Tracking-Pixel-Schutz** — externe Bilder werden default geblockt
- **Raspberry Pi 4/5 (arm64)** Support

---

## ⚡ Installation

### 🐧 Linux (Empfohlen — One-Liner)

Wähle deine Architektur und füge den Befehl ins Terminal ein — das Script lädt CoreMail herunter, installiert Icons und erstellt einen Desktop-Eintrag.

#### 🖥️ x64 — Standard-PC / Laptop

```bash
curl -sSL https://raw.githubusercontent.com/Zenovs/coremail/initial-code/install.sh | bash -s -- --x64
```

#### 🍓 arm64 — Raspberry Pi 4/5 (64-bit OS)

```bash
curl -sSL https://raw.githubusercontent.com/Zenovs/coremail/initial-code/install.sh | bash -s -- --arm64
```

> Nicht sicher? `uname -m` im Terminal: `x86_64` → x64, `aarch64` → arm64.

### 🪟 Windows

[**Setup-Programm herunterladen**](https://github.com/Zenovs/coremail/releases/latest) (.exe für x64) — beim ersten Start warnt SmartScreen wegen unsigniertem Build → „Weitere Informationen" → „Trotzdem ausführen". [Anleitung](docs/UNSIGNED-BUILDS.md).

### 🍎 macOS

[**DMG herunterladen**](https://github.com/Zenovs/coremail/releases/latest) — wähle `arm64.dmg` (Apple Silicon, M1+) oder `x64.dmg` (Intel). Beim ersten Start blockiert Gatekeeper → Systemeinstellungen → Datenschutz &amp; Sicherheit → „Dennoch öffnen". [Anleitung](docs/UNSIGNED-BUILDS.md).

---

### Direkter Download

Alle Pakete im aktuellsten Release: [github.com/Zenovs/coremail/releases/latest](https://github.com/Zenovs/coremail/releases/latest)

| Plattform | Format | Architektur |
|---|---|---|
| 🐧 Linux | `.AppImage` (universal) | x64, arm64 |
| 🐧 Linux (Debian/Ubuntu) | `.deb` | x64, arm64 |
| 🐧 Linux (Fedora/RHEL) | `.rpm` | x64, arm64 |
| 🪟 Windows | `.exe` (NSIS-Installer) | x64 |
| 🍎 macOS | `.dmg` | x64 (Intel), arm64 (Apple Silicon) |

> Jedes Release enthält zusätzlich `SHA256SUMS.txt` — die In-App-Update-Funktion verifiziert ab v6.2.0 automatisch.

---

## 🔄 Update

**Linux**: Installations-Script erkennt eine bestehende Installation und aktualisiert sie:

```bash
curl -sSL https://raw.githubusercontent.com/Zenovs/coremail/initial-code/install.sh | bash -s -- --x64
# oder --arm64 für Raspberry Pi
```

**Windows / macOS**: In-App-Update beim Start oder manuell unter **Einstellungen → Updates**.

> Einstellungen, Konten und Daten bleiben beim Update erhalten.

---

## 🗑️ Deinstallation (Linux)

```bash
pkill -9 -f coremail ; pkill -9 -f CoreMail ; sleep 1 ; \
rm -rf \
  ~/.local/bin/coremail* \
  ~/.local/bin/CoreMail* \
  ~/.local/share/applications/coremail* \
  ~/.local/share/applications/CoreMail* \
  ~/.local/share/icons/hicolor/*/apps/coremail* \
  ~/.local/share/icons/hicolor/*/apps/CoreMail* \
  ~/.local/share/pixmaps/coremail* \
  ~/.local/share/pixmaps/CoreMail* \
  ~/.config/coremail* \
  ~/.config/CoreMail* \
  /usr/share/applications/coremail* \
  /usr/share/applications/CoreMail* \
  2>/dev/null ; \
gtk-update-icon-cache -f ~/.local/share/icons/hicolor 2>/dev/null ; \
update-desktop-database ~/.local/share/applications 2>/dev/null ; \
echo "CoreMail wurde komplett entfernt!"
```

> **Bei .deb/.rpm-Installation**: `sudo apt remove coremail-desktop` bzw. `sudo rpm -e coremail-desktop`.

---

## ✨ Funktionen

### 📬 E-Mail &amp; Konten
- **Mehrere Konten gleichzeitig** — beliebig viele IMAP/SMTP-Konten
- **Microsoft Exchange / Microsoft 365** — OAuth2-Login via Microsoft Graph API, kein App-Passwort nötig
- **Hostpoint &amp; Bluewin** — vorkonfigurierte Vorlagen
- **Split-View** — Mailliste und Vorschau nebeneinander, alle Spalten verstellbar
- **Inline-Antwort** — direkt in der Vorschau antworten, ohne Seitenwechsel
- **Allen antworten &amp; Weiterleiten** — inkl. CC/BCC-Unterstützung
- **Ordner-Navigation** — alle IMAP-Ordner durchsuchen, erstellen, umbenennen, löschen
- **Tag-Eingabe für Empfänger** — An/CC/BCC als einzelne Chips
- **Hintergrund-Sync** — automatischer Mail-Abruf alle 1–30 Min konfigurierbar
- **Profil übertragen** — Konten, Kategorien und Signaturen in eine verschlüsselte Datei exportieren und auf einem neuen Rechner importieren; Datei und Einmal-Passwort sind nur 5 Minuten gültig und nur einmal verwendbar

### 🔍 Volltextsuche (FTS5)
- **Lokaler Index** mit SQLite + FTS5 — alle abgerufenen Mails sind sofort durchsuchbar
- **Suche unter 50 ms** auch über zehntausende Mails
- **Funktioniert offline** — kein Server-Roundtrip nötig
- **Hybrid**: Erst lokaler Index, dann zusätzliche Server-Suche im Hintergrund (für ältere Mails)
- **`Ctrl+K`** öffnet die globale Suche

### 📎 Anhänge
- **Speichern** — Anhang direkt in den Download-Ordner
- **Öffnen** — speichern und sofort mit der Standard-Anwendung öffnen
- **Alle herunterladen** — alle Anhänge einer Mail auf einmal
- **Vorschau** — Bilder und PDFs direkt in der App
- **Drag &amp; Drop** — Dateien direkt ins Compose-Fenster ziehen
- **Anhänge in der Inline-Antwort** — per „Anhang“-Knopf, Drag &amp; Drop oder Einfügen (Ctrl+V)

### 🛡️ Spam-Schutz &amp; Kategorisierung
- **Automatischer Spam-Filter** — Werbung, Phishing, Schadsoftware (heuristisch, ohne KI)
- **Manuelle Kategorien** — Werbung / Spam / Schädlich / Virus / Vertrauenswürdig
- **Absender-Regeln** — neue Mails vom gleichen Absender werden automatisch kategorisiert
- **Absender-Verwaltung** — alle kategorisierten Absender in einer Übersicht (Import/Export)
- **List-Unsubscribe-Button** — RFC 8058 One-Click-Abmeldung von Newslettern direkt aus der Mail

### ✏️ Verfassen
- **Rich-Text-Editor** mit Formatierungs-Toolbar (Fett, Kursiv, Listen, Ausrichtung)
- **HTML-Quellcode-Modus** und **Vorschau**
- **HTML-Vorlagen** — Leer, Formeller Brief, Newsletter, Angebot, eigenes HTML
- **Mehrere Signaturen pro Konto** — Standard markierbar, Picker beim Verfassen
- **Anhänge** — per Dateiauswahl oder Drag &amp; Drop
- **Zeitversetztes Senden** — Mail zu einem bestimmten Zeitpunkt versenden
- **Entwurf-Autosave** — Entwürfe werden alle 10 Sekunden gespeichert
- **Undo Send** — kurze Verzögerung nach dem Senden mit Abbruch-Möglichkeit

### 📅 Kalender &amp; Einladungen
- **Microsoft 365 Kalender** — Termine ansehen, erstellen und bearbeiten
- Direkte Integration mit Microsoft Graph
- **Meeting-Einladungen lesbar** — Titel, Zeitraum, Ort, Organisator und Teilnehmerliste stehen direkt über der Mail, statt als namenloser Anhang
- **Zusagen, Vorbehalt, Absagen** — mit einem Klick aus der Mail heraus (Microsoft 365)
- **In den Kalender übernehmen** — Einladungen aus `.ics`-Dateien landen im M365-Kalender
- **Kalenderdatei öffnen** — `.ics` speichern oder direkt ans Kalender-Programm übergeben (auch bei IMAP-Konten)
- **Online-Meetings** — Teams-, Zoom-, Meet- und Webex-Links werden erkannt und direkt angeboten
- **Serientermine und Absagen** werden als solche gekennzeichnet

### 🎨 Design &amp; Darstellung
- **Carbon Design System Icons** — einheitliches, professionelles Erscheinungsbild
- **11 Themes**: Dark, Light, Minimal, Morphismus, Glas, Retro, Foundations, Lollipop, Nerd, Colorful, Indie
- **Dynamische App-Icons** — passen sich automatisch ans Theme an
- **Schriftart-Auswahl** — Google Fonts direkt in den Einstellungen
- **Anpassbare Spaltenbreiten** — per Drag
- **CSS-Isolation** — E-Mail-CSS beeinflusst niemals die App-Oberfläche

### 🌍 Übersetzung
- **Integrierte Mail-Übersetzung** — E-Mails in deine Sprache übersetzen lassen

### 📋 Logbuch
- **Vollständiges Ereignisprotokoll** — alle App-Aktionen nachvollziehbar
- Hilft bei der Diagnose von Verbindungs- und Synchronisierungsproblemen
- Export als JSON

### 🔄 Updates
- Automatische Update-Prüfung beim Start
- Ein-Klick-Update direkt im Client
- **SHA-256-Hash-Verifikation** des heruntergeladenen Builds (gegen `SHA256SUMS.txt`)
- Backup vor jedem Update — Rollback möglich

---

## 📡 Unterstützte Anbieter

| Anbieter | Protokoll | Hinweis |
|---|---|---|
| Microsoft Exchange / Microsoft 365 | Graph API (OAuth2) | Kein App-Passwort nötig |
| Hostpoint | IMAP/SMTP | Vorlage vorhanden |
| Bluewin | IMAP/SMTP | Vorlage vorhanden |
| Gmail | IMAP/SMTP | App-Passwort erforderlich |
| iCloud | IMAP/SMTP | App-Passwort erforderlich |
| Yahoo / GMX / WEB.DE | IMAP/SMTP | — |
| Jeder IMAP/SMTP-Server | IMAP/SMTP | Benutzerdefiniert |

---

## 🔒 Datenschutz &amp; Sicherheit

| | |
|---|---|
| ✅ | Alle Daten bleiben **lokal** auf deinem Computer |
| ✅ | **Keine Telemetrie**, kein Tracking, keine Analytics |
| ✅ | Verbindet sich ausschliesslich mit deinen eigenen E-Mail-Servern |
| ✅ | **Keine externen KI-/Cloud-Dienste** — alles offline |
| ✅ | Kontodaten **AES-verschlüsselt** gespeichert (auf macOS/Linux mit OS-Keyring via `safeStorage`) |
| ✅ | **Strict TLS-Validierung** für IMAP/SMTP — Self-Signed nur per Opt-in |
| ✅ | **DOMPurify-Sanitisierung** für HTML-Mails — XSS-sicher |
| ✅ | **Tracking-Pixel-Schutz** — externe Bilder default geblockt |
| ✅ | **Content-Security-Policy** für den Renderer |
| ✅ | **Update-Hash-Verifikation** mit SHA-256-Manifest |
| ✅ | Open Source — vollständig einsehbarer Code |

---

## 🔧 Systemanforderungen

| Plattform | Anforderung |
|---|---|
| **Linux** | x64 / arm64 · Kernel 4.x+ · GTK 3 |
| **Windows** | 10 / 11 · x64 |
| **macOS** | 11 (Big Sur) oder neuer · Intel oder Apple Silicon |
| **Speicher** | ~200 MB Disk · 512 MB RAM |
| **CPU** | Beliebig — auch Raspberry Pi 4/5 |

> Da CoreMail Desktop keine KI-Komponenten enthält, läuft die App auch auf sehr ressourcenarmen Geräten flüssig.

---

## 🛠️ Aus Quellcode bauen

```bash
git clone https://github.com/Zenovs/coremail.git
cd coremail
npm install
npm run dev      # Entwicklungsmodus
npm run build    # Build für aktuelle Plattform
```

### Plattform-spezifische Builds

```bash
# Linux: AppImage + deb + rpm (x64 + arm64)
./node_modules/.bin/electron-builder --linux --x64 --arm64

# Nur Linux AppImage x64
./node_modules/.bin/electron-builder --linux appimage --x64

# Windows NSIS-Installer (auf Linux/macOS via Wine, oder native auf Windows)
./node_modules/.bin/electron-builder --win --x64

# macOS DMG (nur auf macOS)
./node_modules/.bin/electron-builder --mac --x64 --arm64
```

> Multi-OS-Builds werden im CI über GitHub Actions ([release.yml](.github/workflows/release.yml)) auf einer Job-Matrix mit Ubuntu/Windows/macOS-Runnern parallel gebaut.

---

## 📦 Flatpak (experimentell)

Manifest in [`flatpak/`](flatpak/) — siehe [docs/FLATPAK.md](docs/FLATPAK.md) für die Flathub-Veröffentlichung.

---

## 🤝 Contributing

Beiträge sind willkommen!

1. **Fork** das Repository
2. **Branch** erstellen: `git checkout -b feature/meine-funktion`
3. **Änderungen committen**: `git commit -m 'Add: neue Funktion'`
4. **Push**: `git push origin feature/meine-funktion`
5. **Pull Request** öffnen

Für grössere Änderungen bitte zuerst ein **Issue** öffnen, um die Richtung abzustimmen.

**Bug melden:** [Issues öffnen](https://github.com/Zenovs/coremail/issues)

---

## 📄 Lizenz

Dieses Projekt steht unter der **MIT-Lizenz** — see [LICENSE](LICENSE) for details.

Frei verwendbar, modifizierbar und weitergebbar — auch kommerziell.

---

<p align="center">
  <strong>CoreMail Desktop</strong> · Open-Source-E-Mail-Client für Linux, Windows &amp; macOS<br>
  <small>powered by wireon</small>
</p>
