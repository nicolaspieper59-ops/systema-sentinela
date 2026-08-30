/**
 * SYSTEMA SENTINELA - Worker Astronomique, Géomagnétique & WebAssembly (C++)
 * Version Finale Optimisée avec Cache, Événements TSM et Flux Live
 */

importScripts('https://cdnjs.cloudflare.com/ajax/libs/bignumber.js/9.1.2/bignumber.min.js');

try {
    importScripts('vsop2013.js', 'ElpMpp02LLR_min.js');
} catch (e) {
    console.error("Erreur critique lors du chargement des moteurs VSOP/ELP :", e);
}

BigNumber.config({ DECIMAL_PLACES: 30, ROUNDING_MODE: BigNumber.ROUND_HALF_UP });

let wmmCoeffs = [];
let isWmmLoaded = false;
let jplMatrixData = null;
let fluxLiveData = null;
let isWasmReady = false;

let cacheDernierCalcul = {
    timestampSec: null,
    stationKey: null,
    donnees: null
};

self.Module = {
    onRuntimeInitialized: function() {
        isWasmReady = true;
        self.postMessage({ type: 'WASM_READY', status: 'WASM_READY' });
        self.postMessage({ type: 'READY' });
    }
};

function obtenirFacteurSchmidt(n, m) {
    if (m === 0) return 1.0;
    let num = 1.0, den = 1.0;
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
    try {
        const dt = decimalYear - 2025.0;
        const rad = Math.PI / 180.0;
        const latRad = latDeg * rad;
        const lonRad = lonDeg * rad;
        const a = 6378.137, b = 6356.7523142, re = 6371.2;
        const sinLat = Math.sin(latRad), cosLat = Math.cos(latRad);
        const rho = Math.sqrt(a * a * cosLat * cosLat + b * b * sinLat * sinLat);
        const r = Math.sqrt(altKm * altKm + 2 * altKm * rho + (Math.pow(a, 4) * cosLat * cosLat + Math.pow(b, 4) * sinLat * sinLat) / (rho * rho));
        const cd = (altKm + rho) / r;
        const sd = (a * a - b * b) / (r * rho) * sinLat * cosLat;
        const theta = Math.acos(cosLat * cd - sinLat * sd);
        const phi = lonRad;

        let Br = 0, Btheta = 0, Bphi = 0;
        let P = Array.from({ length: 13 }, () => new Array(13).fill(0));
        let dP = Array.from({ length: 13 }, () => new Array(13).fill(0));
        P[0][0] = 1; dP[0][0] = 0;
        const cosT = Math.cos(theta), sinT = Math.sin(theta);

        for (let n = 1; n <= 12; n++) {
            for (let m = 0; m <= n; m++) {
                if (n === m) {
                    P[n][n] = sinT * P[n - 1][n - 1];
                    dP[n][n] = sinT * dP[n - 1][n - 1] + cosT * P[n - 1][n - 1];
                } else if (n === 1 && m === 0) {
                    P[1][0] = cosT; dP[1][0] = -sinT;
                } else {
                    const p1 = P[n - 1][m], p2 = (n - 2 >= m) ? P[n - 2][m] : 0;
                    const dp1 = dP[n - 1][m], dp2 = (n - 2 >= m) ? dP[n - 2][m] : 0;
                    P[n][m] = ((2 * n - 1) * cosT * p1 - (n - 1 + m) * p2) / (n - m);
                    dP[n][m] = ((2 * n - 1) * (-sinT * p1 + cosT * dp1) - (n - 1 + m) * dp2) / (n - m);
                }
            }
        }

        for (let coeff of wmmCoeffs) {
            const { n, m, g, h, dg, dh } = coeff;
            const gt = g + dg * dt, ht = h + dh * dt;
            const ratio = Math.pow(re / r, n + 2);
            const cosM = Math.cos(m * phi), sinM = Math.sin(m * phi);
            Br -= (n + 1) * ratio * (gt * cosM + ht * sinM) * P[n][m];
            Btheta -= ratio * (gt * cosM + ht * sinM) * dP[n][m];
            Bphi -= ratio * (m / (sinT || 1e-6)) * (-gt * sinM + ht * cosM) * P[n][m];
        }

        const Bx = -Btheta * cd - Br * sd;
        const By = Bphi;
        const Bz = Btheta * sd - Br * cd;
        const H = Math.sqrt(Bx * Bx + By * By);
        const D = Math.atan2(By, Bx) * (180.0 / Math.PI);
        const I = Math.atan2(Bz, H) * (180.0 / Math.PI);
        const F = Math.sqrt(H * H + Bz * Bz);

        return { declination: D, inclination: I, horizontal: H, total: F };
    } catch (err) {
        return { declination: 0, inclination: 0, horizontal: 0, total: 0 };
    }
}

