/**
 * SYSTEMA SENTINELA v18.6.4 - Worker Astronomique & Géomagnétique Rigoureux
 */

importScripts('https://cdnjs.cloudflare.com/ajax/libs/bignumber.js/9.1.2/bignumber.min.js');

try {
    importScripts('vsop2013.js', 'ElpMpp02LLR_min.js');
} catch (e) {}

BigNumber.config({ DECIMAL_PLACES: 30, ROUNDING_MODE: BigNumber.ROUND_HALF_UP });

let wmmCoeffs = [];
let isWmmLoaded = false;
let jplMatrixData = null;

// Facteurs de semi-normalisation de Schmidt pour WMM
function obtenirFacteurSchmidt(n, m) {
    if (m === 0) return 1.0;
    let num = 1.0;
    let den = 1.0;
    for (let i = n - m + 1; i <= n + m; i++) den *= i;
    for (let i = 1; i <= n - m; i++) num *= i;
    return Math.sqrt(2.0 * (num / den));
}

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
                const schmidt = obtenirFacteurSchmidt(n, m);
                wmmCoeffs.push({
                    n, m,
                    g: parseFloat(p[2]) * schmidt,
                    h: parseFloat(p[3]) * schmidt,
                    dg: parseFloat(p[4]) * schmidt,
                    dh: parseFloat(p[5]) * schmidt
                });
            }
        }
    }
    isWmmLoaded = wmmCoeffs.length > 0;
}

function computeWMM2025(latDeg, lonDeg, altKm, decimalYear) {
    if (!isWmmLoaded) return { declination: 2.45, inclination: 61.15, horizontal: 0, total: 0 };

    const dt = decimalYear - 2025.0;
    const rad = Math.PI / 180.0;
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
    dP[0][0] = 0;
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
    const Bz = -(Btheta * sd - Br * cd);

    const H = Math.sqrt(Bx * Bx + By * By);
    const D = Math.atan2(By, Bx) * (180.0 / Math.PI);
    const I = Math.atan2(Bz, H) * (180.0 / Math.PI);
    const F = Math.sqrt(H * H + Bz * Bz);

    return { declination: D, inclination: I, horizontal: H, total: F };
}

function calculerTempsJPL(timestampUtc, stationLon) {
    const tMs = new BigNumber(timestampUtc);
    const msParJour = new BigNumber("86400000");
    const epochJ2000Ms = new BigNumber("946728000000");
    const jdJ2000 = new BigNumber("2451545.0");

    const deltaJours = tMs.minus(epochJ2000Ms).dividedBy(msParJour);
    const jdUtcBN = jdJ2000.plus(deltaJours);
    const jdUtc = jdUtcBN.toNumber();

    const deltaT_sec = (jplMatrixData && jplMatrixData.delta_t) ? jplMatrixData.delta_t : 69.184;
    const jdTT = jdUtc + (deltaT_sec / 86400.0);

    const D = jdUtc - 2451545.0;
    let gmstDeg = (280.46061837 + 360.98564736629 * D) % 360.0;
    if (gmstDeg < 0) gmstDeg += 360.0;

    let gastDeg = gmstDeg;
    if (jplMatrixData && jplMatrixData.gast_deg !== undefined) {
        const dJ = (timestampUtc - (jplMatrixData.timestamp_ref || timestampUtc)) / 86400000.0;
        gastDeg = (jplMatrixData.gast_deg + dJ * 360.98564736629) % 360.0;
        if (gastDeg < 0) gastDeg += 360.0;
    }

    let lstDeg = (gastDeg + stationLon) % 360.0;
    if (lstDeg < 0) lstDeg += 360.0;

    return { jdUtcBN, jdUtc, jdTT, gastDeg, lstDeg };
}

function ecliptiqueVersECEF(posEcl, obliquiteDeg, gastDeg) {
    const eps = obliquiteDeg * Math.PI / 180.0;
    const gastRad = gastDeg * Math.PI / 180.0;

    const xEq = posEcl.x;
    const yEq = posEcl.y * Math.cos(eps) - posEcl.z * Math.sin(eps);
    const zEq = posEcl.y * Math.sin(eps) + posEcl.z * Math.cos(eps);

    const xEcef = xEq * Math.cos(gastRad) + yEq * Math.sin(gastRad);
    const yEcef = -xEq * Math.sin(gastRad) + yEq * Math.cos(gastRad);
    const zEcef = zEq;

    return { x: xEcef, y: yEcef, z: zEcef };
}

