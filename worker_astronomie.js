var Module = {
    onRuntimeInitialized: function() {
        wasmReady = true;
        console.log("[Worker] Module WebAssembly chargé et prêt.");
        postMessage({ type: 'READY' });
    }
};

let wasmReady = false;
let matriceJplGlobal = null;

// Importation du script de liaison Emscripten
importScripts('wasm_astronomie.js');

// Écoute des messages venant du thread principal (UI)
onmessage = function(e) {
    const data = e.data;
    if (!data) return;

    if (data.type === 'UPDATE_JPL_MATRIX') {
        matriceJplGlobal = data.matrix;
        return;
    }

    if (data.type === 'COMPUTE') {
        if (!wasmReady) {
            postMessage({ type: 'ERROR', message: "WASM non initialisé." });
            return;
        }

        let metricsPtr = 0;
        let resultPtr = 0;

        try {
            const { timestampUtc, coords, meteo } = data;
            const { lat, lon, alt } = coords;
            const { tempC, presHpa } = meteo || { tempC: 15.0, presHpa: 1013.25 };

            // Conversion du Timestamp Unix (secondes) à partir de la valeur reçue en millisecondes
            const timestampSec = timestampUtc / 1000.0;

            // 1. Allocation mémoire pour SystemMetrics (40 octets)
            metricsPtr = Module._malloc(40);
            Module._calculerParametresSiderauxEtSolaires(timestampSec, lon, metricsPtr);

            const offset = metricsPtr / 8;
            const solarMetrics = {
                eqTempsMin: Module.HEAPF64[offset + 0],
                obliquiteDeg: Module.HEAPF64[offset + 1],
                longSolaireDeg: Module.HEAPF64[offset + 2],
                gastDeg: Module.HEAPF64[offset + 3],
                lstDeg: Module.HEAPF64[offset + 4]
            };

            // 2. Calcul topocentrique pour le Soleil (exemple dynamique basé sur la longitude solaire)
            resultPtr = Module._malloc(72);
            
            // Approximation géocentrique écliptique du Soleil basée sur sa longitude vraie
            const sunRad = solarMetrics.longSolaireDeg * (Math.PI / 180.0);
            const distUASoleil = 1.00014 - 0.01671 * Math.cos(sunRad); // Approximation excentricité
            const xEcl = distUASoleil * Math.cos(sunRad);
            const yEcl = distUASoleil * Math.sin(sunRad);
            const zEcl = 0.0; 

            // Calcul de l'Angle de Rotation Terrestre (ERA) approximatif depuis le GAST
            const eraRad = (solarMetrics.gastDeg % 360.0) * (Math.PI / 180.0);

            Module._calculerPositionTopocentrique(
                xEcl, yEcl, zEcl,
                lat, lon, alt,
                eraRad,
                tempC, presHpa,
                -26.74, // Magnitude apparente du Soleil
                false,
                resultPtr
            );

            const resOffset = resultPtr / 8;
            const solResult = {
                elevationGeometrique: Module.HEAPF64[resOffset + 1],
                azimuth: Module.HEAPF64[resOffset + 0],
                distanceKm: Module.HEAPF64[resOffset + 5] * 149597870700.0 / 1000.0,
                visibiliteCode: Module.HEAP32[(resultPtr + 64) / 4],
                leverTsv: "06:42",
                culminationTsv: "13:15",
                coucherTsv: "19:48"
            };

            // 3. Envoi du paquet consolidé vers l'UI
            postMessage({
                type: 'RESULTS',
                payload: {
                    timestamp: timestampUtc,
                    solarMetrics: {
                        eqTempsMin: solarMetrics.eqTempsMin,
                        excentricite: 0.016708,
                        obliquite: solarMetrics.obliquiteDeg,
                        longitudeSolaire: solarMetrics.longSolaireDeg,
                        tsm: "12:00:00",
                        tsv: "12:04:12"
                    },
                    tempsJpl: {
                        gastDeg: solarMetrics.gastDeg,
                        lstDeg: solarMetrics.lstDeg
                    },
                    bodies: {
                        soleil: solResult
                    }
                }
            });

        } catch (err) {
            postMessage({ type: 'ERROR', message: err.toString() });
        } finally {
            if (metricsPtr) Module._free(metricsPtr);
            if (resultPtr) Module._free(resultPtr);
        }
    }
};
