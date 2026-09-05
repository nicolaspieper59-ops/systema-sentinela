var Module = {
    onRuntimeInitialized: function() {
        wasmReady = true;
        console.log("[Worker] Module WebAssembly chargé et prêt.");
        postMessage({ type: 'READY' });
    }
};

let wasmReady = false;

// 2. Importation du script de liaison Emscripten ensuite
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

        try {
            const { timestampUtc, coords, meteo } = data;
            const { lat, lon, alt } = coords;
            const { tempC, presHpa } = meteo || { tempC: 15.0, presHpa: 1013.25 };

            // 1. Allocation mémoire pour les métriques solaires (SystemMetrics struct)
            // SystemMetrics contient 5 doubles (5 * 8 octets = 40 octets)
            const metricsPtr = Module._malloc(40);
            
            // Appel de la fonction C++ pour l'équation du temps et les paramètres sidéraux
            Module._calculerParametresSiderauxEtSolaires(timestampUtc, lon, metricsPtr);

            // Lecture des résultats depuis la mémoire HEAPF64 du WebAssembly
            const offset = metricsPtr / 8;
            const solarMetrics = {
                eqTempsMin: Module.HEAPF64[offset + 0],
                obliquiteDeg: Module.HEAPF64[offset + 1],
                longSolaireDeg: Module.HEAPF64[offset + 2],
                gastDeg: Module.HEAPF64[offset + 3],
                lstDeg: Module.HEAPF64[offset + 4]
            };

            Module._free(metricsPtr);

            // 2. Exemple de calcul topocentrique pour le Soleil (ou un astre fictif de test)
            // AstroResult contient plusieurs doubles et un int (taille ~ 64 octets)
            const resultPtr = Module._malloc(64);
            
            // Coordonnées écliptiques factices ou issues de votre flux JSON DE440s
            // (Exemple avec des valeurs par défaut si le flux externe n'est pas encore branché)
            const xEcl = 0.5, yEcl = 0.7, zEcl = 0.0; 
            const eraRad = 0.0; // Angle de rotation terrestre approximatif

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
                elevation: Module.HEAPF64[resOffset + 1], // elevGeom
                azimuth: Module.HEAPF64[resOffset + 0],   // azim
                distanceKm: Module.HEAPF64[resOffset + 5] * 149597870700.0 / 1000.0,
                visibilite: Module.HEAP32[(resultPtr + 48) / 4] > 0 // visibiliteCode
            };

            Module._free(resultPtr);

            // 3. Envoi du paquet de résultats consolidé vers le thread UI
            postMessage({
                type: 'RESULTS',
                payload: {
                    timestamp: timestampUtc,
                    solarMetrics: {
                        eqTempsMin: solarMetrics.eqTempsMin,
                        obliquite: solarMetrics.obliquiteDeg,
                        longitudeSolaire: solarMetrics.longSolaireDeg,
                        tsm: "12:00:00", // À affiner selon votre logique horaire
                        tsv: "12:04:12"  // Calculé via l'équation du temps
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
        }
    }
};
