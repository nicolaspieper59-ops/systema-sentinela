/**
 * SYSTEMA SENTINELA — WEB WORKER (v19.5 RIGOROUS FIXED)
 */

var Module = {
    onRuntimeInitialized: function() {
        wasmReady = true;
        initialiserMemoireWasm();
        postMessage({ type: 'WORKER_READY' });
    }
};

let wasmReady = false;
let matriceJplGlobal = null;
let metricsPtr = 0;
let resultPtr = 0;

importScripts('wasm_astronomie.js');

function initialiserMemoireWasm() {
    if (wasmReady && !metricsPtr) {
        metricsPtr = Module._malloc(40); // 5 x double (SystemMetrics)
        resultPtr = Module._malloc(104); // AstroResult aligné (104 octets)
    }
}

function evaluerClenshawChebyshev(coeffs, x) {
    if (!coeffs || coeffs.length === 0) return 0.0;
    let bK2 = 0.0, bK1 = 0.0, bK = 0.0;
    for (let i = coeffs.length - 1; i >= 1; i--) {
        bK = coeffs[i] + 2.0 * x * bK1 - bK2;
        bK2 = bK1;
        bK1 = bK;
    }
    return coeffs[0] + x * bK1 - bK2;
}

function obtenirPositionParChebyshev(arcsAstre, timestampSec) {
    if (!arcsAstre || !Array.isArray(arcsAstre) || arcsAstre.length === 0) return null;
    
    // Recherche sécurisée de l'arc temporel actif
    let arc = arcsAstre.find(a => timestampSec >= a.t_start && timestampSec <= a.t_end);
    if (!arc) {
        // Fallback sur le premier ou dernier arc disponible si hors borne stricte
        arc = timestampSec < arcsAstre[0].t_start ? arcsAstre[0] : arcsAstre[arcsAstre.length - 1];
    }

    const tNorm = (arc.t_start === arc.t_end) ? 0.0 : (2.0 * (timestampSec - arc.t_start) / (arc.t_end - arc.t_start) - 1.0);

    return {
        x: evaluerClenshawChebyshev(arc.cx, tNorm),
        y: evaluerClenshawChebyshev(arc.cy, tNorm),
        z: evaluerClenshawChebyshev(arc.cz, tNorm),
        mag: arc.mag ?? 0.0
    };
}

function estimerPhaseLuneTopocentrique(luneResult, soleilResult) {
    // Calcul rigoureux basé sur les vecteurs topocentriques résolus par le WASM
    const diffRA = (luneResult.raDeg - soleilResult.raDeg) * (Math.PI / 180.0);
    const decL = luneResult.decDeg * (Math.PI / 180.0);
    const decS = soleilResult.decDeg * (Math.PI / 180.0);

    const cosElong = Math.sin(decS) * Math.sin(decL) + Math.cos(decS) * Math.cos(decL) * Math.cos(diffRA);
    const elong = Math.acos(Math.max(-1.0, Math.min(1.0, cosElong)));
    
    const fraction = (1.0 + Math.cos(Math.PI - elong)) / 2.0;
    const ageJours = (elong / (2.0 * Math.PI)) * 29.53059;

    return { fraction, ageJours, elongationDeg: elong * (180.0 / Math.PI) };
}

onmessage = async function(e) {
    const data = e.data;
    if (!data) return;

    if (data.type === 'UPDATE_JPL_MATRIX') {
        matriceJplGlobal = data.matrix;
        postMessage({ type: 'MATRIX_ACK', status: 'LOADED' });
        return;
    }

    if (data.type === 'COMPUTE') {
        if (!wasmReady) {
            postMessage({ type: 'ERROR', message: 'Noyau WASM non initialisé.' });
            return;
        }
        initialiserMemoireWasm();

        try {
            const { timestampUtc, coords, meteo } = data;
            if (!coords) throw.Error('Coordonnées de station manquantes.');

            const { lat, lon, alt } = coords;
            const timestampSec = timestampUtc / 1000.0;

            // 1. Calcul des paramètres sidéraux et solaires via WASM
            Module._calculerParametresSiderauxEtSolaires(timestampSec, lon, metricsPtr);

            const offsetMetrics = metricsPtr / 8;
            const eqTempsMin = Module.HEAPF64[offsetMetrics + 0];
            const obliquiteDeg = Module.HEAPF64[offsetMetrics + 1];
            const longSolaireDeg = Module.HEAPF64[offsetMetrics + 2];
            const gastDeg = Module.HEAPF64[offsetMetrics + 3];
            const lstDeg = Module.HEAPF64[offsetMetrics + 4];

            const eraRad = (gastDeg % 360.0) * (Math.PI / 180.0);
            const bodiesResults = {};
            const sourceDonnees = matriceJplGlobal?.DATA || null;

            if (sourceDonnees) {
                for (const [nomAstre, arcsAstre] of Object.entries(sourceDonnees)) {
                    const posECEF = obtenirPositionParChebyshev(arcsAstre, timestampSec);
                    if (!posECEF) continue;

                    // 2. Appel WASM sécurisé (Vecteur géocentrique ITRS pur -> conversion topocentrique interne)
                    Module._calculerDepuisECEF(
                        posECEF.x, posECEF.y, posECEF.z,
                        lat, lon, alt, eraRad, timestampSec,
                        meteo?.tempC ?? 15.0, meteo?.presHpa ?? 1013.25,
                        posECEF.mag, false, resultPtr
                    );

                    const off = resultPtr / 8;
                    bodiesResults[nomAstre] = {
                        azimuth: Module.HEAPF64[off + 0],
                        elevationGeometrique: Module.HEAPF64[off + 1],
                        elevationRefractee: Module.HEAPF64[off + 2],
                        raDeg: Module.HEAPF64[off + 3],
                        decDeg: Module.HEAPF64[off + 4],
                        distanceAu: Module.HEAPF64[off + 5],
                        leverUT: Module.HEAPF64[off + 6],
                        coucherUT: Module.HEAPF64[off + 7],
                        airMass: Module.HEAPF64[off + 8],
                        irradiance: Module.HEAPF64[off + 9],
                        deltaT: Module.HEAPF64[off + 10],
                        ghaDeg: Module.HEAPF64[off + 11],
                        visibiliteCode: Module.HEAP32[(resultPtr + 96) / 4]
                    };
                }
            }

            // 3. Phase lunaire hautement rigoureuse basée sur les résultats topocentriques résolus
            let phaseLune = null;
            if (bodiesResults.soleil && bodiesResults.lune) {
                phaseLune = estimerPhaseLuneTopocentrique(bodiesResults.lune, bodiesResults.soleil);
            }

            postMessage({
                type: 'RESULTS_COMPUTE',
                timestamp: timestampUtc,
                solarMetrics: { eqTempsMin, obliquiteDeg, longSolaireDeg, gastDeg, lstDeg, excentricite: 0.01671022 },
                phaseLune,
                bodies: bodiesResults
            });

        } catch (err) {
            postMessage({ type: 'ERROR', message: err.toString() });
        }
    }
};
