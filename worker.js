/**
 * WORKER ASTRONOMIQUE SYSTEMA SENTINELA v19.30 — KERNEL RIGOROUS (ALIGNEMENT STELLARIUM JNOW)
 */

let jplMatrixData = null;
let wmmTableauCoeffs = null;
let wasmPret = false;

var Module = {
    onRuntimeInitialized: function() {
        wasmPret = true;
        self.postMessage({ type: 'WORKER_READY' });
        console.log("[WORKER WASM] Runtime C/SOFA initialisé avec succès.");
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
                self.postMessage({ type: 'JPL_MATRIX_UPDATED' });
                break;

            case 'LOAD_WMM_COF_TEXT':
                wmmTableauCoeffs = analyserTexteWMMStricte(data.text);
                self.postMessage({ type: 'WMM_LOADED', status: 'success' });
                break;

            case 'COMPUTE':
                if (!wasmPret) {
                    throw new Error("[FATAL] Module Wasm non initialisé.");
                }
                if (!wmmTableauCoeffs || wmmTableauCoeffs.length === 0) {
                    throw new Error("[FATAL WMM] Coefficients WMM2025 non chargés.");
                }
                traiterCalculsWasmStricts(data);
                break;
        }
    } catch (erreur) {
        self.postMessage({ type: 'FATAL_ERROR', message: erreur.message });
    }
};

function analyserTexteWMMStricte(texte) {
    if (!texte || typeof texte !== 'string') {
        throw new Error("[FATAL WMM] Fichier WMM2025.COF vide ou invalide.");
    }
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
    if (coeffs.length === 0) {
        throw new Error("[FATAL WMM] Aucun coefficient valide extrait du fichier COF.");
    }
    return coeffs;
}

function calculerWMM12x12Stricte(latDeg, lonDeg, altKm, decimalYear) {
    const dt = decimalYear - 2025.0;
    const rad = Math.PI / 180.0;
    const phi = latDeg * rad, lambda = lonDeg * rad;
    const a = 6371.2, r = a + altKm, altRatio = a / r;
    const nMax = 12;
    
    let P = Array.from({ length: nMax + 1 }, () => new Array(nMax + 1).fill(0.0));
    let dP = Array.from({ length: nMax + 1 }, () => new Array(nMax + 1).fill(0.0));
    P[0][0] = 1.0; dP[0][0] = 0.0;
    const sinPhi = Math.sin(phi), cosPhi = Math.max(1e-6, Math.cos(phi));

    for (let n = 1; n <= nMax; n++) {
        for (let m = 0; m <= n; m++) {
            if (n === m) {
                P[n][n] = sinPhi * P[n - 1][n - 1];
                dP[n][n] = sinPhi * dP[n - 1][n - 1] + cosPhi * P[n - 1][n - 1];
            } else if (n === 1 && m === 0) {
                P[1][0] = sinPhi; dP[1][0] = cosPhi;
            } else {
                let k = (((n - 1) * (n - 1)) - (m * m)) / ((2 * n - 1) * (2 * n - 3));
                let sqrtK = Math.sqrt(Math.max(0, k));
                P[n][m] = sinPhi * P[n - 1][m] - sqrtK * P[n - 2][m];
                dP[n][m] = sinPhi * dP[n - 1][m] + cosPhi * P[n - 1][m] - sqrtK * dP[n - 2][m];
            }
        }
    }

    let B_r = 0.0, B_theta = 0.0, B_phi = 0.0;
    for (let c of wmmTableauCoeffs) {
        if (c.n > nMax || c.m > c.n) continue;
        const g = c.gnm + c.dgnm * dt;
        const h = c.hnm + c.dhnm * dt;
        let q_pow = Math.pow(altRatio, c.n + 2);
        const cosMlam = Math.cos(c.m * lambda), sinMlam = Math.sin(c.m * lambda);
        const cos_term = g * cosMlam + h * sinMlam;
        const sin_term = g * sinMlam - h * cosMlam;

        B_r += q_pow * (c.n + 1) * P[c.n][c.m] * cos_term;
        B_theta -= q_pow * dP[c.n][c.m] * cos_term;
        if (c.m > 0) B_phi += q_pow * (c.m / cosPhi) * P[c.n][c.m] * sin_term;
    }

    const X = -B_theta, Y = B_phi, Z = -B_r;
    let declination = Math.atan2(Y, X) * (180.0 / Math.PI);
    if (declination < 0) declination += 360.0;

    return {
        declination: declination,
        inclination: Math.atan2(Z, Math.hypot(X, Y)) * (180.0 / Math.PI),
        totalIntensity: Math.abs(Math.hypot(Math.hypot(X, Y), Z))
    };
}