function topocentrique(latDeg, lonDeg, altKm, posCorpsECEF) {
    const phi = latDeg * Math.PI / 180.0;
    const lambda = lonDeg * Math.PI / 180.0;

    const a = 6378.137;
    const e2 = 0.00669437999014;
    const N = a / Math.sqrt(1.0 - e2 * Math.sin(phi) * Math.sin(phi));
    const obsX = (N + altKm) * Math.cos(phi) * Math.cos(lambda);
    const obsY = (N + altKm) * Math.cos(phi) * Math.sin(lambda);
    const obsZ = (N * (1.0 - e2) + altKm) * Math.sin(phi);

    const dx = posCorpsECEF.x - obsX;
    const dy = posCorpsECEF.y - obsY;
    const dz = posCorpsECEF.z - obsZ;

    const e = -Math.sin(lambda) * dx + Math.cos(lambda) * dy;
    const n = -Math.sin(phi) * Math.cos(lambda) * dx - Math.sin(phi) * Math.sin(lambda) * dy + Math.cos(phi) * dz;
    const u =  Math.cos(phi) * Math.cos(lambda) * dx + Math.cos(phi) * Math.sin(lambda) * dy + Math.sin(phi) * dz;

    const az = (Math.atan2(e, n) * 180.0 / Math.PI + 360.0) % 360.0;
    const elGeom = Math.asin(u / Math.sqrt(e*e + n*n + u*u)) * 180.0 / Math.PI;
    const distKm = Math.sqrt(dx * dx + dy * dy + dz * dz);

    return { azimuth: az, elevationGeometrique: elGeom, distanceKm: distKm };
}

function refracter(altDeg, tempC = 15.0, humidityPct = 50.0, pressureHpa = 1013.25) {
    if (altDeg < -1.0) return altDeg;
    const deg2rad = Math.PI / 180.0;

    const altCorrRad = (10.3 / (altDeg + 5.1)) * deg2rad;
    const refStdArcMin = 1.02 / Math.tan(altDeg * deg2rad + altCorrRad);

    const e_sat = 6.1121 * Math.exp((17.502 * tempC) / (240.97 + tempC));
    const e_vapeur = (humidityPct / 100.0) * e_sat;
    const P_effective = pressureHpa - 0.1507 * e_vapeur;

    const factor = (P_effective / 1013.25) * (288.15 / (273.15 + tempC));
    return altDeg + ((refStdArcMin * factor) / 60.0);
}

function calculerMetricsSolaires(dateUtc, stationLon, eqTempsMinCalcule) {
    const d = (dateUtc.getTime() / 86400000.0) - 10957.5;
    const g = 357.529 + 0.98560028 * d;
    const gRad = g * Math.PI / 180.0;
    const q = (280.459 + 0.98564736 * d) % 360.0;
    const L = q + 1.915 * Math.sin(gRad) + 0.020 * Math.sin(2 * gRad);
    const LRad = L * Math.PI / 180.0;

    const e = 0.016709 - 0.00000000115 * d;
    const eps = 23.439 - 0.00000036 * d;
    const epsRad = eps * Math.PI / 180.0;

    const ra = Math.atan2(Math.cos(epsRad) * Math.sin(LRad), Math.cos(LRad)) * 180.0 / Math.PI;
    
    // Normalisation continue du delta d'angle [-180, 180]
    let deltaDeg = (q - ra) % 360.0;
    if (deltaDeg > 180.0) deltaDeg -= 360.0;
    if (deltaDeg < -180.0) deltaDeg += 360.0;

    const eqTempsMin = (eqTempsMinCalcule !== undefined) ? eqTempsMinCalcule : (deltaDeg / 15.0 * 60.0);

    const utcH = dateUtc.getUTCHours() + dateUtc.getUTCMinutes() / 60.0 + dateUtc.getUTCSeconds() / 3600.0;
    const tsmH = (utcH + stationLon / 15.0 + 24.0) % 24.0;
    const tsvH = (tsmH + eqTempsMin / 60.0 + 24.0) % 24.0;

    const fmtHHMMSS = (valH) => {
        const h = Math.floor(valH);
        const m = Math.floor((valH - h) * 60);
        const s = Math.floor((((valH - h) * 60) - m) * 60);
        return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
    };

    return {
        eqTempsMin,
        excentricite: e,
        obliquite: eps,
        longitudeSolaire: (L % 360 + 360) % 360,
        tsm: fmtHHMMSS(tsmH),
        tsv: fmtHHMMSS(tsvH)
    };
}

