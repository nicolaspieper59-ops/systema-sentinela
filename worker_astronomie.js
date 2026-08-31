// =========================================================================
// SYSTEMA SENTINELA — WORKER ASTRONOMIQUE DIRECT DE440s + WASM
// Conforme au commit : "Make input parameters optional and restore Wasm build"
// =========================================================================

importScripts('wasm_astronomie.js');

const GITHUB_JSON_URL = "https://raw.githubusercontent.com/nicolaspieper59-ops/systema-sentinela/main/flux_live.json";
let cacheFluxLive = null;
let dernierChargementMs = 0;
let wasmReady = false;

// Initialisation et chargement du binaire WebAssembly
if (typeof Module !== 'undefined') {
    Module.onRuntimeInitialized = function() {
        wasmReady = true;
        self.postMessage({ type: 'WASM_READY', status: 'WASM_INITIALIZED' });
    };
} else {
    self.postMessage({ type: 'ERROR', message: '[WORKER CRITICAL] wasm_astronomie.js non chargé.' });
}

async function chargerFluxLive() {
    const maintenant = Date.now();
    // Utilisation du cache si de moins d'1 heure pour préserver les requêtes GitHub Raw
    if (cacheFluxLive && (maintenant - dernierChargementMs < 3600000)) {
        return cacheFluxLive;
    }

    try {
        const response = await fetch(GITHUB_JSON_URL + "?t=" + maintenant);
        if (!response.ok) {
            throw new Error(`Erreur HTTP ${response.status} sur le flux live DE440s`);
        }
        cacheFluxLive = await response.json();
        dernierChargementMs = maintenant;
        return cacheFluxLive;
    } catch (err) {
        throw new Error(`Échec de récupération du flux live : ${err.message}`);
    }
}

self.onmessage = async function (e) {
    const data = e.data;
    if (!data || data.type !== 'COMPUTE') return;

    if (!wasmReady) {
        self.postMessage({ type: 'ERROR', message: '[WORKER] Attente de l\'initialisation du runtime WASM...' });
        return;
    }

    try {
        // 1. Récupération de la matrice journalière depuis GitHub Actions / CI
        const payload = await chargerFluxLive();
        
        // Paramètres optionnels gérés conformément au commit récent
        const coordsStation = data.coords || payload.STATION_BASE_GPS;
        const meteo = data.meteo || { temperatureC: 15.0, humiditePct: 50.0, pressionBaro: 1013.25 };
        const timestampCible = data.timestampUtc || Date.now();

        // Calcul de l'index minute de la journée (0 à 1440) basé sur le timestamp UTC
        const dateCible = new Date(timestampCible);
        const minutesJour = dateCible.getUTCHours() * 60 + dateCible.getUTCMinutes();
        const indexMinute = Math.min(Math.max(0, minutesJour), 1440);

        const dataset = payload.DATA || payload.data;
        if (!dataset) {
            throw new Error("Structure de données absente dans flux_live.json");
        }

        const resultsCalc = {};

        // Allocation mémoire C++ pour la structure AstroResult (64 octets alignés)
        const ptrResult = Module._malloc(64);

        for (const [astre, matricePositions] of Object.entries(dataset)) {
            if (!Array.isArray(matricePositions) || matricePositions.length === 0) continue;

            // Récupération de la position exacte à la minute indexée (Vecteur ECEF topocentrique en mètres)
            const posXYZ = matricePositions[indexMinute] || matricePositions[0];
            const x = posXYZ[0], y = posXYZ[1], z = posXYZ[2];

            // Appel direct de la fonction C++ exportée dans astro_engine.cpp
            Module._calculerDepuisECEF(
                x, y, z,
                coordsStation.lat, coordsStation.lon, coordsStation.alt,
                0.0, // eraRad (Angle de Rotation Terrestre)
                meteo.temperatureC, meteo.pressionBaro,
                0.0, // Magnitude apparente par défaut
                true, // estVecteurTopocentrique (généré directement par Skyfield ITRS)
                ptrResult
            );

            // Extraction des valeurs depuis le Heap WebAssembly (conformes à struct AstroResult)
            const azim = Module.HEAPF64[ptrResult / 8];
            const elevGeom = Module.HEAPF64[(ptrResult + 8) / 8];
            const elevRefractee = Module.HEAPF64[(ptrResult + 16) / 8];
            const raDeg = Module.HEAPF64[(ptrResult + 24) / 8];
            const decDeg = Module.HEAPF64[(ptrResult + 32) / 8];
            const distUA = Module.HEAPF64[(ptrResult + 40) / 8];
            const visCode = Module.HEAP32[(ptrResult + 52) / 4];

            resultsCalc[astre] = {
                azimuth: azim,
                elevationGeometrique: elevGeom,
                elevation: elevRefractee,
                ra: raDeg,
                dec: decDeg,
                distanceKm: distUA * 149597870700.0 / 1000.0,
                visibilite: visCode
            };
        }

        // Libération de la mémoire allouée dynamiquement sur le tas WASM
        Module._free(ptrResult);

        // 3. Renvoi des résultats calculés vers le thread principal (`index.html`)
        self.postMessage({
            type: 'RESULTS',
            payload: {
                timestamp: timestampCible,
                indexMinute: indexMinute,
                station: coordsStation,
                solarMetrics: {
                    eqTempsMin: 0.0, // Injecté ou calculé par le noyau
                    excentricite: 0.0167,
                    obliquite: 23.4392,
                    longitudeSolaire: 0.0
                },
                bodies: resultsCalc
            }
        });

    } catch (err) {
        self.postMessage({
            type: 'ERROR',
            message: `[WORKER EXCEPTION] ${err.message}`
        });
    }
};
