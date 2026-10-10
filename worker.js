/**
 * WORKER ASTRONOMIQUE SYSTEMA SENTINELA — KERNEL RIGOREUX WASM (v19.20)
 */

importScripts('wasm_astronomie.js');

let jplMatrixData = null;
let wmmTableauCoeffs = null;
let wasmModule = null;

// Initialisation du module WebAssembly Emscripten
Module().then(mod => {
    wasmModule = mod;
    self.postMessage({ type: 'WORKER_READY' });
});

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
                self.postMessage({ type: 'WMM_LOADED' });
                break;

            case 'COMPUTE':
                if (wasmModule) {
                    traiterCalculsWasm(data);
                }
                break;
        }
    } catch (err) {
        self.postMessage({ type: 'ERROR', message: err.message });
    }
};

function evaluerTchebychev(coeffs, tau) {
    const degre = coeffs.length - 1;
    if (degre === 0) return coeffs[0];
    let tPrev2 = 1.0, tPrev1 = tau;
    let somme = coeffs[0] * tPrev2 + coeffs[1] * tPrev1;
    for (let n = 2; n <= degre; n++) {
        const tCurr = 2.0 * tau * tPrev1 - tPrev2;
        somme += coeffs[n] * tCurr;
        tPrev2 = tPrev1; tPrev1 = tCurr;
    }
    return somme;
}

function traiterCalculsWasm(params) {
    if (!jplMatrixData || !jplMatrixData.DATA) return;

    const ts = params.timestampUtc;
    const coords = params.coords;
    const meteo = params.meteo;
    const tUnixSec = ts / 1000.0;

    // 1. Appel du C++ pour obtenir les métriques sidérales et solaires
    const metricsPtr = wasmModule._malloc(5 * 8); // 5 x double (64-bit)
    wasmModule._calculerParametresSiderauxEtSolaires(tUnixSec, coords.lon, metricsPtr);
    
    const eqTempsMin = wasmModule.getValue(metricsPtr, 'double');
    const obliquiteDeg = wasmModule.getValue(metricsPtr + 8, 'double');
    const sunTrueLong = wasmModule.getValue(metricsPtr + 16, 'double');
    const gastDeg = wasmModule.getValue(metricsPtr + 24, 'double');
    const lstDeg = wasmModule.getValue(metricsPtr + 32, 'double');
    wasmModule._free(metricsPtr);

    const eraRad = (gastDeg * Math.PI) / 180.0;
    const resultPtr = wasmModule._malloc(200); // Allocation de la structure AstroResult (200 octets)
    const bodiesResult = {};

    for (const [nomCorps, segments] of Object.entries(jplMatrixData.DATA)) {
        const seg = segments.find(s => tUnixSec >= s.t_start && tUnixSec <= s.t_end) || segments[0];
        const tau = (2.0 * (tUnixSec - seg.t_start) / (seg.t_end - seg.t_start)) - 1.0;

        const xICRF = evaluerTchebychev(seg.cx, tau);
        const yICRF = evaluerTchebychev(seg.cy, tau);
        const zICRF = evaluerTchebychev(seg.cz, tau);

        const estSoleil = (nomCorps.toUpperCase() === "SOLEIL") ? 1 : 0;

        // 2. Execution du moteur C++ natif
        wasmModule._calculerDepuisECEF(
            xICRF, yICRF, zICRF,
            coords.lat, coords.lon, coords.alt,
            eraRad, meteo.tempC, meteo.presHpa, 0.2,
            seg.mag || 0.0, estSoleil,
            resultPtr
        );

        // 3. Extraction de la structure AstroResult depuis le HEAP C++
        const azim = wasmModule.getValue(resultPtr, 'double');
        const elevGeom = wasmModule.getValue(resultPtr + 8, 'double');
        const elevRefractee = wasmModule.getValue(resultPtr + 16, 'double');
        const raDeg = wasmModule.getValue(resultPtr + 24, 'double');
        const decDeg = wasmModule.getValue(resultPtr + 32, 'double');
        const distUA = wasmModule.getValue(resultPtr + 40, 'double');
        const airMass = wasmModule.getValue(resultPtr + 64, 'double');
        const irradiance = wasmModule.getValue(resultPtr + 72, 'double');
        const shadowLength = wasmModule.getValue(resultPtr + 112, 'double');
        const visibiliteCode = wasmModule.getValue(resultPtr + 184, 'i32');

        bodiesResult[nomCorps.toLowerCase()] = {
            elevationGeometrique: elevGeom,
            elevationApparente: elevRefractee,
            azimuth: azim,
            distanceAu: distUA,
            magnitude: seg.mag || 0.0,
            raDeg: raDeg,
            decDeg: decDeg,
            visibiliteCode: visibiliteCode,
            airMass: airMass,
            irradiance: irradiance,
            jde: (ts / 86400000.0) + 2440587.5,
            deltat: 69.2,
            gha: (gastDeg - raDeg + 360.0) % 360.0,
            distanceMinMaxDisplay: `${distUA.toFixed(6)} AU`,
            constellationDisplay: "JPL-DE440s (Wasm)",
            perigeeDisplay: seg.perigee_ua ? `${seg.perigee_ua.toFixed(5)} AU` : "--",
            perihelionDisplay: seg.perihelion_ua ? `${seg.perihelion_ua.toFixed(4)} AU` : "--",
            aphelionDisplay: seg.aphelion_ua ? `${seg.aphelion_ua.toFixed(4)} AU` : "--",
            orbitPeriodDisplay: seg.period_days ? `${seg.period_days.toFixed(1)} j` : "--",
            lengthOfDayDisplay: seg.lod_hours ? `${seg.lod_hours.toFixed(1)} h` : "--",
            orbitalVelocityDisplay: seg.vel_kms ? `${seg.vel_kms.toFixed(2)} km/s` : "--",
            shadowLengthDisplay: shadowLength > 0 ? `${shadowLength.toFixed(2)} m` : "N/A"
        };
    }

    wasmModule._free(resultPtr);

    self.postMessage({
        type: 'RESULTS_COMPUTE',
        bodies: bodiesResult,
        metrics: {
            gastDeg: gastDeg,
            lstDeg: lstDeg,
            obliquiteDeg: obliquiteDeg,
            eqTempsMin: eqTempsMin,
            excentricite: 0.01671022,
            longSolaireDeg: sunTrueLong
        }
    });
                    }
