/**
 * WORKER ASTRONOMIQUE SYSTEMA SENTINELA — KERNEL RIGOROUS v19.40
 * Multi-Physique, IERS EOP, Isolation Mémoire & Star Extraction
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
        console.log("[WORKER WASM] Runtime C/SOFA initialisé (Mode Strict Sub-Arcsecondique).");
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
                if (data.pixels && data.largeur && data.hauteur) {
                    const etoiles = extraireCentroidesEtoiles(data.pixels, data.largeur, data.hauteur);
                    self.postMessage({ type: 'STARS_PROCESSED', etoiles: etoiles });
                }
                break;
        }
    } catch (erreur) {
        self.postMessage({ type: 'FATAL_ERROR', message: erreur.message });
    }
};

function analyserTexteWMMStricte(texte) {
    if (!texte || typeof texte !== 'string') throw new Error("[FATAL WMM] Fichier WMM vide.");
    const texteTrim = texte.trim();
    if (texteTrim.startsWith('<!DOCTYPE') || texteTrim.includes('<html')) throw new Error("[FATAL WMM] Réponse 404 HTML.");

    const lignes = texte.split('\n');
    const coeffs = [];
    for (let ligne of lignes) {
        const lineTrim = ligne.trim();
        if (!lineTrim || lineTrim.startsWith('99999999') || lineTrim.startsWith('WMM')) continue;
        const elements = lineTrim.split(/\s+/);
        if (elements.length >= 6) {
            const n = parseInt(elements[0], 10);
            const m = parseInt(elements[1], 10);
            if (!isNaN(n) && !isNaN(m) && n <= 12) {
                coeffs.push({ 
                    n: n, m: m, 
                    gnm: parseFloat(elements[2]), hnm: parseFloat(elements[3]), 
                    dgnm: parseFloat(elements[4]), dhnm: parseFloat(elements[5]) 
                });
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

function traiterCalculsWasmStricts(params) {
    if (!jplMatrixData || !jplMatrixData.DATA) throw new Error("[FATAL] Données JPL non chargées.");

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

            let tau = (2.0 * (tEphemerideSec - seg.t_start) / (seg.t_end - seg.t_start)) - 1.0;
            tau = Math.max(-1.0, Math.min(1.0, tau));

            const x = evaluerTchebychevStricte(seg.cx, tau);
            const y = evaluerTchebychevStricte(seg.cy, tau);
            const z = evaluerTchebychevStricte(seg.cz, tau);
            const vx = evaluerTchebychevStricte(seg.cvx, tau);
            const vy = evaluerTchebychevStricte(seg.cvy, tau);
            const vz = evaluerTchebychevStricte(seg.cvz, tau);

            const nomUpper = nomCorps.toUpperCase();
            const estSoleil = (nomUpper === "SOLEIL" || nomUpper === "SUN") ? 1 : 0;
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
                const azim = Module.HEAPF64[ptrF64];
                const elevGeom = Module.HEAPF64[ptrF64 + 1];
                const elevRefractee = Module.HEAPF64[ptrF64 + 2];
                const raDeg = Module.HEAPF64[ptrF64 + 3];
                const decDeg = Module.HEAPF64[ptrF64 + 4];
                const distUA = Module.HEAPF64[ptrF64 + 5];
                const leverUT = Module.HEAPF64[ptrF64 + 6];
                const coucherUT = Module.HEAPF64[ptrF64 + 7];
                const airMass = Module.HEAPF64[ptrF64 + 8];
                const irradiance = Module.HEAPF64[ptrF64 + 9];
                const ghaDeg = Module.HEAPF64[ptrF64 + 11];
                const magApp = Module.HEAPF64[ptrF64 + 13];
                const shadowLen = Module.HEAPF64[ptrF64 + 14];
                const crepusculeUT = Module.HEAPF64[ptrF64 + 17];
                const dureeJour = Module.HEAPF64[ptrF64 + 18];
                const visCode = Module.HEAP32[(resultPtr + 184) >> 2];

                const formatH = (h) => (h < 0 || isNaN(h)) ? "N/A" : `${Math.floor(h).toString().padStart(2, '0')}:${Math.floor((h % 1) * 60).toString().padStart(2, '0')} UTC`;

                bodiesResult[nomCorps.toLowerCase()] = {
                    elevationGeometrique: elevGeom,
                    elevationApparente: elevRefractee,
                    azimuth: azim,
                    distanceAu: distUA,
                    magnitude: magApp,
                    raDeg: raDeg,
                    decDeg: decDeg,
                    visibiliteCode: visCode,
                    airMass: airMass,
                    irradiance: irradiance,
                    jde: jde,
                    deltat: deltaTSeconds,
                    ghaDeg: ghaDeg,
                    distanceMinMaxDisplay: `${distUA.toFixed(6)} AU`,
                    constellationDisplay: "JPL-DE440s / SOFA",
                    perigeeDisplay: `${seg.perigee_ua.toFixed(5)} AU`,
                    perihelionDisplay: `${seg.perihelion_ua.toFixed(4)} AU`,
                    aphelionDisplay: `${seg.aphelion_ua.toFixed(4)} AU`,
                    orbitPeriodDisplay: `${seg.period_days.toFixed(1)} j`,
                    lengthOfDayDisplay: `${seg.lod_hours.toFixed(1)} h`,
                    orbitalVelocityDisplay: `${seg.vel_kms.toFixed(2)} km/s`,
                    shadowLengthDisplay: (shadowLen > 0) ? `${shadowLen.toFixed(2)} m` : "N/A",
                    sunrise: estSoleil ? formatH(leverUT) : (elevRefractee >= -0.833 ? "Visible" : "Sous horizon"),
                    sunset: estSoleil ? formatH(coucherUT) : (elevRefractee < -0.833 ? "Couché" : "Au-dessus horizon"),
                    dusk: estSoleil ? formatH(crepusculeUT) : (elevRefractee < -6.0 ? "Nuit" : "Crépuscule/Jour"),
                    daylightDuration: estSoleil && dureeJour > 0 ? `${dureeJour.toFixed(2)} h` : (elevRefractee > 0 ? "Jour" : "Nuit")
                };
            } finally {
                Module._free(resultPtr);
            }
        }
    } catch (err) {
        throw new Error(`Erreur corps célestes : ${err.message}`);
    }

    self.postMessage({
        type: 'RESULTS_COMPUTE',
        bodies: bodiesResult,
        metrics: { gastDeg: gastDeg, obliquiteDeg: obliquiteDeg, eqTempsMin: eqTempsMin, excentricite: 0.01671022, longSolaireDeg: sunTrueLong }
    });
}

function extraireCentroidesEtoiles(pixelsBuffer, largeur, hauteur) {
    const pixels = new Uint8Array(pixelsBuffer);
    let sommeLuminance = 0;
    const totalPixels = largeur * hauteur;

    for (let i = 0; i < pixels.length; i += 4) {
        sommeLuminance += 0.2126 * pixels[i] + 0.7152 * pixels[i+1] + 0.0722 * pixels[i+2];
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
                        const nX = x + dx, nY = y + dy;
                        const nIdx = (nY * largeur + nX) * 4;
                        const nLum = 0.2126 * pixels[nIdx] + 0.7152 * pixels[nIdx+1] + 0.0722 * pixels[nIdx+2];
                        sommeX_I += nX * nLum;
                        sommeY_I += nY * nLum;
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
    etoilesDetectees.sort((a, b) => b.intensite - a.intensite);
    return etoilesDetectees.slice(0, 50);
        }
