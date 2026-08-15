# Edicola Ecclesiastica

Clone tematico di **Edicola Giuridica** dedicato a: Chiesa cattolica, diritto
canonico, diritto vaticano, rapporti tra l'Italia e le confessioni religiose
(cattolica e non), religioni e confessioni religiose in Italia e nel mondo.

Vive in `edicola-giuridica/ecclesiastica/` e gira come processo PM2 separato
(`edicola-ecclesiastica`, porta **3202**) con database propri in
`ecclesiastica/data/`. Stessa architettura del progetto madre: server Node
monolitico + SPA React + SQLite + pipeline AI "Scalata".

---

## 1. Cosa cambia rispetto al progetto madre

| Componente | Progetto madre | Edicola Ecclesiastica |
|---|---|---|
| Porta | 3201 | **3202** |
| Processo PM2 | `edicola-giuridica` | `edicola-ecclesiastica` |
| Feed RSS | ~60 fonti giuridiche | **33 fonti religiose/ecclesiastiche** (Vatican News, AgenSIR, ACI Stampa, Adista, SettimanaNews, Riforma.it, Moked, RNS, Crux, The Pillar + Google News tematiche) |
| `data/giuridica.db` | notizie + codici italiani | notizie ecclesiastiche (schema identico, creato da `scripts/init-db.js`) |
| `data/normativa.db` | leggi da Normattiva | **corpus ecclesiastico**: CIC, CCEO, leggi vaticane, diritto ecclesiastico italiano, magistero (stesso schema + colonna `ordinamento`) |
| `data/cassazione-corpus.db` | 424k provvedimenti | solo giurisprudenza in materia ecclesiastica, filtrata dal corpus madre |
| Scraper istituzionali | Cassazione, GU, autorità | stub vuoto (la copertura istituzionale arriva dai feed) |

## 2. Il corpus (`corpus/`)

Cinque rami, tutti riprendibili e idempotenti, con coda persistente e **tetto
giornaliero di 10.000 unità** (una unità = un canone / articolo / documento /
sentenza):

| Ramo (`ordinamento`) | Importer | Fonte | Volume atteso |
|---|---|---|---|
| `canonico` | `import-cic.js` | vatican.va (testo it. ufficiale; Libro VI riformato 2021 dal PDF, serve `pdftotext`) | 1.752 canoni |
| `canonico` | `import-cceo.js` | IntraText ITA1881 (it.) | 1.546 canoni |
| `ecclesiastico_it` | `import-ecclesiastico.js` | Normattiva (riusa `scrapers/normativa-corpus/lib.js` del madre) | Patti Lateranensi, Villa Madama, L. 222/1985, culti ammessi, **tutte le intese ex art. 8 Cost.** + coda estendibile |
| `vaticano` | `import-vaticano.js` | vaticanstate.va (7 sezioni "Legislazione e normativa", PDF) | centinaia di leggi/decreti SCV |
| `magistero` | `import-magistero.js` | vatican.va (12 pontefici: motu proprio, costituzioni ap., encicliche, esortazioni) | migliaia di documenti |
| `giurisprudenza` | `filtra-giurisprudenza.js` | corpus Cassazione del madre (sola lettura) | migliaia di provvedimenti |

Orchestratore: `corpus/run-daily.js` — esegue i rami in ordine di priorità
fino a esaurire il blocco giornaliero. Contatore in `meta` (`run:YYYY-MM-DD`):
rilanciato lo stesso giorno riparte dal budget residuo.

```bash
node corpus/run-daily.js              # blocco giornaliero (max 10.000 unità)
node corpus/run-daily.js --max 2000   # tetto personalizzato
node corpus/run-daily.js --solo canonico
node corpus/run-daily.js --stats      # stato corpus e code
```

## 3. Deploy sul server (Hetzner)

```bash
cd /home/work/edicola-giuridica
git fetch origin && git checkout <branch> && git pull   # o merge in main
cd ecclesiastica

# 1. Dipendenze (better-sqlite3 va compilato) + estrattore PDF
npm ci
sudo apt-get install -y poppler-utils        # pdftotext per Libro VI CIC + leggi SCV

# 2. Chiavi API (condivise col madre o dedicate)
cp ../.env .env

# 3. Schema DB notizie copiato dal madre
node scripts/init-db.js

# 4. Frontend (già buildato nel repo; ricompila solo se modifichi react-app/)
cd react-app && npm ci && npm run build && cd ..

# 5. Avvio
pm2 start ecosystem.config.js
pm2 save

# 6. Primo blocco del corpus (10.000 unità) + cron per i giorni successivi
node corpus/run-daily.js
crontab -e   # aggiungi:
# 30 2 * * * /home/work/edicola-giuridica/ecclesiastica/corpus/cron-daily.sh
```

### Esposizione web (Caddy)

Il madre è servito da `edicolagiuridica.it → localhost:3201`. Per il clone,
creare il DNS `ecclesiastica.edicolagiuridica.it → 65.21.237.152` e aggiungere
a `/etc/caddy/conf.d/custom.caddy`:

```caddy
ecclesiastica.edicolagiuridica.it {
    reverse_proxy localhost:3202
}
```

poi `sudo systemctl reload caddy`. (In alternativa un dominio dedicato, es.
`edicolaecclesiastica.it`, stesso blocco.)

## 4. Verifiche rapide

```bash
curl -s http://127.0.0.1:3202/ | head -5          # SPA
pm2 logs edicola-ecclesiastica --lines 20          # feed refresh (33 fonti)
node corpus/run-daily.js --stats                   # corpus
```

## 5. Note operative

- **Libro VI del CIC**: le pagine HTML di vatican.va contengono ancora il testo
  previgente; il testo riformato (cost. ap. *Pascite gregem Dei*, 2021) viene
  estratto dal PDF ufficiale con `pdftotext`. Senza `pdftotext` i canoni
  1311-1399 restano marcati in rubrica come previgenti.
- **IntraText** (CCEO) tollera ~1 richiesta ogni 3 s: l'importer va piano e
  recupera nelle run successive le pagine cadute (reset di connessione).
- **Normattiva**: l'importer ecclesiastico riusa sessione, anti-ban e parser
  AKN del corpus madre; girando entrambi sullo stesso server condividono la
  buona educazione verso normattiva.it.
- La pipeline AI (Scalata, dossier, Genio) usa la stessa `ANTHROPIC_API_KEY`
  del madre: i costi si sommano.
- `edicolamondo.com` compare ancora nel blocco SEO di `server.js` clonato:
  quando il clone ha un dominio, sostituirlo lì e in `sitemap-generator.js`.
