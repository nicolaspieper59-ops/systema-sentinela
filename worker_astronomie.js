/**
 * ============================================================================
 * SYSTEMA SENTINELA v18.8 — WEB WORKER ASTRONOMIE & WMM (WASM)
 * ============================================================================
 */

var Module = {
    onRuntimeInitialized: function() {
        wasmReady = true;
        console.log("[Worker] Module WebAssembly chargé et prêt.");
        postMessage({ type: 'READY' });
    }
};

let wasmReady = false;
let matriceJplGlobal = null;

// Importation du script de liaison Emscripten (WASM)
importScripts('wasm_astronomie.js');

onmessage = function(e) {
    const data = e.data;
    if (!data) return;

    // 1. Mise à jour de la matrice JPL globale (provenant du flux Python anti-adblock)
    if (data.type === 'UPDATE_JPL_MATRIX') {
        matriceJplGlobal = data.matrix;
        return;
    }

    // 2. Initialisation ou traitement du modèle géomagnétique WMM-2025
    if (data.type === 'INIT_WMM') {
        try {
            // Emplacement pour le parsing futur du fichier WMM2025.COF si transmis
            // En attendant, renvoi des valeurs par défaut stables pour l'interface
            postMessage({
                type: 'WMM_RESULTS',
                payload: { declination: 2.45, inclination: 61.15 }
            });
        } catch (err) {
            postMessage({ type: 'ERROR', message: "Erreur initialisation WMM : " + err.toString() });
        }
        return;
    }

    // 3. Calcul principal des éphémérides et topographie
    if (data.type === 'COMPUTE') {
        if (!wasmReady) {
            postMessage({ type: 'ERROR', message: "Module WASM non initialisé." });
            return;
        }

        let metricsPtr = 0;
        let resultPtr = 0;

        try {
            const { timestampUtc, coords, meteo } = data;
            const { lat, lon, alt } = coords;
            
            // Récupération sécurisée de la météo (avec repli sur les valeurs par défaut du JSON)
            const meteoDefaut = matriceJplGlobal?.METEO_DEFAUT || { tempC: 15.0, presHpa: 1013.25 };
            const tempC = meteo?.tempC ?? meteoDefaut.tempC;
            const presHpa = meteo?.presHpa ?? meteoDefaut.presHpa;

            const timestampSec = timestampUtc / 1000.0;

            // Allocation mémoire pour les paramètres sidéraux et solaires (SystemMetrics = 40 octets)
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

            // Indexation temporelle : extraction de la minute UTC exacte (0 à 1440)
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
                // Mode de repli de sécurité si le flux JSON n'est pas encore chargé
                corpsACalculer.soleil = { x: 1.0, y: 0.0, z: 0.0, mag: -26.74 };
            }

            // Allocation mémoire pour les résultats d'un astre (AstroResult = 72 octets)
            resultPtr = Module._malloc(72);

            for (const [nomAstre, coordsEcl] of Object.entries(corpsACalculer)) {
                const xEcl = coordsEcl.x ?? 0.0;
                const yEcl = coordsEcl.y ?? 0.0;
                const zEcl = coordsEcl.z ?? 0.0;
                const magnitude = coordsEcl.mag ?? 0.0;

                // Appel de la fonction C++ compilée en WebAssembly
                Module._calculerDepuisECEF(
                    xEcl, yEcl, zEcl,
                    lat, lon, alt,
                    eraRad,
                    tempC, presHpa,
                    magnitude,
                    true, // estVecteurTopocentrique = true (fourni directement en ECEF/ITRS par le script Python)
                    resultPtr
                );

                const resOffset = resultPtr / 8;
                bodiesResults[nomAstre] = {
                    azimuth: Module.HEAPF64[resOffset + 0],
                    elevationGeometrique: Module.HEAPF64[resOffset + 1],
                    elevationRefractee: Module.HEAPF64[resOffset + 2],
                    raDeg: Module.HEAPF64[resOffset + 3],
                    decDeg: Module.HEAPF64[resOffset + 4],
                    distanceKm: Module.HEAPF64[resOffset + 5] * 149597870700.0 / 1000.0,
                    visibiliteCode: Module.HEAP32[(resultPtr + 64) / 4],
                    leverTsv: "--:--",
                    culminationTsv: "--:--",
                    coucherTsv: "--:--"
                };
            }

            // Transmission du paquet consolidé vers le thread principal (UI)
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
            // Libération systématique de la mémoire allouée dans le heap WASM
            if (metricsPtr) Module._free(metricsPtr);
            if (resultPtr) Module._free(resultPtr);
        }
    }
};
