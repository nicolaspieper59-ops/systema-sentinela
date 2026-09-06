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

onmessage = function(e) {
    const data = e.data;
    if (!data) return;

    // 1. Mise à jour de la matrice JPL
    if (data.type === 'UPDATE_JPL_MATRIX') {
        matriceJplGlobal = data.matrix;
        return;
    }

    // 2. Initialisation ou traitement WMM (CORRIGÉ : placé à l'intérieur de onmessage)
    if (data.type === 'INIT_WMM') {
        // Logique de parsing des coefficients WMM2025.COF (à implémenter ou simuler)
        // Exemple de retour vers l'UI une fois calculé :
        postMessage({
            type: 'WMM_RESULTS',
            payload: { declination: 2.45, inclination: 61.15 }
        });
        return;
    }

    // 3. Calcul principal des éphémérides
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

            const timestampSec = timestampUtc / 1000.0;

            // Paramètres sidéraux et solaires globaux
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

            const eraRad = (solarMetrics.gastDeg % 360.0) * (Math.PI / 180.0);
            const bodiesResults = {};

            const dateActuelle = new Date(timestampUtc);
            const minutesDepuisMinuit = dateActuelle.getUTCHours() * 60 + dateActuelle.getUTCMinutes();
            const indexMinute = Math.min(Math.max(0, minutesDepuisMinuit), 1440);

            const sourceDonnees = (matriceJplGlobal && matriceJplGlobal.DATA) ? matriceJplGlobal.DATA : null;
            const corpsACalculer = {};

            if (sourceDonnees) {
                for (const [nomAstre, tableauMinutes] of Object.entries(sourceDonnees)) {
                    if (tableauMinutes && tableauMinutes[indexMinute]) {
                        const [x, y, z] = tableauMinutes[indexMinute];
                        corpsACalculer[nomAstre] = { x, y, z, mag: 0.0 };
                    }
                }
            } else {
                corpsACalculer.soleil = { x: 1.0, y: 0.0, z: 0.0, mag: -26.74 };
            }

            resultPtr = Module._malloc(72);

            for (const [nomAstre, coordsEcl] of Object.entries(corpsACalculer)) {
                const xEcl = coordsEcl.x ?? 0.0;
                const yEcl = coordsEcl.y ?? 0.0;
                const zEcl = coordsEcl.z ?? 0.0;
                const magnitude = coordsEcl.mag ?? 0.0;

                Module._calculerDepuisECEF(
                    xEcl, yEcl, zEcl,
                    lat, lon, alt,
                    eraRad,
                    tempC, presHpa,
                    magnitude,
                    true, // Vecteur déjà topocentrique en mètres (depuis Python)
                    resultPtr
                );

                const resOffset = resultPtr / 8;
                bodiesResults[nomAstre] = {
                    elevationGeometrique: Module.HEAPF64[resOffset + 1],
                    azimuth: Module.HEAPF64[resOffset + 0],
                    distanceKm: Module.HEAPF64[resOffset + 5] * 149597870700.0 / 1000.0,
                    visibiliteCode: Module.HEAP32[(resultPtr + 64) / 4],
                    leverTsv: "--:--",
                    culminationTsv: "--:--",
                    coucherTsv: "--:--"
                };
            }

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
                    bodies: bodiesResults
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
