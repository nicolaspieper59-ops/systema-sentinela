/**
 * SYSTEMA SENTINELA v18.6.1 - Worker Astronomique & Géomagnétique
 * Gère le calcul des positions célestes, de la réfraction et du champ WMM2025.
 */

let wmmCoeffs = [];
let isWmmLoaded = false;

// 1. Module de Parsing WMM-2025
function parseWMM2025(cofText) {
    wmmCoeffs = [];
    const lines = cofText.split('\n');
    for (let line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('9999') || trimmed.startsWith('2025')) continue;
        const p = trimmed.split(/\s+/);
        if (p.length >= 6) {
            const n = parseInt(p[0], 10);
            const m = parseInt(p[1], 10);
            if (!isNaN(n) && n <= 12) {
                wmmCoeffs.push({
                    n, m,
                    g: parseFloat(p[2]),
                    h: parseFloat(p[3]),
                    dg: parseFloat(p[4]),
                    dh: parseFloat(p[5])
                });
            }
        }
    }
    isWmmLoaded = wmmCoeffs.length > 0;
}

// 2. Solveur Géomagnétique WMM2025
function computeWMM2025(latDeg, lonDeg, altKm, decimalYear) {
    if (!isWmmLoaded) return { declination: 0, inclination: 0, horizontal: 0, total: 0 };

    const dt = decimalYear - 2025.0;
    const rad = Math.PI / 180;
    const latRad = latDeg * rad;
    const lonRad = lonDeg * rad;

    const a = 6378.137;
    const b = 6356.7523142;
    const re = 6371.2;

    const sinLat = Math.sin(latRad);
    const cosLat = Math.cos(latRad);
    const rho = Math.sqrt(a * a * cosLat * cosLat + b * b * sinLat * sinLat);

    const r = Math.sqrt(altKm * altKm + 2 * altKm * rho + (Math.pow(a, 4) * cosLat * cosLat + Math.pow(b, 4) * sinLat * sinLat) / (rho * rho));
    const cd = (altKm + rho) / r;
    const sd = (a * a - b * b) / (r * rho) * sinLat * cosLat;

    const theta = Math.acos(cosLat * cd - sinLat * sd);
    const phi = lonRad;

    let Br = 0, Btheta = 0, Bphi = 0;

    let P = Array.from({ length: 13 }, () => new Array(13).fill(0));
    let dP = Array.from({ length: 13 }, () => new Array(13).fill(0));

    P[0][0] = 1;
    const cosT = Math.cos(theta);
    const sinT = Math.sin(theta);

    for (let n = 1; n <= 12; n++) {
        for (let m = 0; m <= n; m++) {
            if (n === m) {
                P[n][n] = sinT * P[n - 1][n - 1];
                dP[n][n] = sinT * dP[n - 1][n - 1] + cosT * P[n - 1][n - 1];
            } else if (n === 1 && m === 0) {
                P[1][0] = cosT;
                dP[1][0] = -sinT;
            } else if (m === 0) {
                const K = ((n - 1) * (n - 1)) / ((2 * n - 1) * (2 * n - 3));
                P[n][0] = cosT * P[n - 1][0] - K * P[n - 2][0];
                dP[n][0] = -sinT * P[n - 1][0] + cosT * dP[n - 1][0] - K * dP[n - 2][0];
            } else {
                const K = ((n - 1) * (n - 1) - m * m) / ((2 * n - 1) * (2 * n - 3));
                P[n][m] = cosT * P[n - 1][m] - K * P[n - 2][m];
                dP[n][m] = -sinT * P[n - 1][m] + cosT * dP[n - 1][m] - K * dP[n - 2][m];
            }
        }
    }

    for (let coeff of wmmCoeffs) {
        const { n, m, g, h, dg, dh } = coeff;
        const gt = g + dg * dt;
        const ht = h + dh * dt;

        const ratio = Math.pow(re / r, n + 2);
        const cosM = Math.cos(m * phi);
        const sinM = Math.sin(m * phi);

        Br -= (n + 1) * ratio * (gt * cosM + ht * sinM) * P[n][m];
        Btheta -= ratio * (gt * cosM + ht * sinM) * dP[n][m];
        Bphi -= ratio * (m / (sinT || 1e-6)) * (-gt * sinM + ht * cosM) * P[n][m];
    }

    const Bx = -Btheta * cd - Br * sd;
    const By = Bphi;
    const Bz = Btheta * sd - Br * cd;

    const H = Math.sqrt(Bx * Bx + By * By);
    const D = Math.atan2(By, Bx) * (180 / Math.PI);
    const I = Math.atan2(Bz, H) * (180 / Math.PI);
    const F = Math.sqrt(H * H + Bz * Bz);

    return { declination: D, inclination: I, horizontal: H, total: F };
}

