# Mom Test Validation Plan

## Input Idea

Walidacja rekomendowanego kandydata z `context/team/opportunity-map.md` — **Regression Weekly Report Drafter** (Sygnał 2): skrypt na eksportach (PR CSV/JSON + Jira CSV) generujący gotowy szkic tygodniowego raportu regresji do wklejenia na Confluence. Sygnały 1 (długie review) i 3 (analiza failów) pozostają jako tło — wracają, jeśli #2 nie przejdzie walidacji.

## Hypotheses

- **User/rola**: osoba (QA / QA lead?) tworząca co tydzień raport regresji na Confluence; odbiorcy raportu (kto czyta i po co — niepotwierdzone).
- **Friction**: ręczne sklejanie ≥3 źródeł (zmerge'owane PR-y w Bitbucket → dotknięte endpointy + zmiany TC per serwis; statusy ticketów na QA boardzie w Jira) w jeden raport.
- **Current workaround**: ręczne klikanie po PR-ach i boardzie, przepisywanie na Confluence.
- **Proposed solution**: skrypt na eksportach generujący gotowy szkic markdown.
- **Risky assumptions**:
  1. Raport powstaje faktycznie co tydzień (a nie ad hoc).
  2. Zbieranie danych to główny koszt — a nie interpretacja/decyzje wymagające człowieka.
  3. Raport jest czytany i używany do decyzji (a nie rytuał).
  4. Dane da się wyeksportować z Bitbucket/Jira w przewidywalnym formacie.
  5. Mapowanie „PR → dotknięte endpointy / zmiany TC" jest wyprowadzalne z danych, nie z wiedzy w głowie autora.
- **Evidence already present**: tylko jakościowy opis bólu od jednej osoby. Brak danych o częstotliwości, czasie, liczbie odbiorców i realnym użyciu raportu.

## Critique

- „Generator raportu" to już rozwiązanie, nie problem. Prawdziwy ból może być węższy — np. tylko krok „PR → dotknięte endpointy", podczas gdy statusy z Jira są szybkie.
- „Przydałby się auto-szkic" to przyszła intencja; dowodem jest konkretna ostatnia sytuacja z mierzonym czasem i krokami.
- Sens budowy obala: raport rzadki / nieczytany / czas głównie na interpretację / dane nie eksportują się sensownie.
- Może już wystarczać: zapisany filtr Jira + lista merge'y z Bitbucket + szablon Confluence.
- Silny dowód, by ruszyć: spójna, niewymuszona opowieść o ostatnim tworzeniu raportu z konkretnym czasem — powtórzona przez kilka osób / tygodni.

## Interview Guide (20–30 min)

**Kontekst / rozgrzewka**
1. Jaką masz rolę przy raporcie regresji i jak często go robisz? Kto jeszcze go tworzy lub Cię zastępuje?
2. Dla kogo jest ten raport — kto go realnie otwiera?

**Ostatnia konkretna historia**
3. Przeprowadź mnie krok po kroku przez ostatni raz, gdy robiłeś ten raport. Od czego zacząłeś, gdzie klikałeś, w jakiej kolejności?
4. Ile to zajęło od początku do wklejenia na Confluence? *(follow-up: która część najdłuższa?)*
5. Co poszło nie tak / co musiałeś poprawić albo dopytać?

**Obecny workaround**
6. Z jakich dokładnie źródeł ciągniesz dane i jak je dziś łączysz (ręcznie, skrypt, kopiuj-wklej, ktoś podsyła)?
7. Jak wyciągasz „które endpointy zostały dotknięte" i „ile TC doszło/zmieniło się per serwis"? *(follow-up: to jest w danych czy w Twojej głowie?)*

**Koszt bólu**
8. Co się dzieje, gdy nie zdążysz z raportem na czas albo zrobisz go niedokładnie? Kto to odczuwa?
9. Czy błąd/braki w raporcie kogoś kiedyś kosztowały (zła decyzja, przeoczona regresja)? Opowiedz o ostatnim przypadku.

**Istniejące alternatywy**
10. Próbowałeś to uprościć — filtry Jira, eksporty, szablon, skrypt, prośba do kogoś? Co zostało, a co porzuciłeś i dlaczego?

**Sygnał decyzyjny**
11. Gdyby zbieranie danych zniknęło, a została tylko interpretacja — ile czasu byś odzyskał i na co?

**Zamknięcie**
12. Mogę zobaczyć ostatni raport i (zanonimizowane) eksporty, których użyłeś? Mogę dopytać za tydzień, gdy znów go zrobisz?

## Survey (6–10 pytań)

1. **(Screener)** Czy w ostatnim kwartale tworzyłeś/-aś lub współtworzyłeś raport regresji? (Tak / Nie — jeśli Nie, koniec)
2. Jak często powstaje taki raport? (Co tydzień / Co 2 tyg / Co miesiąc / Ad hoc / Nie wiem)
3. Ile czasu zajmuje zebranie danych do jednego raportu? (<15 min / 15–30 / 30–60 / 1–2 h / >2 h)
4. Z ilu źródeł ręcznie zbierasz dane? (1 / 2 / 3 / 4+)
5. Która część jest najbardziej czasochłonna? (Zbieranie PR-ów / Mapowanie endpointów i TC / Statusy z Jira / Formatowanie na Confluence / Interpretacja wyników)
6. Jak często raport jest niekompletny lub spóźniony? (Nigdy / Rzadko / Czasem / Często)
7. Czy próbowałeś już to zautomatyzować lub uprościć? (Tak, działa / Tak, porzuciłem / Nie) — jeśli „porzuciłem", dlaczego (otwarte)
8. **(Otwarte)** Opisz ostatni raz, gdy tworzenie tego raportu było szczególnie uciążliwe.

## Decision Criteria

- **Proceed**: ≥3 z ~5 rozmówców niepytanych opisuje ten sam workaround i wskazuje zbieranie/sklejanie danych (nie interpretację) jako główny koszt; raport regularny (≥ co 2 tyg); ma realnych odbiorców. Ankieta: ≥40% robi go co tydzień/częściej i ≥30% deklaruje ≥30 min na samo zbieranie.
- **Narrow scope**: ból realny, ale skupiony w jednym kroku (np. tylko „PR → dotknięte endpointy") — buduj tylko ten fragment.
- **Do not build yet**: raport rzadki/nieregularny, albo główny koszt to interpretacja i decyzje (złożoność istotna), albo nikt raportu nie czyta.
- **Try existing tool/process first**: filtr Jira + lista merge'y z Bitbucket + szablon Confluence „prawie wystarczają" — dopracuj je przed pisaniem skryptu.
