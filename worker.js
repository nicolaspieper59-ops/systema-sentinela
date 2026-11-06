/**
 * WORKER ASTRONOMIQUE SYSTEMA SENTINELA — KERNEL RIGOROUS v19.40
 * (Précision Sub-Arcsecondique, IERS EOP, O(1) Tchébychev & Star Extractor)
 */

let jplMatrixData = null;
let wmmTableauCoeffs = null;
let wasmPret = false;
let wmmPret = false;
let iersEopCourant = { xp_arcsec: 0.0, yp_arcsec: 0.0, ut1_utc_sec: -0.0547 };

var Module = {
    onRuntimeInitialized: function() {
        wasmPret = true;
        self.postMessage({ type: 'WORKER_READY' });
        console.log("[WORKER WASM] Runtime C/SOFA initialisé (Mode Ultra-Précision).");
    }
};

importScripts('./wasm_astronomie.js');

self.onmessage = function (e) {
    try {
        const data = e.data;
        if (!data) return;

        switch (data.type) {
            case 'UPDATE_JPL_MATRIX':
                if (!data.matrix || !data.matrix.DATA) {
                    throw new Error("[FATAL WMM/JPL] Matrice JPL invalide ou corrompue.");
                }
                jplMatrixData = data.matrix;
                if (data.matrix.ALMANACH && data.matrix.ALMANACH.iers_eop) {
                    iersEopCourant = data.matrix.ALMANACH.iers_eop;
                    console.log("[WORKER IERS] EOP appliqués :", iersEopCourant);
                }
                self.postMessage({ type: 'JPL_MATRIX_UPDATED' });
                break;

            case 'LOAD_WMM_COF_TEXT':
                wmmTableauCoeffs = analyserTexteWMMStricte(data.text);
                wmmPret = true;
                self.postMessage({ type: 'WMM_LOADED', status: 'success' });
                break;

            case 'COMPUTE':
                if (!wasmPret) throw new Error("[FATAL] Module Wasm non initialisé.");
                if (!wmmPret || !wmmTableauCoeffs || wmmTableauCoeffs.length === 0) return;
                traiterCalculsWasmStricts(data);
                break;

            case 'PROCESS_STARS':
                // Extraction stellaire sub-pixellaire (Plate-Solving)
                const etoiles = extraireCentroidesEtoiles(data.pixels, data.largeur, data.hauteur);
                self.postMessage({ type: 'STARS_PROCESSED', etoiles: etoiles });
                break;
        }
    } catch (erreur) {
        self.postMessage({ type: 'FATAL_ERROR', message: erreur.message });
    }
};

function analyserTexteWMMStricte(texte) {
    if (!texte || typeof texte !== 'string') throw new Error("[FATAL WMM] COF invalide.");
    const lines = texte.trim().split('\n');
    const coeffs = [];
    for (let line of lines) {
        const l = line.trim();
        if (!l || l.startsWith('99999999') || l.startsWith('WMM')) continue;
        const el = l.split(/\s+/);
        if (el.length >= 6) {
            const n = parseInt(el[0], 10), m = parseInt(el[1], 10);
            if (!isNaN(n) && !isNaN(m) && n <= 12) {
                coeffs.push({ n, m, gnm: parseFloat(el[2]), hnm: parseFloat(el[3]), dgnm: parseFloat(el[4]), dhnm: parseFloat(el[5]) });
            }
        }
    }
    return coeffs;
}

function obtenirDeltaTRigoureux(timestampSec) {
    const taiMinusUtc = 37.0; 
    const ttMinusTai = 32.184;
    const ut1MinusUtc = iersEopCourant.ut1_utc_sec || -0.0547;
    return ttMinusTai + taiMinusUtc - ut1MinusUtc;
}

function evaluerTchebychevStricte(coeffs, tau) {
    if (!coeffs || coeffs.length === 0) return 0.0;
    const degre = coeffs.length - 1;
    if (degre === 0) return coeffs[0];
    if (degre === 1) return coeffs[0] + coeffs[1] * tau;
    let tPrev2 = 1.0, tPrev1 = tau, somme = coeffs[0] * tPrev2 + coeffs[1] * tPrev1;
    for (let n = 2; n <= degre; n++) {
        const tCurr = 2.0 * tau * tPrev1 - tPrev2;
        somme += coeffs[n] * tCurr;
        tPrev2 = tPrev1; tPrev1 = tCurr;
    }
    return somme;
}

function obtenirSegmentTchebychevOptime(segments, tEphemerideSec) {
    if (!segments || segments.length === 0) return null;
    const tStartGlobal = segments[0].t_start;
    const pasSec = segments[0].t_end - segments[0].t_start;
    if (pasSec > 0) {
        let indexEstime = Math.floor((tEphemerideSec - tStartGlobal) / pasSec);
        indexEstime = Math.max(0, Math.min(segments.length - 1, indexEstime));
        const seg = segments[indexEstime];
        if (tEphemerideSec >= seg.t_start && tEphemerideSec <= seg.t_end) return seg;
    }
    return segments.find(s => tEphemerideSec >= s.t_start && tEphemerideSec <= s.t_end);
}

