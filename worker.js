/**
 * WORKER ASTRONOMIQUE SYSTEMA SENTINELA — KERNEL RIGOREUX (IAU-2006 / WGS84)
 */

let jplMatrixData = null;

self.onmessage = function (e) {
    const data = e.data;
    if (!data) return;

    switch (data.type) {
        case 'UPDATE_JPL_MATRIX':
            jplMatrixData = null; // Nettoyage de mémoire
            jplMatrixData = data.matrix;
            break;
        case 'COMPUTE':
            traiterCalculsRigoureux(data);
            break;
    }
};

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

function calculerJDE(ts) {
    return (ts / 86400000.0) + 2440587.5;
}

function calculerObliquite(T) {
    const eps0 = 84381.448 - 46.8150 * T - 0.00059 * T * T + 0.001813 * T * T * T;
    return eps0 / 3600.0;
}

function calculerGMST(jd) {
    const D = jd - 2451545.0;
    const T = D / 36525.0;
    let gmst = 280.46061837 + 360.98564736629 * D + 0.000387939 * T * T - (T * T * T) / 38710000.0;
    return (gmst % 360.0 + 360.0) % 360.0;
}

function calculerGAST(jd, obliquiteDeg) {
    const T = (jd - 2451545.0) / 36525.0;
    const omega = (125.04452 - 1934.136261 * T) * (Math.PI / 180.0);
    const L0 = (280.4665 + 36000.7698 * T) * (Math.PI / 180.0);
    const dPsiDeg = (-17.20 * Math.sin(omega) - 1.32 * Math.sin(2 * L0)) / 3600.0;
    const gmst = calculerGMST(jd);
    const eqEq = dPsiDeg * Math.cos(obliquiteDeg * Math.PI / 180.0);
    return (gmst + eqEq % 360.0 + 360.0) % 360.0;
}

function transformerECIenTopocentrique(posECI_km, obsLatDeg, obsLonDeg, obsAltM, gastDeg) {
    const a = 6378137.0;
    const f = 1.0 / 298.257223563;
    const e2 = f * (2.0 - f);
    
    const phi = obsLatDeg * (Math.PI / 180.0);
    const lambda = obsLonDeg * (Math.PI / 180.0);
    const N = a / Math.sqrt(1.0 - e2 * Math.sin(phi) ** 2);
    
    // Position Observateur WGS84 -> ECEF
    const rObsECEF = [
        (N + obsAltM) * Math.cos(phi) * Math.cos(lambda),
        (N + obsAltM) * Math.cos(phi) * Math.sin(lambda),
        (N * (1.0 - e2) + obsAltM) * Math.sin(phi)
    ];

    // Passage ECI -> ECEF de l'astre
    const theta = gastDeg * (Math.PI / 180.0);
    const cosT = Math.cos(theta);
    const sinT = Math.sin(theta);
    
    const posECEF_m = [
        (posECI_km[0] * cosT + posECI_km[1] * sinT) * 1000.0,
        (-posECI_km[0] * sinT + posECI_km[1] * cosT) * 1000.0,
        posECI_km[2] * 1000.0
    ];

    // Vecteur relatif ECEF
    const rhoECEF = [
        posECEF_m[0] - rObsECEF[0],
        posECEF_m[1] - rObsECEF[1],
        posECEF_m[2] - rObsECEF[2]
    ];
    
    const distM = Math.hypot(rhoECEF[0], rhoECEF[1], rhoECEF[2]);
    const distAU = (distM / 1000.0) / 149597870.7;

    // Matrice ECEF -> ENU
    const sinLat = Math.sin(phi);
    const cosLat = Math.cos(phi);
    const sinLon = Math.sin(lambda);
    const cosLon = Math.cos(lambda);

    const east = -sinLon * rhoECEF[0] + cosLon * rhoECEF[1];
    const north = -sinLat * cosLon * rhoECEF[0] - sinLat * sinLon * rhoECEF[1] + cosLat * rhoECEF[2];
    const up = cosLat * cosLon * rhoECEF[0] + cosLat * sinLon * rhoECEF[1] + sinLat * rhoECEF[2];

    const elGeom = Math.asin(up / distM) * (180.0 / Math.PI);
    let az = Math.atan2(east, north) * (180.0 / Math.PI);
    az = (az % 360.0 + 360.0) % 360.0;

    // Réfraction atmosphérique (Formule de Bennett)
    let elApp = elGeom;
    if (elGeom > -1.0) {
        const R = (1.02 / Math.tan((elGeom + 10.3 / (elGeom + 5.11)) * (Math.PI / 180.0))) / 60.0;
        elApp += R;
    }

    return { elevationApparente: elApp, azimuth: az, distanceAu: distAU };
}

function traiterCalculsRigoureux(params) {
    const ts = params.timestampUtc;
    const coords = params.coords;
    const jde = calculerJDE(ts);
    const T = (jde - 2451545.0) / 36525.0;
    
    const obliquite = calculerObliquite(T);
    const gast = calculerGAST(jde, obliquite);
    
    const bodiesResult = {};

    if (jplMatrixData && jplMatrixData.DATA) {
        for (const [nomCorps, segments] of Object.entries(jplMatrixData.DATA)) {
            const tUnixSec = ts / 1000.0;
            const seg = segments.find(s => tUnixSec >= s.t_start && tUnixSec <= s.t_end);
            
            if (seg) {
                const tau = (2.0 * (tUnixSec - seg.t_start) / (seg.t_end - seg.t_start)) - 1.0;
                
                const x = evaluerTchebychev(seg.cx, tau);
                const y = evaluerTchebychev(seg.cy, tau);
                const z = evaluerTchebychev(seg.cz, tau);
                
                const topo = transformerECIenTopocentrique([x, y, z], coords.lat, coords.lon, coords.alt, gast);
                
                bodiesResult[nomCorps.toLowerCase()] = {
                    elevation: topo.elevationApparente,
                    azimuth: topo.azimuth,
                    distanceAu: topo.distanceAu,
                    magnitude: seg.mag
                };
            }
        }
    }

    self.postMessage({ type: 'RESULTS_COMPUTE', bodies: bodiesResult });
        }
