/**
 * WORKER ASTRONOMIQUE SYSTEMA SENTINELA — KERNEL STRICT v19.18
 */

let jplMatrixData = null;
let wmmTableauCoeffs = null;

self.postMessage({ type: 'WORKER_READY' });

self.onmessage = function (e) {
    try {
        const data = e.data;
        if (!data) throw new Error("Message vide reçu par le Worker.");

        switch (data.type) {
            case 'UPDATE_JPL_MATRIX':
                if (!data.matrix) throw new Error("Matrice JPL fournie invalide.");
                jplMatrixData = data.matrix;
                self.postMessage({ type: 'JPL_MATRIX_UPDATED' }); 
                break;

            case 'LOAD_WMM_COF_TEXT':
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

function analyserTexteWMM(texte) {
    const lignes = texte.split('\n');
    const coeffs = [];
    for (let ligne of lignes) {
        const lineTrim = ligne.trim();
        if (!lineTrim || lineTrim.startsWith('99999999') || lineTrim.startsWith('WMM') || lineTrim.startsWith('2025')) continue;
        const elements = lineTrim.split(/\s+/);
        if (elements.length >= 6) {
            const n = parseInt(elements[0], 10);
            const m = parseInt(elements[1], 10);
            if (!isNaN(n) && !isNaN(m) && n <= 12) {
                coeffs.push({
                    n: n,
                    m: m,
                    gnm: parseFloat(elements[2]),
                    hnm: parseFloat(elements[3]),
                    dgnm: parseFloat(elements[4]),
                    dhnm: parseFloat(elements[5])
                });
            }
        }
    }
    if (coeffs.length === 0) throw new Error("Échec critique du parsing des coefficients WMM.");
    return coeffs;
}

function calculerWMM12x12Complet(latDeg, lonDeg, altKm, decimalYear) {
    if (!wmmTableauCoeffs) return { declination: 0.0, inclination: 0.0, totalIntensity: 0.0 };

    const dt = decimalYear - 2025.0;
    const rad = Math.PI / 180.0;
    const phi = latDeg * rad;
    const lambda = lonDeg * rad;

    const a = 6371.2;
    const r = a + altKm;
    const altRatio = a / r;

    const nMax = 12;
    let P = Array.from({ length: nMax + 1 }, () => new Array(nMax + 1).fill(0.0));
    let dP = Array.from({ length: nMax + 1 }, () => new Array(nMax + 1).fill(0.0));

    const sinPhi = Math.sin(phi);
    const cosPhi = Math.max(1e-6, Math.cos(phi));

    P[0][0] = 1.0;
    dP[0][0] = 0.0;

    // Calcul des polynômes de Legendre semi-normalisés de Schmidt
    for (let n = 1; n <= nMax; n++) {
        for (let m = 0; m <= n; m++) {
            if (n === m) {
                P[n][n] = sinPhi * P[n - 1][n - 1];
                dP[n][n] = sinPhi * dP[n - 1][n - 1] + cosPhi * P[n - 1][n - 1];
            } else if (n === 1 && m === 0) {
                P[1][0] = sinPhi;
                dP[1][0] = cosPhi;
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

        const g = c.gnm + (c.dgnm || 0) * dt;
        const h = c.hnm + (c.dhnm || 0) * dt;

        let q_pow = Math.pow(altRatio, c.n + 2);
        const cosMlam = Math.cos(c.m * lambda);
        const sinMlam = Math.sin(c.m * lambda);

        const cos_term = g * cosMlam + h * sinMlam;
        const sin_term = g * sinMlam - h * cosMlam;

        B_r += q_pow * (c.n + 1) * P[c.n][c.m] * cos_term;
        B_theta -= q_pow * dP[c.n][c.m] * cos_term;
        if (c.m > 0) {
            B_phi += q_pow * (c.m / cosPhi) * P[c.n][c.m] * sin_term;
        }
    }

    const X = -B_theta;
    const Y = B_phi;
    const Z = -B_r;
    const H = Math.hypot(X, Y);
    const F = Math.hypot(H, Z);

    return {
        declination: Math.atan2(Y, X) * (180.0 / Math.PI),
        inclination: Math.atan2(Z, H) * (180.0 / Math.PI),
        totalIntensity: Math.abs(F)
    };
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

function transformerECIenTopocentrique(posECI_km, obsLatDeg, obsLonDeg, obsAltM, gastDeg, meteo, estSoleil) {
    if (!meteo || meteo.tempC === undefined || meteo.presHpa === undefined) {
        throw new Error("Paramètres météorologiques de terrain requis pour la réfraction.");
    }

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
        const facteurMeteo = (meteo.presHpa / 1013.25) * (283.15 / (273.15 + meteo.tempC));
        elApp += (R_geom * facteurMeteo) / 60.0;
    }

    const zAppDeg = 90.0 - elApp;
    const airMass = zAppDeg < 85.0 ? 1.0 / Math.cos(zAppDeg * Math.PI / 180.0) : -1.0;
    
    // Irradiance et longueur d'ombre calculées exclusivement pour le Soleil
    const irradiance = (estSoleil && elApp > 0) ? (1361.0 / (distAU * distAU)) * Math.pow(0.7, Math.max(0, airMass)) : 0.0;
    const shadowLength = (estSoleil && elApp > 0) ? 1.0 / Math.tan(Math.max(1e-4, elApp * (Math.PI / 180.0))) : -1.0;

    let visCode = 0;
    if (elApp > 0) {
        visCode = (meteo.tempC < 20) ? 1 : 2;
    }

    return { 
        elevationGeometrique: elGeom, 
        elevationApparente: elApp, 
        azimuth: az, 
        distanceAu: distAU,
        airMass: airMass,
        irradiance: irradiance,
        shadowLength: shadowLength,
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
    const decimalYear = 2000.0 + (jde - 2451545.0) / 365.25;
    
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
    let posSoleilRA = 0.0;
    let posLuneRA = 0.0;

    if (jplMatrixData.DATA) {
        for (const [nomCorps, segments] of Object.entries(jplMatrixData.DATA)) {
            const tUnixSec = ts / 1000.0;
            const seg = segments.find(s => tUnixSec >= s.t_start && tUnixSec <= s.t_end);
            if (!seg) {
                throw new Error(`Timestamp UTC (${tUnixSec}) hors de la plage des éphémérides JPL pour le corps : ${nomCorps}.`);
            }
            
            const tau = (2.0 * (tUnixSec - seg.t_start) / (seg.t_end - seg.t_start)) - 1.0;
            const x = evaluerTchebychev(seg.cx, tau);
            const y = evaluerTchebychev(seg.cy, tau);
            const z = evaluerTchebychev(seg.cz, tau);
            
            const estSoleil = (nomCorps.toUpperCase() === "SOLEIL");
            const topo = transformerECIenTopocentrique([x, y, z], coords.lat, coords.lon, coords.alt, gast, meteo, estSoleil);
            
            const raDeg = (Math.atan2(y, x) * 180.0 / Math.PI + 360.0) % 360.0;
            if (estSoleil) posSoleilRA = raDeg;
            if (nomCorps.toUpperCase() === "LUNE") posLuneRA = raDeg;

            bodiesResult[nomCorps.toLowerCase()] = {
                elevationGeometrique: topo.elevationGeometrique,
                elevationApparente: topo.elevationApparente,
                azimuth: topo.azimuth,
                distanceAu: topo.distanceAu,
                magnitude: seg.mag ?? 0.0,
                raDeg: raDeg,
                decDeg: Math.asin(z / Math.hypot(x, y, z)) * 180.0 / Math.PI,
                visibiliteCode: topo.visibiliteCode,
                airMass: topo.airMass,
                irradiance: topo.irradiance,
                jde: jde,
                deltat: 69.2,
                gha: (gast - raDeg + 360.0) % 360.0,
                distanceMinMaxDisplay: `${topo.distanceAu.toFixed(6)} AU`,
                constellationDisplay: "JPL-DE440s",
                perigeeDisplay: seg.perigee_ua ? `${seg.perigee_ua.toFixed(5)} AU` : "--",
                perihelionDisplay: seg.perihelion_ua ? `${seg.perihelion_ua.toFixed(4)} AU` : "--",
                aphelionDisplay: seg.aphelion_ua ? `${seg.aphelion_ua.toFixed(4)} AU` : "--",
                orbitPeriodDisplay: seg.period_days ? `${seg.period_days.toFixed(1)} j` : "--",
                lengthOfDayDisplay: seg.lod_hours ? `${seg.lod_hours.toFixed(1)} h` : "--",
                orbitalVelocityDisplay: seg.vel_kms ? `${seg.vel_kms.toFixed(2)} km/s` : "--",
                shadowLengthDisplay: topo.shadowLength > 0 ? `${topo.shadowLength.toFixed(2)} m` : "N/A",
                sunrise: topo.elevationApparente >= -0.833 ? "Visible" : "Sous horizon",
                sunset: topo.elevationApparente < -0.833 ? "Couché" : "Au-dessus horizon",
                dusk: topo.elevationApparente < -6.0 ? "Nuit" : "Crépuscule/Jour",
                daylightDuration: topo.elevationApparente > 0 ? "Jour" : "Nuit"
            };
        }

        // Calcul dynamique rigoureux de la phase et de l'âge lunaires
        if (bodiesResult["lune"]) {
            let elongDeg = (posLuneRA - posSoleilRA + 360.0) % 360.0;
            let moonPhasePct = (1.0 - Math.cos(elongDeg * Math.PI / 180.0)) / 2.0 * 100.0;
            let moonAgeDays = (elongDeg / 360.0) * 29.530588;
            bodiesResult["lune"].moonPhasePct = moonPhasePct;
            bodiesResult["lune"].moonAgeDays = moonAgeDays;
        }
    }

    const resultatWmm = calculerWMM12x12Complet(coords.lat, coords.lon, coords.alt / 1000.0, decimalYear);

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
        wmm: resultatWmm
    });
        }
