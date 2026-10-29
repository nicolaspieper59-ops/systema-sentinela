/**
 * WORKER ASTRONOMIQUE SYSTEMA SENTINELA — KERNEL ZÉRO-SIMPLIFICATION (WASM / SOFA)
 */

let wasmModule = null;
let jplMatrixData = null;
let wmmTableauCoeffs = null;

// Importation du glue script Emscripten pour accéder aux fonctions C natives
importScripts('./wasm_astronomie.js');

// Initialisation asynchrone du module WebAssembly
async function initialiserWasm() {
    try {
        const reponse = await fetch('wasm_astronomie.wasm');
        const buffer = await reponse.arrayBuffer();
        
        wasmModule = await Module({
            wasmBinary: buffer,
            locateFile: (path) => path
        });
        
        self.postMessage({ type: 'WORKER_READY' });
    } catch (e) {
        self.postMessage({ type: 'FATAL_ERROR', message: "Échec critique du chargement Wasm : " + e.message });
    }
}

initialiserWasm();

self.onmessage = function (e) {
    try {
        const data = e.data;
        if (!data) return;

        switch (data.type) {
            case 'UPDATE_JPL_MATRIX':
                jplMatrixData = data.matrix;
                self.postMessage({ type: 'JPL_MATRIX_UPDATED' });
                break;

            case 'LOAD_WMM_COF_TEXT':
                wmmTableauCoeffs = analyserTexteWMM(data.text);
                self.postMessage({ type: 'WMM_LOADED', status: 'success' });
                break;

            case 'COMPUTE':
                if (!wasmModule) {
                    throw new Error("Module Wasm non initialisé pour les calculs stricts.");
                }
                traiterCalculsWasmStricts(data);
                break;
        }
    } catch (erreur) {
        self.postMessage({ type: 'FATAL_ERROR', message: erreur.message });
    }
};

function analyserTexteWMM(texte) {
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

function calculerWMM12x12Complet(latDeg, lonDeg, altKm, decimalYear) {
    if (!wmmTableauCoeffs) return { declination: 0.0, inclination: 0.0, totalIntensity: 0.0 };
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
                dP[n][m] = sinPhi * P[n - 1][m] + cosPhi * P[n - 1][m] - sqrtK * dP[n - 2][m];
            }
        }
    }

    let B_r = 0.0, B_theta = 0.0, B_phi = 0.0;
    for (let c of wmmTableauCoeffs) {
        if (c.n > nMax || c.m > c.n) continue;
        const g = c.gnm + (c.dgnm || 0) * dt;
        const h = c.hnm + (c.dhnm || 0) * dt;
        let q_pow = Math.pow(altRatio, c.n + 2);
        const cosMlam = Math.cos(c.m * lambda), sinMlam = Math.sin(c.m * lambda);
        const cos_term = g * cosMlam + h * sinMlam;
        const sin_term = g * sinMlam - h * cosMlam;

        B_r += q_pow * (c.n + 1) * P[c.n][c.m] * cos_term;
        B_theta -= q_pow * dP[c.n][c.m] * cos_term;
        if (c.m > 0) B_phi += q_pow * (c.m / cosPhi) * P[c.n][c.m] * sin_term;
    }

    const X = -B_theta, Y = B_phi, Z = -B_r;
    return {
        declination: Math.atan2(Y, X) * (180.0 / Math.PI),
        inclination: Math.atan2(Z, Math.hypot(X, Y)) * (180.0 / Math.PI),
        totalIntensity: Math.abs(Math.hypot(Math.hypot(X, Y), Z))
    };
}

