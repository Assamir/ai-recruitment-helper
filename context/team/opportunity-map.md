# Opportunity Map

## Context

- **Project / context**: AI Recruitment Helper (zespół QA) — friction wokół review, raportowania regresji i analizy wyników testów
- **Data constraint**: mock / lokalne / read-only / nie-wrażliwe (na start); realne API Jira/Bitbucket dopiero po decyzji o dostępie
- **Date**: 2026-06-27

## Map

| Sygnał | Domyślna odpowiedź | Cienki komplement | Pierwsza wersja | Ryzyko danych | Kierunek |
|---|---|---|---|---|---|
| 1. Długie review w Bitbucket (obszerne PR-y) | Bitbucket diff/PR, komentarze, natywne AI | Digest PR-a: dotknięte pliki/endpointy, hotspoty ryzyka, kolejność czytania | Skrypt na eksporcie/mocku PR → raport „od czego zacząć review" | mock / read-only | Internal tool → Review/CI gate |
| 2. Czasochłonny tygodniowy raport regresji na Confluence | Ręczne sklejanie PR-ów (Bitbucket) + QA board (Jira) → Confluence | Agregator: zmerge'owane PR-y → endpointy + TC per serwis; statusy ticketów → jeden szkic raportu | Skrypt na eksportach (PR CSV/JSON + Jira CSV) → szkic markdown do wklejenia | mock / eksport read-only | Internal tool → report generator (później async/scheduled) |
| 3. Trudna analiza failów regresji (architekci nie potwierdzają bugów) | Raport CI + ręczny przegląd + czekanie na architekta | Triage-helper: grupowanie failów (serwis/endpoint/typ), kolejka „do potwierdzenia" | Skrypt na eksporcie wyników → pogrupowane faile + kolejka potwierdzeń | mock / read-only | Internal tool → Review/CI gate |

**Uwagi o złożoności:**
- Sygnał 1: część bólu *istotna* — duże PR-y to często kwestia procesu (mniejsze PR-y), nie narzędzia. Komplement skraca czytanie, nie rozmiar zmian.
- Sygnał 2: złożoność *przypadkowa* — ból wynika z ręcznego sklejania ≥3 źródeł; to dokładnie to, co komplement skraca.
- Sygnał 3: złożoność *istotna* — wąskie gardło to czas/decyzja architekta („czy fail = realny bug"). Narzędzie porządkuje, ale nie zastępuje decyzji.

## Recommended First Candidate

```text
Kandydat:
Regression Weekly Report Drafter

Czyta:
- Eksport zmerge'owanych PR-ów (CSV/JSON, mock) — dotknięte endpointy, zmiany w TC per serwis
- Eksport QA board (Jira CSV, mock) — statusy ticketów regresyjnych

Zwraca:
- Szkic raportu w markdown/tabeli: dotknięte serwisy/endpointy, liczba dodanych/zmienionych TC,
  zestawienie statusów ticketów — gotowy do wklejenia na Confluence

Nie robi (świadomie pominięte):
- Brak integracji live z API Bitbucket/Jira (na razie eksporty)
- Brak zapisu/publikacji bezpośrednio na Confluence
- Brak kontroli dostępu/audytu (dane mock/read-only)
- Brak oceny "czy to realny bug" (to Sygnał 3)

Ryzyko danych:
mock / eksport read-only. Zanim podłączysz realne API Jira/Bitbucket — najpierw ograniczenie
dostępu (read-only token, zakres projektu) i decyzja o tym, gdzie raport ląduje.

Kierunek, jeśli się sprawdzi:
internal tool → report generator; później async/scheduled (np. cotygodniowy auto-szkic).
```

## Why This Candidate

Sygnał 2 spełnia najwięcej kryteriów rankingu: powtarza się regularnie (co tydzień), łączy ≥3 źródła (Bitbucket, Jira, Confluence), ma wyraźny ręczny ból dziś, da się przetestować read-only na eksportach i komplementuje istniejące systemy zamiast je zastępować.

- **Vs Sygnał 1:** część bólu jest istotna (duże PR-y to często proces, nie narzędzie); wartość komplementu „miększa".
- **Vs Sygnał 3:** wąskie gardło to czas/decyzja architekta — narzędzie nie usuwa istotnej złożoności, więc ROI pierwszej wersji niższe i bardziej ryzykowne. Dobry *drugi* kandydat, jeśli #2 się przyjmie.

## Next Direction If Valuable

Wybrana ścieżka: **walidacja przed budową** — `/10x-mom-test` → (jeśli przetrwa) `/10x-shape` → `/10x-prd` → `/10x-roadmap`.

Najtańszy pierwszy krok: krótkie rozmowy z osobą tworzącą raport co tydzień i z jego odbiorcami (czy raport jest czytany i do czego używany) — zanim napiszemy linijkę kodu.