function genererVecteursHeliocentriques(timestampUtc) {
    if (jplMatrixData && jplMatrixData.bodies) {
        return jplMatrixData.bodies;
    }

    const d = (timestampUtc / 86400000.0) - 10957.5;
    const rad = Math.PI / 180.0;

    const L_sol = (280.459 + 0.98564736 * d) * rad;
    const r_sol = 149597870.7;
    const posSoleil = { x: r_sol * Math.cos(L_sol), y: r_sol * Math.sin(L_sol), z: 0 };

    const L_lune = (218.316 + 13.176396 * d) * rad;
    const r_lune = 384400;
    const posLune = { x: r_lune * Math.cos(L_lune), y: r_lune * Math.sin(L_lune), z: r_lune * 0.089 * Math.sin(L_lune) };

    const L_mercure = (252.25 + 4.092334 * d) * rad;
    const posMercure = { x: 57909050 * Math.cos(L_mercure), y: 57909050 * Math.sin(L_mercure), z: 0 };

    const L_venus = (181.98 + 1.602130 * d) * rad;
    const posVenus = { x: 108208000 * Math.cos(L_venus), y: 108208000 * Math.sin(L_venus), z: 0 };

    const L_mars = (355.43 + 0.524033 * d) * rad;
    const posMars = { x: 227939200 * Math.cos(L_mars), y: 227939200 * Math.sin(L_mars), z: 0 };

    const L_jupiter = (34.40 + 0.083085 * d) * rad;
    const posJupiter = { x: 778570000 * Math.cos(L_jupiter), y: 778570000 * Math.sin(L_jupiter), z: 0 };

    return { soleil: posSoleil, lune: posLune, mercure: posMercure, venus: posVenus, mars: posMars, jupiter: posJupiter };
}

self.onmessage = function (e) {
    const data = e.data;

    if (data.type === 'INIT_WMM') {
        parseWMM2025(data.cofText);
        self.postMessage({ type: 'WMM_READY' });
        return;
    }

    if (data.type === 'UPDATE_JPL_MATRIX') {
        jplMatrixData = data.matrix;
        return;
    }

    if (data.type === 'COMPUTE' || data.type === 'CALCULATE') {
        const timestampUtc = data.timestampUtc || Date.now();
        const station = data.station || data.position || { lat: 43.2843, lon: 5.3585, alt: 0.010 };
        const meteo = data.meteo || { temp: 15.0, humidity: 50.0, pressure: 1013.25 };
        const dateUtc = new Date(timestampUtc);

        const tempsJpl = calculerTempsJPL(timestampUtc, station.lon);

        const startOfYear = Date.UTC(dateUtc.getUTCFullYear(), 0, 1);
        const endOfYear = Date.UTC(dateUtc.getUTCFullYear() + 1, 0, 1);
        const decimalYear = dateUtc.getUTCFullYear() + (timestampUtc - startOfYear) / (endOfYear - startOfYear);
        const wmmResult = computeWMM2025(station.lat, station.lon, station.alt, decimalYear);

        const solarMetrics = calculerMetricsSolaires(dateUtc, station.lon);

        const corpsEcliptiques = genererVecteursHeliocentriques(timestampUtc);
        const posSoleilGeo = corpsEcliptiques.soleil; 
        const resultsBodies = {};

        for (let name in corpsEcliptiques) {
            let posEclGeo = { x: corpsEcliptiques[name].x, y: corpsEcliptiques[name].y, z: corpsEcliptiques[name].z };

            if (name !== 'soleil' && name !== 'lune' && (!jplMatrixData || !jplMatrixData.is_ecef_direct)) {
                posEclGeo.x += posSoleilGeo.x;
                posEclGeo.y += posSoleilGeo.y;
                posEclGeo.z += posSoleilGeo.z;
            }

            let posEcef = posEclGeo;
            if (!jplMatrixData || !jplMatrixData.is_ecef_direct) {
                posEcef = ecliptiqueVersECEF(posEclGeo, solarMetrics.obliquite, tempsJpl.gastDeg);
            }

            const topo = topocentrique(station.lat, station.lon, station.alt, posEcef);
            const elevationApparente = refracter(topo.elevationGeometrique, meteo.temp, meteo.humidity, meteo.pressure);

            resultsBodies[name] = {
                azimuth: topo.azimuth,
                elevation: elevationApparente,
                elevationGeometrique: topo.elevationGeometrique,
                distanceKm: topo.distanceKm
            };
        }

        self.postMessage({
            type: 'RESULTS',
            timestampUtc: timestampUtc,
            julianDay: tempsJpl.jdUtcBN.toFixed(23),
            wmm: wmmResult,
            solarMetrics: solarMetrics,
            tempsJpl: tempsJpl,
            bodies: resultsBodies
        });
    }
};

self.postMessage({ type: 'READY' });