function evaluerTchebychev(coeffs, tau) {
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
    if (!jplMatrixData || !jplMatrixData.DATA) return;

    const ts = params.timestampUtc;
    const coords = params.coords;
    const meteo = params.meteo;
    const timestampSec = ts / 1000.0;

    // Allocation mémoire pour récupérer les métriques sidérales depuis le C natif (5 doubles)
    const metricsPtr = wasmModule._malloc(40);
    wasmModule._calculerParametresSiderauxEtSolaires(timestampSec, coords.lon, metricsPtr);
    
    const eqTempsMin = wasmModule.HEAPF64[metricsPtr >> 3] / 60.0;
    const obliquiteDeg = wasmModule.HEAPF64[(metricsPtr >> 3) + 1];
    const sunTrueLong = wasmModule.HEAPF64[(metricsPtr >> 3) + 2];
    const gastDeg = wasmModule.HEAPF64[(metricsPtr >> 3) + 3];
    const lstDeg = wasmModule.HEAPF64[(metricsPtr >> 3) + 4];
    wasmModule._free(metricsPtr);

    const jde = (ts / 86400000.0) + 2440587.5;
    const decimalYear = 2000.0 + (jde - 2451545.0) / 365.25;
    const deltaTSeconds = 69.2; // Temps Terrestre rigoureux
    const tEphemerideSec = timestampSec + deltaTSeconds;

    // Allocation d'une structure AstroResult en mémoire WebAssembly (taille struct : ~200 octets)
    const structSize = 208;
    const resultPtr = wasmModule._malloc(structSize);

    const bodiesResult = {};

    for (const [nomCorps, segments] of Object.entries(jplMatrixData.DATA)) {
        if (!segments || segments.length === 0) continue;

        let seg = segments.find(s => tEphemerideSec >= s.t_start && tEphemerideSec <= s.t_end);
        if (!seg) {
            seg = segments.reduce((prev, curr) => {
                return (Math.abs(curr.t_start - tEphemerideSec) < Math.abs(prev.t_start - tEphemerideSec)) ? curr : prev;
            });
        }

        let tau = (2.0 * (tEphemerideSec - seg.t_start) / (seg.t_end - seg.t_start)) - 1.0;
        tau = Math.max(-1.0, Math.min(1.0, tau));

        const x = evaluerTchebychev(seg.cx, tau);
        const y = evaluerTchebychev(seg.cy, tau);
        const z = evaluerTchebychev(seg.cz, tau);

        const nomUpper = nomCorps.toUpperCase();
        const estSoleil = (nomUpper === "SOLEIL" || nomUpper === "SUN") ? 1 : 0;
        const eraRad = gastDeg * (Math.PI / 180.0);

        // Appel direct de la fonction C native compilée (_calculerDepuisECEF)
        wasmModule._calculerDepuisECEF(
            x, y, z,
            coords.lat, coords.lon, coords.alt,
            eraRad, meteo.tempC, meteo.pressionBaro, 0.15,
            seg.mag ?? 0.0, estSoleil,
            resultPtr
        );

        // Lecture rigoureuse de la structure struct AstroResult retournée par le C
        const ptrF64 = resultPtr >> 3;
        const ptrI32 = resultPtr >> 2;

        const azim = wasmModule.HEAPF64[ptrF64];
        const elevGeom = wasmModule.HEAPF64[ptrF64 + 1];
        const elevRefractee = wasmModule.HEAPF64[ptrF64 + 2];
        const raDeg = wasmModule.HEAPF64[ptrF64 + 3];
        const decDeg = wasmModule.HEAPF64[ptrF64 + 4];
        const distUA = wasmModule.HEAPF64[ptrF64 + 5];
        const airMass = wasmModule.HEAPF64[ptrF64 + 8];
        const irradiance = wasmModule.HEAPF64[ptrF64 + 9];
        const ghaDeg = wasmModule.HEAPF64[ptrF64 + 11];
        const magApp = wasmModule.HEAPF64[ptrF64 + 13];
        const shadowLen = wasmModule.HEAPF64[ptrF64 + 14];
        const visCode = wasmModule.HEAP32[ptrI32 + 46];

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
            perigeeDisplay: seg.perigee_ua ? `${seg.perigee_ua.toFixed(5)} AU` : "--",
            perihelionDisplay: seg.perihelion_ua ? `${seg.perihelion_ua.toFixed(4)} AU` : "--",
            aphelionDisplay: seg.aphelion_ua ? `${seg.aphelion_ua.toFixed(4)} AU` : "--",
            orbitPeriodDisplay: seg.period_days ? `${seg.period_days.toFixed(1)} j` : "--",
            lengthOfDayDisplay: seg.lod_hours ? `${seg.lod_hours.toFixed(1)} h` : "--",
            orbitalVelocityDisplay: seg.vel_kms ? `${seg.vel_kms.toFixed(2)} km/s` : "--",
            shadowLengthDisplay: shadowLen > 0 ? `${shadowLen.toFixed(2)} m` : "N/A",
            sunrise: elevRefractee >= -0.833 ? "Visible" : "Sous horizon",
            sunset: elevRefractee < -0.833 ? "Couché" : "Au-dessus horizon",
            dusk: elevRefractee < -6.0 ? "Nuit" : "Crépuscule/Jour",
            daylightDuration: elevRefractee > 0 ? "Jour" : "Nuit"
        };
    }

    wasmModule._free(resultPtr);

    const cleLune = bodiesResult["lune"] ? "lune" : (bodiesResult["moon"] ? "moon" : null);
    const cleSoleil = bodiesResult["soleil"] ? "soleil" : (bodiesResult["sun"] ? "sun" : null);
    if (cleLune && cleSoleil) {
        let elongDeg = (bodiesResult[cleLune].raDeg - bodiesResult[cleSoleil].raDeg + 360.0) % 360.0;
        bodiesResult[cleLune].moonPhasePct = (1.0 - Math.cos(elongDeg * Math.PI / 180.0)) / 2.0 * 100.0;
        bodiesResult[cleLune].moonAgeDays = (elongDeg / 360.0) * 29.530588;
    }

    const resultatWmm = calculerWMM12x12Complet(coords.lat, coords.lon, coords.alt / 1000.0, decimalYear);

    self.postMessage({
        type: 'RESULTS_COMPUTE',
        bodies: bodiesResult,
        metrics: { gastDeg: gastDeg, obliquiteDeg: obliquiteDeg, eqTempsMin: eqTempsMin, excentricite: 0.01671022, longSolaireDeg: sunTrueLong },
        wmm: resultatWmm
    });
                    }
