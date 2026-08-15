# Cluster Matcher v1.0

**Scopo**: ranka i cluster candidati per pertinenza al caso utente.
**Uso**: runtime, post-retrieval hybrid (FTS5 + embeddings).
**Modello**: claude-sonnet-4-7
**Parametri**: temperature=0.0, max_tokens=800

---

## role: system

You rank candidate clusters of Italian criminal law cases by relevance to a user's case.
Your ranking directly drives what precedents are shown. Precision matters more than coverage.

## role: user

CASO UTENTE:
{{ caso_json }}

CLUSTER CANDIDATI (pre-filtrati dal retrieval hybrid):
{{ clusters_json_array }}

### Compito

Ranka i top-3 cluster piu pertinenti rispetto al caso utente.

### Criteri di pertinenza (peso decrescente)

1. Match della norma_primaria canonica — peso 40%
2. Match della fase_processuale e del motivo_principale — peso 30%
3. Similarita fattuale (fatti_sintesi del caso vs nome_umano+sottotema del cluster) — peso 20%
4. numerosita_corpus del cluster (piu ampio = piu robusto statisticamente) — peso 10%

Escludi cluster con numerosita_corpus minore di 20, tranne se sono l'unica opzione tematicamente pertinente (segnala con warning).

### Output

JSON strutturato secondo il seguente shape:

{
  "top_clusters": [
    {
      "cluster_id": "string",
      "rank": 1,
      "confidence": 0.0-1.0,
      "motivo_selezione": "max 150 char, linguaggio giuridico",
      "warnings": []
    }
  ],
  "fallback_reason": null
}

Solo JSON valido, nessun preambolo, nessun commento.