function evaluerTchebychevStricte(coeffs, tau) {
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
    if (!jplMatrixData || !jplMatrixData.DATA) {
        throw new Error("[FATAL] Données JPL non chargées dans le Worker.");
    }

    const ts = params.timestampUtc;
    const coords = params.coords;
    
    const meteo = {
        tempC: (params.meteo && typeof params.meteo.tempC === 'number' && !isNaN(params.meteo.tempC)) ? params.meteo.tempC : 15.0,
        presHpa: (params.meteo && typeof params.meteo.presHpa === 'number' && !isNaN(params.meteo.presHpa)) ? params.meteo.presHpa : 1013.25
    };

    const timestampSec = ts / 1000.0;
    const metricsPtr = Module._malloc(40);
    Module._calculerParametresSiderauxEtSolaires(timestampSec, coords.lon, metricsPtr);
    
    const eqTempsMin = Module.HEAPF64[metricsPtr >> 3] / 60.0;
    const obliquiteDeg = Module.HEAPF64[(metricsPtr >> 3) + 1];
    const sunTrueLong = Module.HEAPF64[(metricsPtr >> 3) + 2];
    const gastDeg = Module.HEAPF64[(metricsPtr >> 3) + 3];
    Module._free(metricsPtr);

    const jde = (ts / 86400000.0) + 2440587.5;
    const decimalYear = 2000.0 + (jde - 2451545.0) / 365.25;
    const deltaTSeconds = 69.2; 
    const tEphemerideSec = timestampSec + deltaTSeconds;

    const structSize = 208;
    const resultPtr = Module._malloc(structSize);
    const bodiesResult = {};

    for (const [nomCorps, segments] of Object.entries(jplMatrixData.DATA)) {
        if (!segments || segments.length === 0) continue;

        let seg = segments.find(s => tEphemerideSec >= s.t_start && tEphemerideSec <= s.t_end);
        if (!seg) {
            throw new Error(`[FATAL JPL] Segment temporel introuvable pour '${nomCorps}' à t=${tEphemerideSec}.`);
        }

        let tau = (2.0 * (tEphemerideSec - seg.t_start) / (seg.t_end - seg.t_start)) - 1.0;
        tau = Math.max(-1.0, Math.min(1.0, tau));

        const x = evaluerTchebychevStricte(seg.cx, tau);
        const y = evaluerTchebychevStricte(seg.cy, tau);
        const z = evaluerTchebychevStricte(seg.cz, tau);

        const nomUpper = nomCorps.toUpperCase();
        const estSoleil = (nomUpper === "SOLEIL" || nomUpper === "SUN") ? 1 : 0;
        const eraRad = gastDeg * (Math.PI / 180.0);

        Module._calculerDepuisECEF(
            x, y, z,
            coords.lat, coords.lon, coords.alt,
            eraRad, meteo.tempC, meteo.presHpa, 0.15,
            seg.mag ?? 0.0, estSoleil,
            resultPtr
        );

        const ptrF64 = resultPtr >> 3;
        const azim = Module.HEAPF64[ptrF64];
        const elevGeom = Module.HEAPF64[ptrF64 + 1];
        const elevRefractee = Module.HEAPF64[ptrF64 + 2];
        const raDeg = Module.HEAPF64[ptrF64 + 3];
        const decDeg = Module.HEAPF64[ptrF64 + 4];
        const distUA = Module.HEAPF64[ptrF64 + 5];
        const airMass = Module.HEAPF64[ptrF64 + 8];
        const irradiance = Module.HEAPF64[ptrF64 + 9];
        const ghaDeg = Module.HEAPF64[ptrF64 + 11];
        const magApp = Module.HEAPF64[ptrF64 + 13];
        const shadowLen = Module.HEAPF64[ptrF64 + 14];
        const visCode = Module.HEAP32[(resultPtr + 184) >> 2];

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
            gha: ghaDeg,
            distanceMinMaxDisplay: `${distUA.toFixed(6)} AU`,
            constellationDisplay: "JPL-DE440s / SOFA",
            perigeeDisplay: `${seg.perigee_ua.toFixed(5)} AU`,
            perihelionDisplay: `${seg.perihelion_ua.toFixed(4)} AU`,
            aphelionDisplay: `${seg.aphelion_ua.toFixed(4)} AU`,
            orbitPeriodDisplay: `${seg.period_days.toFixed(1)} j`,
            lengthOfDayDisplay: `${seg.lod_hours.toFixed(1)} h`,
            orbitalVelocityDisplay: `${seg.vel_kms.toFixed(2)} km/s`,
            shadowLengthDisplay: (shadowLen > 0) ? `${shadowLen.toFixed(2)} m` : "N/A",
            sunrise: elevRefractee >= -0.833 ? "Visible" : "Sous horizon",
            sunset: elevRefractee < -0.833 ? "Couché" : "Au-dessus horizon",
            dusk: elevRefractee < -6.0 ? "Nuit" : "Crépuscule/Jour",
            daylightDuration: elevRefractee > 0 ? "Jour" : "Nuit"
        };
    }

    Module._free(resultPtr);

    const cleLune = bodiesResult["lune"] ? "lune" : (bodiesResult["moon"] ? "moon" : null);
    const cleSoleil = bodiesResult["soleil"] ? "soleil" : (bodiesResult["sun"] ? "sun" : null);
    if (cleLune && cleSoleil) {
        let elongDeg = (bodiesResult[cleLune].raDeg - bodiesResult[cleSoleil].raDeg + 360.0) % 360.0;
        bodiesResult[cleLune].moonPhasePct = (1.0 - Math.cos(elongDeg * Math.PI / 180.0)) / 2.0 * 100.0;
        bodiesResult[cleLune].moonAgeDays = (elongDeg / 360.0) * 29.530588;
    }

    const resultatWmm = calculerWMM12x12Stricte(coords.lat, coords.lon, coords.alt / 1000.0, decimalYear);

    self.postMessage({
        type: 'RESULTS_COMPUTE',
        bodies: bodiesResult,
        metrics: { gastDeg: gastDeg, obliquiteDeg: obliquiteDeg, eqTempsMin: eqTempsMin, excentricite: 0.01671022, longSolaireDeg: sunTrueLong },
        wmm: resultatWmm
    });
}