function traiterCalculsWasmStricts(params) {
    if (!jplMatrixData || !jplMatrixData.DATA) throw new Error("[FATAL] Données JPL manquantes.");
    const ts = params.timestampUtc;
    const coords = params.coords;
    const meteo = {
        tempC: (params.meteo && typeof params.meteo.tempC === 'number') ? params.meteo.tempC : 15.0,
        presHpa: (params.meteo && typeof params.meteo.presHpa === 'number') ? params.meteo.presHpa : 1013.25
    };

    const timestampSec = ts / 1000.0;
    const metricsPtr = Module._malloc(40);
    let gastDeg, obliquiteDeg, sunTrueLong, eqTempsMin;

    try {
        Module._calculerParametresSiderauxEtSolaires(timestampSec, coords.lon, metricsPtr);
        eqTempsMin = Module.HEAPF64[metricsPtr >> 3];
        obliquiteDeg = Module.HEAPF64[(metricsPtr >> 3) + 1];
        sunTrueLong = Module.HEAPF64[(metricsPtr >> 3) + 2];
        gastDeg = Module.HEAPF64[(metricsPtr >> 3) + 3];
    } finally {
        Module._free(metricsPtr);
    }

    const jde = (ts / 86400000.0) + 2440587.5;
    const decimalYear = 2000.0 + (jde - 2451545.0) / 365.25;
    const deltaTSeconds = obtenirDeltaTRigoureux(timestampSec); 
    const tEphemerideSec = timestampSec + deltaTSeconds;

    const structSize = 208; 
    const bodiesResult = {};

    try {
        for (const [nomCorps, segments] of Object.entries(jplMatrixData.DATA)) {
            if (!segments || segments.length === 0) continue;
            let seg = obtenirSegmentTchebychevOptime(segments, tEphemerideSec);
            if (!seg) continue;

            let tau = Math.max(-1.0, Math.min(1.0, (2.0 * (tEphemerideSec - seg.t_start) / (seg.t_end - seg.t_start)) - 1.0));

            const x = evaluerTchebychevStricte(seg.cx, tau);
            const y = evaluerTchebychevStricte(seg.cy, tau);
            const z = evaluerTchebychevStricte(seg.cz, tau);
            const vx = evaluerTchebychevStricte(seg.cvx, tau);
            const vy = evaluerTchebychevStricte(seg.cvy, tau);
            const vz = evaluerTchebychevStricte(seg.cvz, tau);

            const estSoleil = (nomCorps.toUpperCase() === "SOLEIL" || nomCorps.toUpperCase() === "SUN") ? 1 : 0;
            const eraRad = (gastDeg + (iersEopCourant.ut1_utc_sec || 0.0) * (15.0 / 3600.0)) * (Math.PI / 180.0);

            const resultPtr = Module._malloc(structSize);
            try {
                Module._calculerDepuisECEF(
                    x, y, z, vx, vy, vz, 
                    coords.lat, coords.lon, coords.alt, 
                    eraRad, meteo.tempC, meteo.presHpa, 0.15, 
                    seg.mag ?? 0.0, estSoleil, resultPtr
                );

                const ptrF64 = resultPtr >> 3;
                bodiesResult[nomCorps.toLowerCase()] = {
                    azimuth: Module.HEAPF64[ptrF64],
                    elevationGeometrique: Module.HEAPF64[ptrF64 + 1],
                    elevationApparente: Module.HEAPF64[ptrF64 + 2],
                    raDeg: Module.HEAPF64[ptrF64 + 3],
                    decDeg: Module.HEAPF64[ptrF64 + 4],
                    distanceAu: Module.HEAPF64[ptrF64 + 5],
                    airMass: Module.HEAPF64[ptrF64 + 8],
                    irradiance: Module.HEAPF64[ptrF64 + 9],
                    ghaDeg: Module.HEAPF64[ptrF64 + 11],
                    magnitude: Module.HEAPF64[ptrF64 + 13],
                    visibiliteCode: Module.HEAP32[(resultPtr + 184) >> 2],
                    jde: jde,
                    deltat: deltaTSeconds
                };
            } finally {
                Module._free(resultPtr);
            }
        }
    } catch (err) {
        throw new Error(`Erreur corps célester : ${err.message}`);
    }

    self.postMessage({
        type: 'RESULTS_COMPUTE',
        bodies: bodiesResult,
        metrics: { gastDeg, obliquiteDeg, eqTempsMin, excentricite: 0.01671022, longSolaireDeg: sunTrueLong }
    });
}

function extraireCentroidesEtoiles(pixelsBuffer, largeur, hauteur) {
    const pixels = new Uint8Array(pixelsBuffer);
    let sommeLuminance = 0;
    const totalPixels = largeur * hauteur;

    for (let i = 0; i < pixels.length; i += 4) {
        sommeLuminance += (0.2126 * pixels[i] + 0.7152 * pixels[i+1] + 0.0722 * pixels[i+2]);
    }
    const seuilDetection = (sommeLuminance / totalPixels) * 4.0;
    const etoilesDetectees = [];

    for (let y = 1; y < hauteur - 1; y++) {
        for (let x = 1; x < largeur - 1; x++) {
            const idx = (y * largeur + x) * 4;
            const lum = 0.2126 * pixels[idx] + 0.7152 * pixels[idx+1] + 0.0722 * pixels[idx+2];
            if (lum > seuilDetection) {
                let sommeX_I = 0, sommeY_I = 0, sommeI = 0;
                for (let dy = -1; dy <= 1; dy++) {
                    for (let dx = -1; dx <= 1; dx++) {
                        const nIdx = ((y + dy) * largeur + (x + dx)) * 4;
                        const nLum = 0.2126 * pixels[nIdx] + 0.7152 * pixels[nIdx+1] + 0.0722 * pixels[nIdx+2];
                        sommeX_I += (x + dx) * nLum;
                        sommeY_I += (y + dy) * nLum;
                        sommeI += nLum;
                    }
                }
                if (sommeI > 0) {
                    etoilesDetectees.push({
                        x: parseFloat((sommeX_I / sommeI).toFixed(3)),
                        y: parseFloat((sommeY_I / sommeI).toFixed(3)),
                        intensite: parseFloat(sommeI.toFixed(2))
                    });
                }
            }
        }
    }
    return etoilesDetectees.sort((a, b) => b.intensite - a.intensite).slice(0, 50);
                        }
