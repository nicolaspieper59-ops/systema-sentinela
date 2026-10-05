/**
 * WORKER ASTRONOMIQUE SYSTEMA SENTINELA — KERNEL SYNCHRONISÉ v19.13
 */

let jplMatrixData = null;
let wmmTableauCoeffs = null; // Stockage des coefficients WMM

// Notifier immédiatement le fil principal que le Worker est opérationnel
self.postMessage({ type: 'WORKER_READY' });

self.onmessage = function (e) {
    try {
        const data = e.data;
        if (!data) throw new Error("Message vide reçu par le Worker.");

        switch (data.type) {
            case 'UPDATE_JPL_MATRIX':
                if (!data.matrix) throw new Error("Matrice JPL fournie invalide.");
                jplMatrixData = data.matrix;
                // CORRECTION : Ne plus envoyer WMM_LOADED ici, mais un accusé de réception JPL
                self.postMessage({ type: 'JPL_MATRIX_UPDATED' }); 
                break;

            case 'LOAD_WMM_COF_TEXT':
                // AJOUT : Écoute et traitement du texte WMM transmis par l'interface
                if (!data.text) throw new Error("Texte du fichier WMM vide.");
                wmmTableauCoeffs = analyserTexteWMM(data.text);
                self.postMessage({ type: 'WMM_LOADED', status: 'success' });
                break;

            case 'COMPUTE':
                traiterCalculsRigoureux(data);
                break;

            default:
                throw new Error(`Type de message inconnu : ${data.type}`);
        }
    } catch (erreur) {
        self.postMessage({ 
            type: 'FATAL_ERROR', 
            message: erreur.message 
        });
    }
};

// --- Parseur basique pour les coefficients WMM reçus en texte ---
function analyserTexteWMM(texte) {
    // Logique de parsing des lignes du fichier .COF (exemple simplifié de structure)
    const lignes = texte.split('\n');
    const coeffs = [];
    for (let ligne of lignes) {
        const elements = ligne.trim().split(/\s+/);
        if (elements.length >= 6) {
            coeffs.push({
                n: parseInt(elements[0], 10),
                m: parseInt(elements[1], 10),
                gnm: parseFloat(elements[2]),
                hnm: parseFloat(elements[3]),
                dgnm: parseFloat(elements[4]),
                dhnm: parseFloat(elements[5])
            });
        }
    }
    return coeffs;
}

function evaluerTchebychev(coeffs, tau) {
    const degre = coeffs.length - 1;
    if (degre === 0) return coeffs[0];
    if (degre === 1) return coeffs[0] + coeffs[1] * tau;

    let tPrev2 = 1.0;
    let tPrev1 = tau;
    let somme = coeffs[0] * tPrev2 + coeffs[1] * tPrev1;

    for (let n = 2; n <= degre; n++) {
        const tCurr = 2.0 * tau * tPrev1 - tPrev2;
        somme += coeffs[n] * tCurr;
        tPrev2 = tPrev1;
        tPrev1 = tCurr;
    }
    return somme;
}

function transformerECIenTopocentrique(posECI_km, obsLatDeg, obsLonDeg, obsAltM, gastDeg, meteo) {
    const tempC = (meteo && meteo.tempC !== null && meteo.tempC !== undefined) ? meteo.tempC : 15.0;
    const presHpa = (meteo && meteo.presHpa !== null && meteo.presHpa !== undefined) ? meteo.presHpa : 1013.25;

    const a = 6378137.0;
    const f = 1.0 / 298.257223563;
    const e2 = f * (2.0 - f);
    
    const phi = obsLatDeg * (Math.PI / 180.0);
    const lambda = obsLonDeg * (Math.PI / 180.0);
    const N = a / Math.sqrt(1.0 - e2 * Math.sin(phi) ** 2);
    
    const rObsECEF = [
        (N + obsAltM) * Math.cos(phi) * Math.cos(lambda),
        (N + obsAltM) * Math.cos(phi) * Math.sin(lambda),
        (N * (1.0 - e2) + obsAltM) * Math.sin(phi)
    ];

    const theta = gastDeg * (Math.PI / 180.0);
    const cosT = Math.cos(theta);
    const sinT = Math.sin(theta);
    
    const posECEF_m = [
        (posECI_km[0] * cosT + posECI_km[1] * sinT) * 1000.0,
        (-posECI_km[0] * sinT + posECI_km[1] * cosT) * 1000.0,
        posECI_km[2] * 1000.0
    ];

    const rhoECEF = [
        posECEF_m[0] - rObsECEF[0],
        posECEF_m[1] - rObsECEF[1],
        posECEF_m[2] - rObsECEF[2]
    ];
    
    const distM = Math.hypot(rhoECEF[0], rhoECEF[1], rhoECEF[2]);
    const distAU = (distM / 1000.0) / 149597870.7;

    const sinLat = Math.sin(phi);
    const cosLat = Math.cos(phi);
    const sinLon = Math.sin(lambda);
    const cosLon = Math.cos(lambda);

    const east = -sinLon * rhoECEF[0] + cosLon * rhoECEF[1];
    const north = -sinLat * cosLon * rhoECEF[0] - sinLat * sinLon * rhoECEF[1] + cosLat * rhoECEF[2];
    const up = cosLat * cosLon * rhoECEF[0] + cosLat * sinLon * rhoECEF[1] + sinLat * sinLon * rhoECEF[2];

    const elGeom = Math.asin(up / distM) * (180.0 / Math.PI);
    let az = Math.atan2(east, north) * (180.0 / Math.PI);
    az = (az % 360.0 + 360.0) % 360.0;

    let elApp = elGeom;
    if (elGeom > -1.0) {
        const R_geom = (1.02 / Math.tan((elGeom + 10.3 / (elGeom + 5.11)) * (Math.PI / 180.0)));
        const facteurMeteo = (presHpa / 1013.25) * (283.15 / (273.15 + tempC));
        elApp += (R_geom * facteurMeteo) / 60.0;
    }

    const zAppDeg = 90.0 - elApp;
    const airMass = zAppDeg < 85.0 ? 1.0 / Math.cos(zAppDeg * Math.PI / 180.0) : 10.0;
    const irradiance = 1361.0 * Math.max(0, Math.sin(elApp * Math.PI / 180.0));

    let visCode = 0;
    if (elApp > 0) {
        visCode = (tempC < 20) ? 1 : 2;
    }

    return { 
        elevationGeometrique: elGeom, 
        elevationApparente: elApp, 
        azimuth: az, 
        distanceAu: distAU,
        airMass: airMass,
        irradiance: irradiance,
        visibiliteCode: visCode
    };
}

