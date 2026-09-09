/**
 * ============================================================================
 * SYSTEMA SENTINELA — WEB WORKER ASTRONOMIE & GÉOMAGNÉTISME (WASM)
 * Version rigoureuse optimisée & fiabilisée v18.9 (avec Transferable Objects)
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
    let bK2 = 0.0, bK1 = 0.0, bK = 0.0;
    for (let i = coeffs.length - 1; i >= 1; i--) {
        bK = coeffs[i] + 2.0 * x * bK1 - bK2;
        bK2 = bK1;
        bK1 = bK;
    }
    return coeffs[0] + x * bK1 - bK2;
}

function obtenirPositionParChebyshev(arcsAstre, timestampSec) {
    if (!arcsAstre || arcsAstre.length === 0) return null;
    let arc = arcsAstre.find(a => timestampSec >= a.t_start && timestampSec <= a.t_end);
    if (!arc) {
        arc = (timestampSec < arcsAstre[0].t_start) ? arcsAstre[0] : arcsAstre[arcsAstre.length - 1];
    }
    const tMin = arc.t_start, tMax = arc.t_end;
    const tNorm = (tMin === tMax) ? 0.0 : (2.0 * (timestampSec - tMin) / (tMax - tMin) - 1.0);

    return {
        x: evaluerClenshawChebyshev(arc.cx, tNorm),
        y: evaluerClenshawChebyshev(arc.cy, tNorm),
        z: evaluerClenshawChebyshev(arc.cz, tNorm),
        mag: arc.mag ?? 0.0
    };
}

function parserFichierWMM(texte) {
    // CORRECTION : Utilisation d'une expression régulière pour gérer proprement \r\n (Windows) et \n (Linux/Mac)
    const lignes = texte.split(/\r?\n/);
    const coeffs = [];
    for (let ligne of lignes) {
        const elements = ligne.trim().split(/\s+/);
        if (elements.length >= 6) {
            const n = parseInt(elements[0], 10), m = parseInt(elements[1], 10);
            const g = parseFloat(elements[2]), h = parseFloat(elements[3]);
            const dtg = parseFloat(elements[4]), dth = parseFloat(elements[5]);
            if (!isNaN(n) && !isNaN(m) && !isNaN(g) && !isNaN(h)) {
                coeffs.push({ n, m, g, h, dtg, dth });
            }
        }
    }
    return coeffs;
}

async function chargerCoefficientsWMM() {
    if (wmmCoefficients) return;
    const reponse = await fetch('WMM2025.COF');
    if (!reponse.ok) throw new Error("Fichier WMM2025.COF introuvable.");
    wmmCoefficients = parserFichierWMM(await reponse.text());
}

function calculerWmmDynamique(latDeg, lonDeg, altKm, anneeDecimale) {
    if (!wmmCoefficients || wmmCoefficients.length === 0) throw new Error("Erreur WMM : Coefficients non chargés.");
    const a = 6371.2, alt = Math.max(0, altKm);
    const latRad = latDeg * (Math.PI / 180.0), lonRad = lonDeg * (Math.PI / 180.0);
    const dt = anneeDecimale - 2025.0, r_sphere = Math.sqrt(a * a + alt * alt);
    let X = 0.0, Y = 0.0, Z = 0.0;

    for (let c of wmmCoefficients) {
        const g_actuel = c.g + dt * c.dtg, h_actuel = c.h + dt * c.dth;
        const ratio = Math.pow(a / r_sphere, c.n + 2);
        if (c.m === 0) {
            Z -= (c.n + 1) * g_actuel * ratio * Math.sin(c.n * latRad);
        } else {
            X -= (g_actuel * Math.cos(c.m * lonRad) + h_actuel * Math.sin(c.m * lonRad)) * ratio;
            Y += (g_actuel * Math.sin(c.m * lonRad) - h_actuel * Math.cos(c.m * lonRad)) * ratio;
        }
    }
    const hHoriz = Math.sqrt(X * X + Y * Y);
    return {
        declination: Math.atan2(Y, X) * (180.0 / Math.PI),
        inclination: Math.atan2(Z, hHoriz) * (180.0 / Math.PI),
        totalIntensity: Math.sqrt(hHoriz * hHoriz + Z * Z)
    };
}

function formaterHeureDecimale(decHours) {
    const h = Math.floor(decHours), m = Math.floor((decHours - h) * 60);
    const s = Math.floor(((decHours - h) * 60 - m) * 60);
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

onmessage = async function(e) {
    const data = e.data;
    if (!data) return;

    if (data.type === 'UPDATE_JPL_MATRIX') {
        matriceJplGlobal = data.matrix;
        return;
    }

    if (data.type === 'INIT_WMM') {
        try {
            if (data.cofText) wmmCoefficients = parserFichierWMM(data.cofText);
            else await chargerCoefficientsWMM();
            const coords = data.coords || { lat: 43.2843, lon: 5.3585, alt: 10 };
            const resultat = calculerWmmDynamique(coords.lat, coords.lon, coords.alt / 1000.0, 2026.2);
            postMessage({ type: 'WMM_RESULTS', payload: resultat });
        } catch (err) {
            postMessage({ type: 'ERROR', message: "Erreur WMM critique : " + err.toString() });
        }
        return;
    }

    if (data.type === 'COMPUTE') {
        if (!wasmReady) {
            postMessage({ type: 'ERROR', message: "Module WASM non initialisé." });
            return;
        }

        let metricsPtr = 0, resultPtr = 0;
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
            const eqTempsMin = Module.HEAPF64[offset + 0];
            const obliquiteDeg = Module.HEAPF64[offset + 1];
            const longSolaireDeg = Module.HEAPF64[offset + 2];
            const gastDeg = Module.HEAPF64[offset + 3];
            const lstDeg = Module.HEAPF64[offset + 4];

            const dateUtc = new Date(timestampUtc);
            const utcHours = dateUtc.getUTCHours() + dateUtc.getUTCMinutes() / 60.0 + dateUtc.getUTCSeconds() / 3600.0;
            let tsmHours = ((utcHours + (lon / 15.0)) % 24 + 24) % 24;
            let tsvHours = ((tsmHours + (eqTempsMin / 60.0)) % 24 + 24) % 24;

            const solarMetrics = {
                eqTempsMin,
                obliquiteDeg,
                longSolaireDeg,
                gastDeg,
                lstDeg,
                excentricite: 0.01671022,
                tsm: formaterHeureDecimale(tsmHours),
                tsv: formaterHeureDecimale(tsvHours)
            };

            const eraRad = (gastDeg % 360.0) * (Math.PI / 180.0);
            const bodiesResults = {};
            const sourceDonnees = matriceJplGlobal?.DATA || null;
            const corpsACalculer = {};

            if (sourceDonnees) {
                for (const [nomAstre, arcsAstre] of Object.entries(sourceDonnees)) {
                    const pos = obtenirPositionParChebyshev(arcsAstre, timestampSec);
                    if (pos) corpsACalculer[nomAstre] = pos;
                }
            }

            resultPtr = Module._malloc(72);
            for (const [nomAstre, coordsEcl] of Object.entries(corpsACalculer)) {
                // CORRECTION : Isolation des erreurs par astre pour éviter qu'un échec global n'interrompe la boucle
                try {
                    Module._calculerDepuisECEF(
                        coordsEcl.x, coordsEcl.y, coordsEcl.z,
                        lat, lon, alt, eraRad, tempC, presHpa, coordsEcl.mag, true, resultPtr
                    );

                    const resOffset = resultPtr / 8;
                    const decDeg = Module.HEAPF64[resOffset + 4];
                    const raDeg = Module.HEAPF64[resOffset + 3];

                    let tsvLeverStr = "--", tsvCulminationStr = "--", tsvCoucherStr = "--";
                    const latRad = lat * (Math.PI / 180.0), decRad = decDeg * (Math.PI / 180.0);
                    const cosH0 = -Math.tan(latRad) * Math.tan(decRad);

                    if (cosH0 >= -1.0 && cosH0 <= 1.0) {
                        const H0 = Math.acos(cosH0) * (180.0 / Math.PI);
                        let culminationHours = ((raDeg - lon - (eqTempsMin * 4.0)) / 15.0 % 24 + 24) % 24;
                        tsvLeverStr = formaterHeureDecimale(((culminationHours - (H0 / 15.0)) % 24 + 24) % 24);
                        tsvCulminationStr = formaterHeureDecimale(culminationHours);
                        tsvCoucherStr = formaterHeureDecimale(((culminationHours + (H0 / 15.0)) % 24 + 24) % 24);
                    }

                    bodiesResults[nomAstre] = {
                        azimuth: Module.HEAPF64[resOffset + 0],
                        elevationGeometrique: Module.HEAPF64[resOffset + 1],
                        elevationRefractee: Module.HEAPF64[resOffset + 2],
                        raDeg, decDeg,
                        distanceKm: Module.HEAPF64[resOffset + 5] * 149597870700.0 / 1000.0,
                        visibiliteCode: Module.HEAP32[(resultPtr + 64) / 4],
                        leverTsv: tsvLeverStr,
                        culminationTsv: tsvCulminationStr,
                        coucherTsv: tsvCoucherStr
                    };
                } catch (errAstre) {
                    console.warn(`[Worker] Erreur de calcul ignorée pour l'astre ${nomAstre}:`, errAstre);
                }
            }

            // --- OPTIMISATION : SÉRIALISATION BINAIRE & TRANSFERABLE OBJECTS ---
            const nbAstres = Object.keys(bodiesResults).length;
            const floatsParAstre = 7; 
            const bufferSize = nbAstres * floatsParAstre * Float64Array.BYTES_PER_ELEMENT;
            const resultArrayBuffer = new ArrayBuffer(bufferSize);
            const resultMap = new Float64Array(resultArrayBuffer);

            let index = 0;
            const metaAstres = {};

            for (const [nomAstre, data] of Object.entries(bodiesResults)) {
                metaAstres[nomAstre] = {
                    visibiliteCode: data.visibiliteCode,
                    leverTsv: data.leverTsv,
                    culminationTsv: data.culminationTsv,
                    coucherTsv: data.coucherTsv
                };

                resultMap[index++] = data.azimuth;
                resultMap[index++] = data.elevationGeometrique;
                resultMap[index++] = data.elevationRefractee;
                resultMap[index++] = data.raDeg;
                resultMap[index++] = data.decDeg;
                resultMap[index++] = data.distanceKm;
                resultMap[index++] = data.visibiliteCode;
            }

            postMessage({
                type: 'RESULTS_BINARY',
                timestamp: timestampUtc,
                solarMetrics,
                tempsJpl: { gastDeg, lstDeg },
                metaAstres,
                buffer: resultArrayBuffer
            }, [resultArrayBuffer]);

        } catch (err) {
            postMessage({ type: 'ERROR', message: err.toString() });
        } finally {
            if (metricsPtr) Module._free(metricsPtr);
            if (resultPtr) Module._free(resultPtr);
        }
    }
};
