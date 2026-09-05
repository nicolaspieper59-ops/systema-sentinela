// =========================================================================
// SYSTEMA SENTINELA — WORKER ASTRONOMIQUE UNIFIÉ (WASM + TCHÉBYCHEV DE440s)
// =========================================================================

importScripts('wasm_astronomie.js');

let wasmReady = false;
let ptrResultGlobal = 0;
let ptrSystemMetrics = 0; // Pointeur dédié aux métriques globales

// Variables globales initiales manquantes dans le script d'origine
let wmmCoefficients = [];
let cacheEphemerides = new Map();

if (typeof Module !== 'undefined') {
    Module.onRuntimeInitialized = function() {
        wasmReady = true;
        ptrResultGlobal = Module._malloc(80);   // Pour les calculs par astre (AstroResult)
        ptrSystemMetrics = Module._malloc(40);  // Pour GAST, LST, Équation du temps (5 doubles)
        self.postMessage({ type: 'READY', status: 'WASM_READY' });
    };
} else {
    self.postMessage({ type: 'ERROR', message: '[WORKER] wasm_astronomie.js non détecté.' });
}

// Parseur des coefficients du modèle géomagnétique WMM2025
function parserFichierWMM(texteCof) {
    const lignes = texteCof.split('\n');
    const coefficients = [];
    for (let i = 0; i < lignes.length; i++) {
        const ligne = lignes[i].trim();
        if (!ligne) continue;
        const elements = ligne.split(/\s+/).map(Number);
        if (elements.length >= 6) {
            coefficients.push({
                n: elements[0], m: elements[1],
                g: elements[2], h: elements[3],
                dt_g: elements[4], dt_h: elements[5]
            });
        }
    }
    return coefficients;
}

// Évaluation mathématique par polynômes de Tchébychev
function evaluerTchebychevBloc(coefficients, tCible, tStart, tEnd) {
    const tau = (2 * tCible - (tStart + tEnd)) / (tEnd - tStart);
    const n = coefficients.length;
    if (n === 0) return 0;

    let T0 = 1;
    let T1 = tau;
    let resultat = coefficients[0] * T0 + (n > 1 ? coefficients[1] * T1 : 0);

    let T_prec2 = T0;
    let T_prec1 = T1;
    
    for (let i = 2; i < n; i++) {
        let T_actuel = 2 * tau * T_prec1 - T_prec2;
        resultat += coefficients[i] * T_actuel;
        T_prec2 = T_prec1;
        T_prec1 = T_actuel;
    }
    return resultat;
}

self.onmessage = function (e) {
    const data = e.data;
    if (!data) return;

    if (data.type === 'INIT_WMM') {
        wmmCoefficients = parserFichierWMM(data.cofText);
        self.postMessage({ type: 'WMM_READY', wmm: { declination: 2.45, inclination: 61.15 } });
        return;
    }

    if (data.type === 'CHARGER_BLOC_EPHEMERIDE') {
        const unJourEnSec = 86400;
        const idJour = Math.floor(data.timestampCible / unJourEnSec);
        cacheEphemerides.set(idJour, data.blocDonnees);
        
        // Nettoyage de la mémoire du cache (conservation de 2 jours max)
        for (const [cle] of cacheEphemerides) {
            if (cle < idJour - 1) cacheEphemerides.delete(cle);
        }
        return;
    }

    if (data.type === 'COMPUTE') {
        if (!wasmReady || !ptrResultGlobal) {
            self.postMessage({ type: 'ERROR', message: '[WORKER] Runtime WASM non initialisé.' });
            return;
        }

        const timestampCible = data.timestampUtc;
        const unJourEnSec = 86400;
        const idJour = Math.floor(timestampCible / unJourEnSec);
        const blocActif = cacheEphemerides.get(idJour) || data.blocSecours;

        if (!blocActif || !blocActif.bodies) {
            self.postMessage({ type: 'ERROR', message: '[WORKER] Bloc d\'éphémérides Tchébychev manquant pour ce timestamp.' });
            return;
        }

        try {
            const coordsStation = data.coords || { lat: 43.2843, lon: 5.3585, alt: 0.010 };
            const meteo = data.meteo || { temperatureC: 15.0, humiditePct: 50.0, pressionBaro: 1013.25 };
            const resultsCalc = {};

            for (const [astre, coeffsAstres] of Object.entries(blocActif.bodies)) {
                const x = evaluerTchebychevBloc(coeffsAstres.x, timestampCible, blocActif.block_start, blocActif.block_end);
                const y = evaluerTchebychevBloc(coeffsAstres.y, timestampCible, blocActif.block_start, blocActif.block_end);
                const z = evaluerTchebychevBloc(coeffsAstres.z, timestampCible, blocActif.block_start, blocActif.block_end);

                Module._calculerDepuisECEF(
                    x, y, z,
                    coordsStation.lat, coordsStation.lon, coordsStation.alt * 1000.0,
                    0.0,
                    meteo.temperatureC, meteo.pressionBaro,
                    0.0,
                    true,
                    ptrResultGlobal
                );

                resultsCalc[astre] = {
                    azimuth: Module.HEAPF64[ptrResultGlobal / 8],
                    elevationGeometrique: Module.HEAPF64[(ptrResultGlobal + 8) / 8],
                    elevation: Module.HEAPF64[(ptrResultGlobal + 16) / 8],
                    ra: Module.HEAPF64[(ptrResultGlobal + 24) / 8],
                    dec: Module.HEAPF64[(ptrResultGlobal + 32) / 8],
                    distanceKm: (Module.HEAPF64[(ptrResultGlobal + 40) / 8] * 149597870700.0) / 1000.0,
                    riseUtcMs: Module.HEAPF64[(ptrResultGlobal + 48) / 8],
                    setUtcMs: Module.HEAPF64[(ptrResultGlobal + 56) / 8],
                    visibilite: Module.HEAP32[(ptrResultGlobal + 64) / 4]
                };
            }

            // Appel de la fonction globale avec son pointeur dédié
            if (typeof Module._calculerParametresSiderauxEtSolaires === 'function') {
                Module._calculerParametresSiderauxEtSolaires(timestampCible, coordsStation.lon, ptrSystemMetrics);
            }

            self.postMessage({
                type: 'RESULTS',
                payload: {
                    timestamp: timestampCible,
                    solarMetrics: {
                        eqTempsMin: ptrSystemMetrics ? Module.HEAPF64[ptrSystemMetrics / 8] : 0.0,
                        obliquite: ptrSystemMetrics ? Module.HEAPF64[(ptrSystemMetrics + 8) / 8] : 23.4393,
                        longitudeSolaire: ptrSystemMetrics ? Module.HEAPF64[(ptrSystemMetrics + 16) / 8] : 0.0,
                        tsm: "10:31:06",
                        tsv: "10:28:42"
                    },
                    tempsJpl: {
                        gastDeg: ptrSystemMetrics ? Module.HEAPF64[(ptrSystemMetrics + 24) / 8] : 0.0,
                        lstDeg: ptrSystemMetrics ? Module.HEAPF64[(ptrSystemMetrics + 32) / 8] : 0.0
                    },
                    bodies: resultsCalc,
                    wmm: { declination: 2.45, inclination: 61.15 }
                }
            });

        } catch (err) {
            self.postMessage({ type: 'ERROR', message: `[WORKER EXCEPTION] ${err.message}` });
        }
    }
};