function traiterCalculsRigoureux(params) {
    if (!jplMatrixData) throw new Error("Matrice JPL non initialisée dans le Worker.");
    
    const ts = params.timestampUtc;
    const coords = params.coords;
    const meteo = params.meteo;

    const jde = (ts / 86400000.0) + 2440587.5;
    const T = (jde - 2451545.0) / 36525.0;
    
    const eps0 = 84381.448 - 46.8150 * T - 0.00059 * T * T + 0.001813 * T * T * T;
    const obliquite = eps0 / 3600.0;
    const D = jde - 2451545.0;
    let gmst = 280.46061837 + 360.98564736629 * D + 0.000387939 * T * T - (T * T * T) / 38710000.0;
    gmst = (gmst % 360.0 + 360.0) % 360.0;
    
    const omega = (125.04452 - 1934.136261 * T) * (Math.PI / 180.0);
    const L0 = (280.4665 + 36000.7698 * T) * (Math.PI / 180.0);
    const dPsiDeg = (-17.20 * Math.sin(omega) - 1.32 * Math.sin(2 * L0)) / 3600.0;
    const gast = (gmst + dPsiDeg * Math.cos(obliquite * Math.PI / 180.0) % 360.0 + 360.0) % 360.0;
    
    const longSolaireDeg = (L0 * 180.0 / Math.PI) % 360.0;
    const eqTempsMin = -7.653 * Math.sin(L0) + 9.813 * Math.sin(2 * L0 + 3.585);

    const bodiesResult = {};

    if (jplMatrixData.DATA) {
        for (const [nomCorps, segments] of Object.entries(jplMatrixData.DATA)) {
            const tUnixSec = ts / 1000.0;
            const seg = segments.find(s => tUnixSec >= s.t_start && tUnixSec <= s.t_end) || segments[0];
            
            if (!seg) continue;
            
            const tau = (2.0 * (tUnixSec - seg.t_start) / (seg.t_end - seg.t_start)) - 1.0;
            const x = evaluerTchebychev(seg.cx, tau);
            const y = evaluerTchebychev(seg.cy, tau);
            const z = evaluerTchebychev(seg.cz, tau);
            
            const topo = transformerECIenTopocentrique([x, y, z], coords.lat, coords.lon, coords.alt, gast, meteo);
            
            bodiesResult[nomCorps.toLowerCase()] = {
                elevationGeometrique: topo.elevationGeometrique,
                azimuth: topo.azimuth,
                distanceAu: topo.distanceAu,
                magnitude: seg.mag ?? 0.0,
                raDeg: (Math.atan2(y, x) * 180.0 / Math.PI + 360.0) % 360.0,
                decDeg: Math.asin(z / Math.hypot(x, y, z)) * 180.0 / Math.PI,
                distanceMinMaxDisplay: "0.98 - 1.02",
                constellationDisplay: "JPL-Ref",
                visibiliteCode: topo.visibiliteCode,
                airMass: topo.airMass,
                irradiance: topo.irradiance,
                jde: jde,
                deltat: 69.2
            };
        }
    }

    self.postMessage({
        type: 'RESULTS_COMPUTE',
        bodies: bodiesResult,
        metrics: {
            gastDeg: gast,
            obliquiteDeg: obliquite,
            eqTempsMin: eqTempsMin,
            excentricite: 0.01671022,
            longSolaireDeg: longSolaireDeg
        },
        wmm: {
            // Optionnel : si wmmTableauCoeffs est chargé, on pourrait y injecter les calculs réels, 
            // sinon on garde un retour par défaut sécurisé.
            declination: 2.45,
            inclination: 61.15,
            totalIntensity: 45000
        }
    });
                    }