// 3. Conversion Topocentrique et Échelle de Distance Correcte (en Km)
function topocentrique(latDeg, lonDeg, altKm, posCorpsECEF) {
    const phi = latDeg * Math.PI / 180;
    const lambda = lonDeg * Math.PI / 180;
    
    // Position ECEF de l'observateur WGS84
    const a = 6378.137;
    const e2 = 0.00669437999014;
    const N = a / Math.sqrt(1 - e2 * Math.sin(phi) * Math.sin(phi));
    const obsX = (N + altKm) * Math.cos(phi) * Math.cos(lambda);
    const obsY = (N + altKm) * Math.cos(phi) * Math.sin(lambda);
    const obsZ = (N * (1 - e2) + altKm) * Math.sin(phi);

    const dx = posCorpsECEF.x - obsX;
    const dy = posCorpsECEF.y - obsY;
    const dz = posCorpsECEF.z - obsZ;

    const e = -Math.sin(lambda) * dx + Math.cos(lambda) * dy;
    const n = -Math.sin(phi) * Math.cos(lambda) * dx - Math.sin(phi) * Math.sin(lambda) * dy + Math.cos(phi) * dz;
    const u =  Math.cos(phi) * Math.cos(lambda) * dx + Math.cos(phi) * Math.sin(lambda) * dy + Math.sin(phi) * dz;

    const az = (Math.atan2(e, n) * 180 / Math.PI + 360) % 360;
    const elGeom = Math.asin(u / Math.sqrt(e*e + n*n + u*u)) * 180 / Math.PI;
    const distKm = Math.sqrt(dx * dx + dy * dy + dz * dz); // Distance réelle en km

    return { azimuth: az, elevationGeometrique: elGeom, distanceKm: distKm };
}

// 4. Réfraction Atmosphérique Bennett-Tetens (Dynamique Météo)
function refracter(altDeg, tempC, humidityPct, pressureHpa) {
    if (altDeg < -1.0) return altDeg;
    const deg2rad = Math.PI / 180;

    const altCorrRad = (10.3 / (altDeg + 5.1)) * deg2rad;
    const refStdArcMin = 1.02 / Math.tan(altDeg * deg2rad + altCorrRad);

    const e_sat = 6.1121 * Math.exp((17.502 * tempC) / (240.97 + tempC));
    const e_vapeur = (humidityPct / 100.0) * e_sat;
    const P_effective = pressureHpa - 0.1507 * e_vapeur;

    const factor = (P_effective / 1013.25) * (288.15 / (273.15 + tempC));
    return altDeg + ((refStdArcMin * factor) / 60.0);
}

// Handler de messages du Worker
self.onmessage = function (e) {
    const data = e.data;

    if (data.type === 'INIT_WMM') {
        parseWMM2025(data.cofText);
        self.postMessage({ type: 'WMM_READY' });
        return;
    }

    if (data.type === 'CALCULATE') {
        const { timestampUtc, position, meteo, ecefBodies } = data;
        const dateUtc = new Date(timestampUtc);

        // Date décimale pour WMM2025
        const startOfYear = Date.UTC(dateUtc.getUTCFullYear(), 0, 1);
        const endOfYear = Date.UTC(dateUtc.getUTCFullYear() + 1, 0, 1);
        const decimalYear = dateUtc.getUTCFullYear() + (timestampUtc - startOfYear) / (endOfYear - startOfYear);

        // 1. Calcul du champ géomagnétique
        const wmmResult = computeWMM2025(position.lat, position.lon, position.alt, decimalYear);

        // 2. Calcul des positions célestes topocentriques
        const resultsBodies = {};
        if (ecefBodies) {
            for (let name in ecefBodies) {
                const topo = topocentrique(position.lat, position.lon, position.alt, ecefBodies[name]);
                const elevationApparente = refracter(topo.elevationGeometrique, meteo.temp, meteo.humidity, meteo.pressure);

                resultsBodies[name] = {
                    azimuth: topo.azimuth,
                    elevation: elevationApparente,
                    elevationGeometrique: topo.elevationGeometrique,
                    distanceKm: topo.distanceKm
                };
            }
        }

        self.postMessage({
            type: 'UPDATE',
            timestampUtc: timestampUtc,
            wmm: wmmResult,
            bodies: resultsBodies
        });
    }
};
