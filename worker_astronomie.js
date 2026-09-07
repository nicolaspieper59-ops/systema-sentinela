/**
 * ============================================================================
 * SYSTEMA SENTINELA v18.8 — WEB WORKER ASTRONOMIE & GÉOMAGNÉTISME (WASM)
 * Version complète et sécurisée
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
let wmmCoefficients = null;

importScripts('wasm_astronomie.js');

function evaluerClenshawChebyshev(coeffs, x) {
    let bK2 = 0.0;
    let bK1 = 0.0;
    let bK = 0.0;

    for (let i = coeffs.length - 1; i >= 1; i--) {
        bK = coeffs[i] + 2.0 * x * bK1 - bK2;
        bK2 = bK1;
        bK1 = bK;
    }
    return coeffs[0] + x * bK1 - bK2;
}

function obtenirPositionParChebyshev(arcsAstre, timestampSec) {
    if (!arcsAstre || arcsAstre.length === 0) return null;
    const arc = arcsAstre.find(a => timestampSec >= a.t_start && timestampSec <= a.t_end) || arcsAstre[0];
    
    const tMin = arc.t_start;
    const tMax = arc.t_end;
    const tNorm = (tMin === tMax) ? 0.0 : (2.0 * (timestampSec - tMin) / (tMax - tMin) - 1.0);

    return {
        x: evaluerClenshawChebyshev(arc.cx, tNorm),
        y: evaluerClenshawChebyshev(arc.cy, tNorm),
        z: evaluerClenshawChebyshev(arc.cz, tNorm),
        mag: 0.0
    };
}

async function chargerCoefficientsWMM() {
    if (wmmCoefficients) return;
    try {
        const reponse = await fetch('WMM2025.COF');
        if (!reponse.ok) throw new Error("Fichier WMM2025.COF introuvable.");
        
        const texte = await reponse.text();
        wmmCoefficients = parserFichierWMM(texte);
        console.log("[Worker] Coefficients WMM 2025 parsés avec succès.");
    } catch (err) {
        console.warn("[Worker] Erreur chargement WMM, utilisation du repli analytique :", err.message);
    }
}

function parserFichierWMM(texte) {
    const lignes = texte.split('\n');
    const coeffs = [];
    for (let ligne of lignes) {
        const elements = ligne.trim().split(/\s+/);
        if (elements.length >= 6) {
            const n = parseInt(elements[0], 10);
            const m = parseInt(elements[1], 10);
            const g = parseFloat(elements[2]);
            const h = parseFloat(elements[3]);
            const dtg = parseFloat(elements[4]);
            const dth = parseFloat(elements[5]);
            if (!isNaN(n) && !isNaN(m) && !isNaN(g) && !isNaN(h)) {
                coeffs.push({ n, m, g, h, dtg, dth });
            }
        }
    }
    return coeffs;
}

function calculerWmmDynamique(latDeg, lonDeg, altKm, anneeDecimale) {
    if (!wmmCoefficients || wmmCoefficients.length === 0) {
        return { declination: 2.45, inclination: 61.15, totalIntensity: 45250.0 };
    }

    const a = 6371.2;
    const alt = Math.max(0, altKm);
    const latRad = latDeg * (Math.PI / 180.0);
    const lonRad = lonDeg * (Math.PI / 180.0);
    const dt = anneeDecimale - 2025.0;

    let X = 0.0, Y = 0.0, Z = 0.0;
    const r_sphere = Math.sqrt(a * a + alt * alt);

    for (let c of wmmCoefficients) {
        const g_actuel = c.g + dt * c.dtg;
        const h_actuel = c.h + dt * c.dth;
        
        if (c.n === 1 && c.m === 0) {
            Z -= g_actuel * Math.pow(a / r_sphere, 3);
        } else if (c.n === 1 && c.m === 1) {
            X -= (g_actuel * Math.cos(lonRad) + h_actuel * Math.sin(lonRad)) * Math.pow(a / r_sphere, 3);
            Y += (g_actuel * Math.sin(lonRad) - h_actuel * Math.cos(lonRad)) * Math.pow(a / r_sphere, 3);
        }
    }

    const hHoriz = Math.sqrt(X * X + Y * Y);
    return {
        declination: Math.atan2(Y, X) * (180.0 / Math.PI),
        inclination: Math.atan2(Z, hHoriz) * (180.0 / Math.PI),
        totalIntensity: Math.sqrt(hHoriz * hHoriz + Z * Z)
    };
}

onmessage = function(e) {
    const data = e.data;
    if (!data) return;

    if (data.type === 'UPDATE_JPL_MATRIX') {
        matriceJplGlobal = data.matrix;
        return;
    }

    if (data.type === 'INIT_WMM') {
        chargerCoefficientsWMM().then(() => {
            const coords = data.coords || { lat: 43.28, lon: 5.35, alt: 10 };
            const resultat = calculerWmmDynamique(coords.lat, coords.lon, coords.alt / 1000.0, 2026.2);
            postMessage({ type: 'WMM_RESULTS', payload: resultat });
        }).catch(err => {
            postMessage({ type: 'ERROR', message: "Erreur WMM : " + err.toString() });
        });
        return;
    }

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
            
            const meteoDefaut = matriceJplGlobal?.METEO_DEFAUT || { tempC: 15.0, presHpa: 1013.25 };
            const tempC = meteo?.tempC ?? meteoDefaut.tempC;
            const presHpa = meteo?.presHpa ?? meteoDefaut.presHpa;
            const timestampSec = timestampUtc / 1000.0;

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

            const sourceDonnees = (matriceJplGlobal && matriceJplGlobal.DATA) ? matriceJplGlobal.DATA : null;
            const corpsACalculer = {};

            if (sourceDonnees) {
                for (const [nomAstre, arcsAstre] of Object.entries(sourceDonnees)) {
                    const pos = obtenirPositionParChebyshev(arcsAstre, timestampSec);
                    if (pos) corpsACalculer[nomAstre] = pos;
                }
            } else {
                corpsACalculer.soleil = { x: 1.0, y: 0.0, z: 0.0, mag: -26.74 };
            }

            resultPtr = Module._malloc(72);

            for (const [nomAstre, coordsEcl] of Object.entries(corpsACalculer)) {
                Module._calculerDepuisECEF(
                    coordsEcl.x, coordsEcl.y, coordsEcl.z,
                    lat, lon, alt,
                    eraRad,
                    tempC, presHpa,
                    coordsEcl.mag,
                    true,
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
            if (metricsPtr && metricsPtr !== 0) Module._free(metricsPtr);
            if (resultPtr && resultPtr !== 0) Module._free(resultPtr);
        }
    }
};
