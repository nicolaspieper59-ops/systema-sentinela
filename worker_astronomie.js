var Module = {
    onRuntimeInitialized: function() {
        wasmReady = true;
        console.log("[Worker] Module WebAssembly chargé et prêt.");
        postMessage({ type: 'READY' });
    }
};

let wasmReady = false;

// Importation du script de liaison Emscripten
importScripts('wasm_astronomie.js');

// Écoute des messages venant du thread principal (UI)
onmessage = function(e) {
    const data = e.data;
    if (!data) return;

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

            // 1. Allocation mémoire pour SystemMetrics (40 octets)
            metricsPtr = Module._malloc(40);
            Module._calculerParametresSiderauxEtSolaires(timestampUtc, lon, metricsPtr);

            const offset = metricsPtr / 8;
            const solarMetrics = {
                eqTempsMin: Module.HEAPF64[offset + 0],
                obliquiteDeg: Module.HEAPF64[offset + 1],
                longSolaireDeg: Module.HEAPF64[offset + 2],
                gastDeg: Module.HEAPF64[offset + 3],
                lstDeg: Module.HEAPF64[offset + 4]
            };

            // 2. Allocation mémoire pour AstroResult (72 octets avec le padding C++)
            resultPtr = Module._malloc(72);
            
            const xEcl = 0.5, yEcl = 0.7, zEcl = 0.0; 
            const eraRad = 0.0;

            Module._calculerPositionTopocentrique(
                xEcl, yEcl, zEcl,
                lat, lon, alt,
                eraRad,
                tempC, presHpa,
                -26.74,
                false,
                resultPtr
            );

            const resOffset = resultPtr / 8;
            const solResult = {
                elevation: Module.HEAPF64[resOffset + 1], // elevGeom (offset 8)
                azimuth: Module.HEAPF64[resOffset + 0],   // azim (offset 0)
                distanceKm: Module.HEAPF64[resOffset + 5] * 149597870700.0 / 1000.0, // distUA (offset 40)
                visibilite: Module.HEAP32[(resultPtr + 64) / 4] > 0 // visibiliteCode (offset 64)
            };

            // 3. Envoi du paquet de résultats consolidé vers le thread UI
            postMessage({
                type: 'RESULTS',
                payload: {
                    timestamp: timestampUtc,
                    solarMetrics: {
                        eqTempsMin: solarMetrics.eqTempsMin,
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
            // S'assure que la mémoire allouée est toujours libérée proprement
            if (metricsPtr) Module._free(metricsPtr);
            if (resultPtr) Module._free(resultPtr);
        }
    }
};
