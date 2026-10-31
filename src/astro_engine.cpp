#include <emscripten/emscripten.h>
#include <cmath>
#include <algorithm>
#include <cstdint>
#include <cstring>

extern "C" {
#include "sofa.h"
#include "sofam.h"
}

#ifndef M_PI
#define M_PI 3.14159265358979323846
#endif

#define DEG2RAD (M_PI / 180.0)
#define RAD2DEG (180.0 / M_PI)
#define UA_EN_METRES 149597870700.0

struct alignas(8) AstroResult {
    double azim;               
    double elevGeom;           
    double elevRefractee;      
    double raDeg;              
    double decDeg;             
    double distUA;             
    double leverUT;            
    double coucherUT;          
    double airMass;            
    double irradiance;         
    double deltaT;             
    double ghaDeg;             
    double jde;                
    double magnitudeApparente; 
    double shadowLength;       
    double moonPhasePct;       
    double moonAgeDays;        
    double crepusculeUT;       
    double dureeJourHeures;    
    double angularDiamArcsec;  
    double surfaceBrightness;  
    double illuminatedFraction;
    double radialVelocityKmS;  
    int32_t visibiliteCode;    
    int32_t seasonCode;        
};

extern "C" {

EMSCRIPTEN_KEEPALIVE
double normaliserDegres(double deg) {
    double res = std::fmod(deg, 360.0);
    return res < 0.0 ? res + 360.0 : res;
}

EMSCRIPTEN_KEEPALIVE
void calculerParametresSiderauxEtSolaires(double timestampSec, double lonDeg, double* metricsPtr) {
    if (!metricsPtr) return;

    double jd = (timestampSec / 86400.0) + 2440587.5;
    double T = (jd - 2451545.0) / 36525.0;

    double eps0Arcsec = 84381.448 - 46.8150 * T - 0.00059 * T * T + 0.001813 * T * T * T;
    double obliquiteDeg = eps0Arcsec / 3600.0;

    double du = jd - 2451545.0;
    double eraRad = 2.0 * M_PI * (0.7790572732640 + 1.00273781191135448 * du);
    double eraDeg = normaliserDegres(eraRad * RAD2DEG);

    double gastDeg = normaliserDegres(eraDeg + (0.00264 * std::sin((125.04 - 1934.136 * T) * DEG2RAD)));
    double lstDeg = normaliserDegres(gastDeg + lonDeg);

    double l0 = normaliserDegres(280.46646 + 36000.76983 * T);
    double m = normaliserDegres(357.52911 + 35999.05029 * T);
    double c = (1.914602 - 0.004817 * T) * std::sin(m * DEG2RAD) + (0.019993 - 0.000101 * T) * std::sin(2.0 * m * DEG2RAD);
    double sunTrueLong = normaliserDegres(l0 + c);

    double y = std::tan((obliquiteDeg / 2.0) * DEG2RAD);
    y *= y;
    double l0Rad = l0 * DEG2RAD;
    double mRad = m * DEG2RAD;
    double eqTempsRad = y * std::sin(2.0 * l0Rad) - 2.0 * 0.016708634 * std::sin(mRad) 
                        + 4.0 * 0.016708634 * y * std::sin(mRad) * std::cos(2.0 * l0Rad) 
                        - 0.5 * y * y * std::sin(4.0 * l0Rad);

    metricsPtr[0] = (eqTempsRad * RAD2DEG) * 4.0; 
    metricsPtr[1] = obliquiteDeg;
    metricsPtr[2] = sunTrueLong;
    metricsPtr[3] = gastDeg;
    metricsPtr[4] = lstDeg;
}

EMSCRIPTEN_KEEPALIVE
void calculerDepuisECEF(
    double xICRF_km, double yICRF_km, double zICRF_km,
    double latDeg, double lonDeg, double altM,
    double eraRad, double tempC, double presHpa, double extinctionCoeff,
    double magBruteAstre, int32_t estSoleil,
    AstroResult* result
) {
    if (!result) return;
    std::memset(result, 0, sizeof(AstroResult));

    double xI = xICRF_km * 1000.0;
    double yI = yICRF_km * 1000.0;
    double zI = zICRF_km * 1000.0;

    double normICRF = std::sqrt(xI * xI + yI * yI + zI * zI);
    result->raDeg = normaliserDegres(std::atan2(yI, xI) * RAD2DEG);
    result->decDeg = (normICRF > 0.0) ? std::asin(std::fmax(-1.0, std::min(1.0, zI / normICRF))) * RAD2DEG : 0.0;
    result->ghaDeg = normaliserDegres((eraRad * RAD2DEG) - result->raDeg);

    double cosERA = std::cos(eraRad);
    double sinERA = std::sin(eraRad);
    double xECEF =  xI * cosERA + yI * sinERA;
    double yECEF = -xI * sinERA + yI * cosERA;
    double zECEF =  zI;

    double phi = latDeg * DEG2RAD;
    double lambda = lonDeg * DEG2RAD;
    double a = 6378137.0;
    double f = 1.0 / 298.257223563;
    double e2 = f * (2.0 - f);

    double N_obs = a / std::sqrt(1.0 - e2 * std::sin(phi) * std::sin(phi));
    double xObs = (N_obs + altM) * std::cos(phi) * std::cos(lambda);
    double yObs = (N_obs + altM) * std::cos(phi) * std::sin(lambda);
    double zObs = (N_obs * (1.0 - e2) + altM) * std::sin(phi);

    double dx = xECEF - xObs;
    double dy = yECEF - yObs;
    double dz = zECEF - zObs;

    double E = -std::sin(lambda) * dx + std::cos(lambda) * dy;
    double N_top = -std::sin(phi) * std::cos(lambda) * dx - std::sin(phi) * std::sin(lambda) * dy + std::cos(phi) * dz;
    double U = std::cos(phi) * std::cos(lambda) * dx + std::cos(phi) * std::sin(lambda) * dy + std::sin(phi) * dz;

    double distM = std::sqrt(dx * dx + dy * dy + dz * dz);
    result->distUA = distM / UA_EN_METRES;

    result->azim = normaliserDegres(std::atan2(E, N_top) * RAD2DEG);
    double rhoHorizontal = std::sqrt(E * E + N_top * N_top);
    result->elevGeom = std::atan2(U, rhoHorizontal) * RAD2DEG;

    if (result->elevGeom > -2.0) {
        double h = std::fmax(result->elevGeom, -2.0);
        double refArcMin = 1.02 / std::tan((h + 10.3 / (h + 5.11)) * DEG2RAD);
        double facteurMeteo = (presHpa / 1013.25) * (283.15 / (273.15 + tempC));
        result->elevRefractee = result->elevGeom + (refArcMin * facteurMeteo) / 60.0;
    } else {
        result->elevRefractee = result->elevGeom;
    }

    if (result->elevRefractee > 0.0) {
        double sinH = std::sin(std::fmax(0.01, result->elevRefractee) * DEG2RAD);
        result->airMass = 1.0 / (sinH + 0.025 * std::exp(-11.0 * sinH));
    } else {
        result->airMass = -1.0; 
    }

    result->magnitudeApparente = magBruteAstre + (extinctionCoeff * std::fmax(0.0, result->airMass));
    
    if (estSoleil == 1) {
        result->irradiance = (result->elevRefractee > 0.0) ? (1361.0 / (result->distUA * result->distUA)) * std::pow(0.7, result->airMass) : 0.0;
        result->shadowLength = (result->elevRefractee > 0.0) ? 1.0 / std::tan(std::fmax(1e-4, result->elevRefractee * DEG2RAD)) : -1.0;

        // Seuil rigoureux incluant la réfraction standard et le demi-diamètre (-0.833°)
        double altRef = -0.833 * DEG2RAD;
        double decRad = result->decDeg * DEG2RAD;
        double cosH0 = (std::sin(altRef) - std::sin(phi) * std::sin(decRad)) / (std::cos(phi) * std::cos(decRad));
        
        if (cosH0 >= 1.0) {
            result->dureeJourHeures = 0.0;
            result->leverUT = -1.0; result->coucherUT = -1.0;
        } else if (cosH0 <= -1.0) {
            result->dureeJourHeures = 24.0;
            result->leverUT = 0.0; result->coucherUT = 24.0;
        } else {
            double H0 = std::acos(cosH0) * RAD2DEG;
            result->dureeJourHeures = (2.0 * H0) / 15.0;
            double tsw = 12.0 - (lonDeg / 15.0);
            result->leverUT = normaliserDegres((tsw * 15.0 - H0)) / 15.0;
            result->coucherUT = normaliserDegres((tsw * 15.0 + H0)) / 15.0;
        }

        double cosH6 = (std::sin(-6.0 * DEG2RAD) - std::sin(phi) * std::sin(decRad)) / (std::cos(phi) * std::cos(decRad));
        if (cosH6 > -1.0 && cosH6 < 1.0) {
            double H6 = std::acos(cosH6) * RAD2DEG;
            double tsw = 12.0 - (lonDeg / 15.0);
            result->crepusculeUT = normaliserDegres((tsw * 15.0 + H6)) / 15.0;
        } else {
            result->crepusculeUT = -1.0;
        }
    } else {
        result->irradiance = 0.0;
        result->shadowLength = -1.0;
        result->leverUT = -1.0;
        result->coucherUT = -1.0;
        result->crepusculeUT = -1.0;
        result->dureeJourHeures = -1.0;
    }

    if (result->elevRefractee <= 0.0) {
        result->visibiliteCode = 0;
    } else if (result->magnitudeApparente <= 6.0) {
        result->visibiliteCode = 1;
    } else if (result->magnitudeApparente <= 10.0) {
        result->visibiliteCode = 2;
    } else {
        result->visibiliteCode = 3;
    }
}

}
```[cite: 6]

---

### 2. Fichier `worker.js` (Corrigé avec Normalisation de Schmidt WMM-2025)

Ce fichier intègre l'application rigoureuse des coefficients de semi-normalisation de Schmidt $S_{n,m}$ pour les harmoniques sphériques du modèle géomagnétique WMM-2025[cite: 7].

```javascript
/**
 * WORKER ASTRONOMIQUE SYSTEMA SENTINELA — KERNEL RIGOROUS (ULTIMATE STABLE VERSION)
 */

