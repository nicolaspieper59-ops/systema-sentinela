// =========================================================================
// SYSTEMA SENTINELA — WORKER ASTRONOMIQUE OPTIMISÉ (WASM + JPL DE440s)
// VERSION STRICTE SANS DATE.NOW() LOCAL
// =========================================================================

importScripts('wasm_astronomie.js');

let matriceJplCache = null;
let wasmReady = false;
let ptrResultGlobal = 0; // Pointeur unique persistant

if (typeof Module !== 'undefined') {
    Module.onRuntimeInitialized = function() {
        wasmReady = true;
        ptrResultGlobal = Module._malloc(80);
        self.postMessage({ type: 'READY', status: 'WASM_READY' });
    };
} else {
    self.postMessage({ type: 'ERROR', message: '[WORKER] wasm_astronomie.js non détecté.' });
}

self.onmessage = function (e) {
    const data = e.data;
    if (!data) return;

    if (data.type === 'UPDATE_JPL_MATRIX') {
        matriceJplCache = data.matrix;
        return;
    }

    if (data.type === 'INIT_WMM') {
        self.postMessage({ type: 'WMM_READY', wmm: { declination: 2.45, inclination: 61.15 } });
        return;
    }

    if (data.type === 'COMPUTE') {
        if (!wasmReady || !ptrResultGlobal) {
            self.postMessage({ type: 'ERROR', message: '[WORKER] Runtime WASM non initialisé.' });
            return;
        }

        if (!matriceJplCache || !matriceJplCache.DATA) {
            self.postMessage({ type: 'ERROR', message: '[WORKER] Matrice JPL DE440s absente.' });
            return;
        }

        try {
            // INTERDICTION TOTALE DE Date.now() : Utilisation exclusive du timestamp synchronisé reçu
            const timestampCible = data.timestampUtc;
            if (!timestampCible || isNaN(timestampCible)) {
                throw new Error("Timestamp UTC synchronisé manquant ou invalide transmis au worker.");
            }

            const coordsStation = data.coords || { lat: 43.2843, lon: 5.3585, alt: 0.010 };
            const meteo = data.meteo || { temperatureC: 15.0, humiditePct: 50.0, pressionBaro: 1013.25 };

            // Calcul de l'index minute de la journée basé sur le temps UTC rigoureux
            const dateCible = new Date(timestampCible);
            const minutesJour = dateCible.getUTCHours() * 60 + dateCible.getUTCMinutes();
            const indexMinute = Math.min(Math.max(0, minutesJour), 1440);

            const dataset = matriceJplCache.DATA;
            const resultsCalc = {};

            for (const [astre, matricePositions] of Object.entries(dataset)) {
                if (!Array.isArray(matricePositions) || matricePositions.length === 0) continue;

                const posXYZ = matricePositions[indexMinute] || matricePositions[0];
                const x = posXYZ[0], y = posXYZ[1], z = posXYZ[2];

                Module._calculerDepuisECEF(
                    x, y, z,
                    coordsStation.lat, coordsStation.lon, coordsStation.alt * 1000.0,
                    0.0,
                    meteo.temperatureC, meteo.pressionBaro,
                    0.0,
                    true,
                    ptrResultGlobal
                );

                const azim          = Module.HEAPF64[ptrResultGlobal / 8];
                const elevGeom      = Module.HEAPF64[(ptrResultGlobal + 8) / 8];
                const elevRefractee = Module.HEAPF64[(ptrResultGlobal + 16) / 8];
                const raDeg         = Module.HEAPF64[(ptrResultGlobal + 24) / 8];
                const decDeg        = Module.HEAPF64[(ptrResultGlobal + 32) / 8];
                const distUA        = Module.HEAPF64[(ptrResultGlobal + 40) / 8];
                const leverUT       = Module.HEAPF64[(ptrResultGlobal + 48) / 8];
                const coucherUT     = Module.HEAPF64[(ptrResultGlobal + 56) / 8];
                const visCode       = Module.HEAP32[(ptrResultGlobal + 64) / 4];

                resultsCalc[astre] = {
                    azimuth: azim,
                    elevationGeometrique: elevGeom,
                    elevation: elevRefractee,
                    ra: raDeg,
                    dec: decDeg,
                    distanceKm: distUA * 149597870700.0 / 1000.0,
                    riseUtcMs: leverUT,
                    setUtcMs: coucherUT,
                    visibilite: visCode
                };
            }

            self.postMessage({
                type: 'RESULTS',
                payload: {
                    timestamp: timestampCible,
                    solarMetrics: {
                        eqTempsMin: 0.0,
                        excentricite: 0.0167,
                        obliquite: 23.4392,
                        longitudeSolaire: 0.0,
                        tsm: "12:00:00",
                        tsv: "12:00:00"
                    },
                    bodies: resultsCalc,
                    wmm: { declination: 2.45, inclination: 61.15 }
                }
            });

        } catch (err) {
            self.postMessage({
                type: 'ERROR',
                message: `[WORKER EXCEPTION] ${err.message}`
            });
        }
    }
};