function evaluerVSOP2013(corpsNom, T_TT, gastDeg) {
    if (fluxLiveData && fluxLiveData.bodies && fluxLiveData.bodies[corpsNom]) {
        return fluxLiveData.bodies[corpsNom];
    }
    if (typeof vsop2013 === 'undefined') return null;
    try {
        const mapCorps = {
            'mercure': vsop2013.mer,
            'venus': vsop2013.ven,
            'mars': vsop2013.mar,
            'jupiter': vsop2013.jup,
            'soleil': vsop2013.earth 
        };
        const corpsObj = mapCorps[corpsNom];
        if (!corpsObj || typeof corpsObj.position !== 'function') return null;

        const posEc = corpsObj.position(T_TT);
        if (!posEc) return null;

        const epsRad = 23.43929111 * (Math.PI / 180.0);
        const xEc = posEc.x, yEc = posEc.y * Math.cos(epsRad) - posEc.z * Math.sin(epsRad);
        const zEc = posEc.y * Math.sin(epsRad) + posEc.z * Math.cos(epsRad);

        const gastRad = gastDeg * (Math.PI / 180.0);
        const xEcef = xEc * Math.cos(gastRad) + yEc * Math.sin(gastRad);
        const yEcef = -xEc * Math.sin(gastRad) + yEc * Math.cos(gastRad);
        const zEcef = zEc;

        const UA_EN_KM = 149597870.7;
        return { x: xEcef * UA_EN_KM, y: yEcef * UA_EN_KM, z: zEcef * UA_EN_KM };
    } catch (e) {
        return null;
    }
}

function evaluerELP2000(T_TT, gastDeg) {
    if (fluxLiveData && fluxLiveData.bodies && fluxLiveData.bodies.lune) {
        return fluxLiveData.bodies.lune;
    }
    if (typeof ELP2000 === 'undefined' && typeof elp === 'undefined') return null;
    try {
        const moteurLune = typeof ELP2000 !== 'undefined' ? ELP2000 : elp;
        if (typeof moteurLune.position !== 'function') return null;

        const posLune = moteurLune.position(T_TT);
        if (!posLune) return null;

        const gastRad = gastDeg * (Math.PI / 180.0);
        const xGeo = posLune.x, yGeo = posLune.y, zGeo = posLune.z;

        const xEcef = xGeo * Math.cos(gastRad) + yGeo * Math.sin(gastRad);
        const yEcef = -xGeo * Math.sin(gastRad) + yGeo * Math.cos(gastRad);
        const zEcef = zGeo;

        return { x: xEcef, y: yEcef, z: zEcef };
    } catch (e) {
        return null;
    }
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
    const T = (jdTT - 2451545.0) / 36525.0;

    const du = jdUtc - 2451545.0;
    let eraDeg = (360.0 * (0.7790572732640 + 1.0027378119113544 * du)) % 360.0;
    if (eraDeg < 0) eraDeg += 360.0;

    const omega = (125.04452 - 1934.136261 * T) * Math.PI / 180.0;
    const L_sol = (280.4665 + 36000.7698 * T) * Math.PI / 180.0;
    const L_lune = (218.3165 + 481267.8813 * T) * Math.PI / 180.0;

    const deltaPsi = -17.20 * Math.sin(omega) - 1.32 * Math.sin(2 * L_sol) - 0.23 * Math.sin(2 * L_lune);
    const eps0 = 23.43929111 - (46.8150 / 3600.0) * T;
    const deltaEps = 9.20 * Math.cos(omega) + 0.57 * Math.cos(2 * L_sol) + 0.10 * Math.cos(2 * L_lune);
    const epsVraie = eps0 + (deltaEps / 3600.0);

    const eqEqDeg = (deltaPsi * Math.cos(epsVraie * Math.PI / 180.0)) / 3600.0;
    let gastDeg = (eraDeg + eqEqDeg) % 360.0;
    if (gastDeg < 0) gastDeg += 360.0;

    if (jplMatrixData && jplMatrixData.gast_deg !== undefined) {
        gastDeg = jplMatrixData.gast_deg;
    }

    let lstDeg = (gastDeg + stationLon) % 360.0;
    if (lstDeg < 0) lstDeg += 360.0;

    return { jdUtcBN, jdUtc, jdTT, gastDeg, lstDeg, epsVraie };
}