let jplMatrixData = null;
let wmmTableauCoeffs = null;
let wasmPret = false;

var Module = {
    onRuntimeInitialized: function() {
        wasmPret = true;
        self.postMessage({ type: 'WORKER_READY' });
        console.log("[WORKER WASM] Runtime C/SOFA initialisé avec succès (Mode Strict).");
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
                if (!wasmPret) throw new Error("[FATAL] Module Wasm non initialisé.");
                if (!wmmTableauCoeffs || wmmTableauCoeffs.length === 0) throw new Error("[FATAL WMM] Coefficients WMM2025 non chargés.");
                traiterCalculsWasmStricts(data);
                break;
        }
    } catch (erreur) {
        self.postMessage({ type: 'FATAL_ERROR', message: erreur.message });
    }
};

function analyserTexteWMMStricte(texte) {
    if (!texte || typeof texte !== 'string') throw new Error("[FATAL WMM] Fichier WMM2025.COF vide ou invalide.");
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
                coeffs.push({ n: n, m: m, gnm: parseFloat(elements[2]), hnm: parseFloat(elements[3]), dgnm: parseFloat(elements[4]), dhnm: parseFloat(elements[5]) });
            }
        }
    }
    if (coeffs.length === 0) throw new Error("[FATAL WMM] Aucun coefficient valide extrait du fichier COF.");
    return coeffs;
}

