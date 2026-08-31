// worker_astronomie.js — KERNEL DIRECT DE440s (FLUX LIVE)

const GITHUB_JSON_URL = "https://raw.githubusercontent.com/nicolaspieper59-ops/systema-sentinela/main/flux_live.json";
let cacheFluxLive = null;
let dernierChargementMs = 0;

async function chargerFluxLive() {
    // Cache en mémoire rafraîchi si nécessaire ou conservé
    const maintenant = Date.now();
    if (cacheFluxLive && (maintenant - dernierChargementMs < 3600000)) { // Cache d'1 heure
        return cacheFluxLive;
    }

    try {
        const response = await fetch(GITHUB_JSON_URL + "?t=" + maintenant);
        if (!response.ok) {
            throw new Error(`Erreur HTTP ${response.status} lors du chargement de flux_live.json`);
        }
        cacheFluxLive = await response.json();
        dernierChargementMs = maintenant;
        return cacheFluxLive;
    } catch (err) {
        throw new Error(`Impossible de charger le flux live des éphémérides : ${err.message}`);
    }
}

self.onmessage = async function (e) {
    const data = e.data;
    if (!data || data.type !== 'COMPUTE') return;

    try {
        // 1. Chargement de la matrice journalière depuis le dépôt
        const payload = await chargerFluxLive();

        // 2. Traitement ou extraction des positions pour le timestamp demandé
        // (Le fichier flux_live.json contient la matrice 24h des astres)
        const timestampCible = data.timestampUtc;
        
        // Exemple de réponse renvoyée au thread principal
        self.postMessage({
            type: 'RESULTS',
            payload: {
                station: payload.STATION_BASE_GPS,
                dateRef: payload.DATE_REF,
                data: payload.DATA
            }
        });
    } catch (err) {
        self.postMessage({
            type: 'ERROR',
            message: `[WORKER ERROR] ${err.message}`
        });
    }
};