function topocentrique(latDeg, lonDeg, altKm, posCorpsECEF) {
    const phi = latDeg * Math.PI / 180.0;
    const lambda = lonDeg * Math.PI / 180.0;
    const a = 6378.137, e2 = 0.00669437999014;
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
    const h = Math.max(altDeg, -0.9);
    const refStdArcMin = 1.02 / Math.tan((h + 10.3 / (h + 5.11)) * (Math.PI / 180.0));
    const e_sat = 6.1121 * Math.exp((17.502 * tempC) / (240.97 + tempC));
    const e_vapeur = (humidityPct / 100.0) * e_sat;
    const P_effective = pressureHpa - 0.1507 * e_vapeur;
    const factor = (P_effective / 1013.25) * (288.15 / (273.15 + tempC));
    return altDeg + ((refStdArcMin * factor) / 60.0);
}

function calculerEvenementsJournee(corpsNom, timestampUtc, station) {
    const dateBase = new Date(timestampUtc);
    dateBase.setUTCHours(0, 0, 0, 0);
    const debutJourMs = dateBase.getTime();
    let transitUtcMs = null, riseUtcMs = null, setUtcMs = null;
    let maxElJour = -999, precedentEl = null, precedentTime = null;
    const pasMs = 10 * 60 * 1000;

    for (let t = debutJourMs; t <= debutJourMs + 86400000; t += pasMs) {
        const tempsJpl = calculerTempsJPL(t, station.lon);
        const T_TT = (tempsJpl.jdTT - 2451545.0) / 36525.0;
        const posEcef = (corpsNom === 'lune') ? evaluerELP2000(T_TT, tempsJpl.gastDeg) : evaluerVSOP2013(corpsNom, T_TT, tempsJpl.gastDeg);
        if (!posEcef) continue;
        const topo = topocentrique(station.lat, station.lon, station.alt, posEcef);
        const el = topo.elevationGeometrique;

        if (el > maxElJour) { maxElJour = el; transitUtcMs = t; }
        if (precedentEl !== null) {
            if (precedentEl < 0 && el >= 0 && !riseUtcMs) riseUtcMs = precedentTime + (0 - precedentEl) / (el - precedentEl) * pasMs;
            if (precedentEl >= 0 && el < 0 && !setUtcMs) setUtcMs = precedentTime + (precedentEl - 0) / (precedentEl - el) * pasMs;
        }
        precedentEl = el; precedentTime = t;
    }
    return { riseUtcMs, transitUtcMs, setUtcMs };
}

function calculerMetricsSolaires(dateUtc, stationLon, epsVraie) {
    if (fluxLiveData && fluxLiveData.solarMetrics) {
        return fluxLiveData.solarMetrics;
    }
    const d = (dateUtc.getTime() / 86400000.0) - 10957.5;
    const g = 357.529 + 0.98560028 * d;
    const gRad = g * Math.PI / 180.0;
    const q = (280.459 + 0.98564736 * d) % 360.0;
    const L = q + 1.915 * Math.sin(gRad) + 0.020 * Math.sin(2 * gRad);
    const LRad = L * Math.PI / 180.0;

    const e = 0.016709 - 0.00000000115 * d;
    const eps = epsVraie !== undefined ? epsVraie : 23.439;
    const epsRad = eps * Math.PI / 180.0;
    const ra = Math.atan2(Math.cos(epsRad) * Math.sin(LRad), Math.cos(LRad)) * 180.0 / Math.PI;

    let deltaDeg = (q - ra) % 360.0;
    if (deltaDeg > 180.0) deltaDeg -= 180.0;
    if (deltaDeg < -180.0) deltaDeg += 180.0;
    const eqTempsMin = deltaDeg / 15.0 * 60.0;

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
        eqTempsMin, excentricite: e, obliquite: eps,
        longitudeSolaire: (L % 360 + 360) % 360,
        tsm: fmtHHMMSS(tsmH), tsv: fmtHHMMSS(tsvH)
    };
}