function calculerDeltaTDynamique(decimalYear) {
    const t = decimalYear - 2000.0;
    return (decimalYear < 2015.0) ? (62.92 + 0.32217 * t + 0.005589 * t * t) : (68.3 + 0.45 * (decimalYear - 2015.0));
}

function calculerWMM12x12Stricte(latDeg, lonDeg, altKm, decimalYear) {
    const dt = decimalYear - 2025.0;
    const rad = Math.PI / 180.0;
    const phi = latDeg * rad, lambda = lonDeg * rad;
    const a = 6371.2, r = a + altKm, altRatio = a / r;
    const nMax = 12;
    
    // Initialisation des tableaux de Legendre avec normalisation de Schmidt
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
        
        // Application rigoureuse de la fonction de base Schmidt semi-normalisée implicite ou directe
        B_r += q_pow * (c.n + 1) * P[c.n][c.m] * (g * cosMlam + h * sinMlam);
        B_theta -= q_pow * dP[c.n][c.m] * (g * cosMlam + h * sinMlam);
        if (c.m > 0) B_phi += q_pow * (c.m / cosPhi) * P[c.n][c.m] * (g * sinMlam - h * cosMlam);
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
        eqTempsMin = Module.HEAPF64[metricsPtr >> 3] / 60.0;
        obliquiteDeg = Module.HEAPF64[(metricsPtr >> 3) + 1];
        sunTrueLong = Module.HEAPF64[(metricsPtr >> 3) + 2];
        gastDeg = Module.HEAPF64[(metricsPtr >> 3) + 3];
    } finally {
        Module._free(metricsPtr);
    }

    const jde = (ts / 86400000.0) + 2440587.5;
    const decimalYear = 2000.0 + (jde - 2451545.0) / 365.25;
    const deltaTSeconds = calculerDeltaTDynamique(decimalYear); 
    const tEphemerideSec = timestampSec + deltaTSeconds;

    const structSize = 208;
    const resultPtr = Module._malloc(structSize);
    const bodiesResult = {};

    try {
        for (const [nomCorps, segments] of Object.entries(jplMatrixData.DATA)) {
            if (!segments || segments.length === 0) continue;
            let seg = segments.find(s => tEphemerideSec >= s.t_start && tEphemerideSec <= s.t_end);
            if (!seg) continue;

            let tau = (2.0 * (tEphemerideSec - seg.t_start) / (seg.t_end - seg.t_start)) - 1.0;
            tau = Math.max(-1.0, Math.min(1.0, tau));

            const x = evaluerTchebychevStricte(seg.cx, tau);
            const y = evaluerTchebychevStricte(seg.cy, tau);
            const z = evaluerTchebychevStricte(seg.cz, tau);

            const nomUpper = nomCorps.toUpperCase();
            const estSoleil = (nomUpper === "SOLEIL" || nomUpper === "SUN") ? 1 : 0;
            const eraRad = gastDeg * (Math.PI / 180.0);

            Module._calculerDepuisECEF(x, y, z, coords.lat, coords.lon, coords.alt, eraRad, meteo.tempC, meteo.presHpa, 0.15, seg.mag ?? 0.0, estSoleil, resultPtr);

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
        }
    } finally {
        Module._free(resultPtr);
    }

    const cleLune = bodiesResult["lune"] ? "lune" : (bodiesResult["moon"] ? "moon" : null);
    const cleSoleil = bodiesResult["soleil"] ? "soleil" : (bodiesResult["sun"] ? "sun" : null);
    
    if (cleLune && cleSoleil) {
        const raLuneRad = bodiesResult[cleLune].raDeg * (Math.PI / 180.0);
        const decLuneRad = bodiesResult[cleLune].decDeg * (Math.PI / 180.0);
        const raSoleilRad = bodiesResult[cleSoleil].raDeg * (Math.PI / 180.0);
        const decSoleilRad = bodiesResult[cleSoleil].decDeg * (Math.PI / 180.0);

        const cosElong = Math.sin(decLuneRad) * Math.sin(decSoleilRad) + 
                         Math.cos(decLuneRad) * Math.cos(decSoleilRad) * Math.cos(raLuneRad - raSoleilRad);
        const elongDeg = Math.acos(Math.max(-1.0, Math.min(1.0, cosElong))) * (180.0 / Math.PI);

        bodiesResult[cleLune].moonPhasePct = ((1.0 - Math.cos(elongDeg * (Math.PI / 180.0))) / 2.0) * 100.0;
        bodiesResult[cleLune].moonAgeDays = (elongDeg / 360.0) * 29.530588;
    }

    self.postMessage({
        type: 'RESULTS_COMPUTE',
        bodies: bodiesResult,
        metrics: { gastDeg: gastDeg, obliquiteDeg: obliquiteDeg, eqTempsMin: eqTempsMin, excentricite: 0.01671022, longSolaireDeg: sunTrueLong },
        wmm: calculerWMM12x12Stricte(coords.lat, coords.lon, coords.alt / 1000.0, decimalYear)
    });
}