function auditerPrecisionJpl(corpsNom, positionCalculee) {
    if (!jplMatrixData || !jplMatrixData.bodies || !jplMatrixData.bodies[corpsNom]) {
        return { deltaKm: null, statut: "PAS DE REFERENCE JPL" };
    }
    const refJpl = jplMatrixData.bodies[corpsNom];
    const dx = positionCalculee.x - refJpl.x;
    const dy = positionCalculee.y - refJpl.y;
    const dz = positionCalculee.z - refJpl.z;
    const deltaKm = Math.sqrt(dx * dx + dy * dy + dz * dz);
    const seuilAlerte = (corpsNom === 'lune') ? 50.0 : 5000.0;
    return { deltaKm: Math.round(deltaKm), statut: deltaKm <= seuilAlerte ? "CONFORME" : "DERIVE DETECTEE" };
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

    if (data.type === 'UPDATE_FLUX_LIVE') {
        fluxLiveData = data.flux;
        return;
    }

    if (data.type === 'COMPUTE' || data.type === 'CALCULATE') {
        const timestampUtc = data.timestampUtc || Date.now();
        const timestampSec = Math.floor(timestampUtc / 1000);
        const station = data.station || { lat: 43.2843, lon: 5.3585, alt: 0.010 };
        const stationKey = `${station.lat.toFixed(4)}_${station.lon.toFixed(4)}_${station.alt.toFixed(2)}`;

        if (cacheDernierCalcul.timestampSec === timestampSec && cacheDernierCalcul.stationKey === stationKey) {
            self.postMessage({
                type: 'RESULTS',
                ...cacheDernierCalcul.donnees,
                fromCache: true
            });
            return;
        }

        const meteo = data.meteo || { temp: 15.0, humidity: 50.0, pressure: 1013.25 };
        const dateUtc = new Date(timestampUtc);

        const tempsJpl = calculerTempsJPL(timestampUtc, station.lon);
        const T_TT = (tempsJpl.jdTT - 2451545.0) / 36525.0;

        const startOfYear = Date.UTC(dateUtc.getUTCFullYear(), 0, 1);
        const endOfYear = Date.UTC(dateUtc.getUTCFullYear() + 1, 0, 1);
        const decimalYear = dateUtc.getUTCFullYear() + (timestampUtc - startOfYear) / (endOfYear - startOfYear);
        
        const wmmResult = computeWMM2025(station.lat, station.lon, station.alt, decimalYear);
        const solarMetrics = calculerMetricsSolaires(dateUtc, station.lon, tempsJpl.epsVraie);

        const resultsBodies = {};
        const auditRapports = {};

        const corpsPlanetes = ['soleil', 'mercure', 'venus', 'mars', 'jupiter'];
        for (let corps of corpsPlanetes) {
            const posEcef = evaluerVSOP2013(corps, T_TT, tempsJpl.gastDeg);
            if (posEcef) {
                const topo = topocentrique(station.lat, station.lon, station.alt, posEcef);
                const elevationApparente = refracter(topo.elevationGeometrique, meteo.temp, meteo.humidity, meteo.pressure);
                const evenements = calculerEvenementsJournee(corps, timestampUtc, station);

                resultsBodies[corps] = {
                    azimuth: topo.azimuth,
                    elevation: elevationApparente,
                    elevationGeometrique: topo.elevationGeometrique,
                    distanceKm: topo.distanceKm,
                    ...evenements
                };
                auditRapports[corps] = auditerPrecisionJpl(corps, posEcef);
            }
        }

        const posEcefLune = evaluerELP2000(T_TT, tempsJpl.gastDeg);
        if (posEcefLune) {
            const topoLune = topocentrique(station.lat, station.lon, station.alt, posEcefLune);
            const elAppLune = refracter(topoLune.elevationGeometrique, meteo.temp, meteo.humidity, meteo.pressure);
            const evenementsLune = calculerEvenementsJournee('lune', timestampUtc, station);

            resultsBodies.lune = {
                azimuth: topoLune.azimuth,
                elevation: elAppLune,
                elevationGeometrique: topoLune.elevationGeometrique,
                distanceKm: topoLune.distanceKm,
                ...evenementsLune
            };
            auditRapports.lune = auditerPrecisionJpl('lune', posEcefLune);
        }

        const resultatFinal = {
            timestampUtc: timestampUtc,
            julianDay: tempsJpl.jdUtcBN.toFixed(23),
            wmm: wmmResult,
            solarMetrics: solarMetrics,
            tempsJpl: tempsJpl,
            bodies: resultsBodies,
            auditJpl: auditRapports
        };

        cacheDernierCalcul = {
            timestampSec: timestampSec,
            stationKey: stationKey,
            donnees: resultatFinal
        };

        self.postMessage({
            type: 'RESULTS',
            ...resultatFinal,
            fromCache: false
        });
    }
};

if (!isWasmReady) {
    self.postMessage({ type: 'READY' });
            }
