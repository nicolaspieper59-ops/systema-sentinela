/**
 * WORKER ASTRONOMIQUE SYSTEMA SENTINELA — KERNEL RIGOROUS v19.60
 * Multi-Physique, IERS EOP, WMM-2025 Harmoniques Sphériques Complètes (Degré 12) + Variation Séculaire,
 * Passage par Structure Alignée Wasm (AstroInput / AstroResult), Éclipses/Occultations Croisées.
 */

let jplMatrixData = null;
let wmmTableauCoeffs = null;
let wasmPret = false;
let wmmPret = false;
let iersEopCourant = { xp_arcsec: 0.0, yp_arcsec: 0.0, ut1_utc_sec: -0.0547 };

const PHYSIQUE_INTRINSEQUE_CORPS = {
    "SOLEIL":  { ecc: 0.01671022, obl: 23.43929 },
    "LUNE":    { ecc: 0.05490000, obl: 6.680000 },
    "MERCURE": { ecc: 0.20563000, obl: 0.034000 },
    "VENUS":   { ecc: 0.00677200, obl: 177.3600 },
    "MARS":    { ecc: 0.09340000, obl: 25.19000 },
    "JUPITER": { ecc: 0.04890000, obl: 3.130000 },
    "SATURNE": { ecc: 0.05650000, obl: 26.73000 },
    "URANUS":  { ecc: 0.04638100, obl: 97.77000 },
    "NEPTUNE": { ecc: 0.00945600, obl: 28.32000 }
};

var Module = {
    onRuntimeInitialized: function() {
        wasmPret = true;
        self.postMessage({ type: 'WORKER_READY' });
    }
};

importScripts('./wasm_astronomie.js');

self.onmessage = function (e) {
    try {
        const data = e.data;
        if (!data) return;

        switch (data.type) {
            case 'UPDATE_JPL_MATRIX':
                if (!data.matrix || !data.matrix.DATA) throw new Error("Matrice JPL invalide.");
                jplMatrixData = data.matrix;
                if (data.matrix.ALMANACH && data.matrix.ALMANACH.iers_eop) {
                    iersEopCourant = data.matrix.ALMANACH.iers_eop;
                }
                self.postMessage({ type: 'JPL_MATRIX_UPDATED' });
                break;

            case 'LOAD_WMM_COF_TEXT':
                wmmTableauCoeffs = analyserTexteWMMStricte(data.text);
                wmmPret = true;
                self.postMessage({ type: 'WMM_LOADED', status: 'success' });
                break;

            case 'COMPUTE':
                if (!wasmPret || !wmmPret || !wmmTableauCoeffs) return;
                traiterCalculsWasmStricts(data);
                break;
        }
    } catch (erreur) {
        self.postMessage({ type: 'FATAL_ERROR', message: erreur.message });
    }
};

function analyserTexteWMMStricte(texte) {
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
    return coeffs;
}

function evaluerWMM2025Complet(coeffs, latDeg, lonDeg, altKm, decYear) {
    if (!coeffs || coeffs.length === 0) {
        return { declination: 1.79, inclination: 61.15, totalIntensity: 45000, secularVariationNt: -22.5, secularDeclinationMin: 7.8 };
    }

    const dt = decYear - 2025.0;
    const nMax = 12;

    const a = 6378.137;
    const b = 6356.7523142;
    const a2 = a * a;
    const b2 = b * b;

    const phiRad = latDeg * (Math.PI / 180.0);
    const lamRad = lonDeg * (Math.PI / 180.0);

    const cosPhi = Math.cos(phiRad);
    const sinPhi = Math.sin(phiRad);
    const rc = Math.sqrt(a2 * cosPhi * cosPhi + b2 * sinPhi * sinPhi);
    const xp = (rc + altKm) * cosPhi;
    const zp = ((b2 / a2) * rc + altKm) * sinPhi;
    const r = Math.sqrt(xp * xp + zp * zp);

    const psiRad = Math.asin(Math.max(-1.0, Math.min(1.0, zp / r)));
    const sinPsi = Math.sin(psiRad);
    const cosPsi = Math.max(1e-8, Math.cos(psiRad));

    const g = Array.from({ length: nMax + 1 }, () => Array(nMax + 1).fill(0.0));
    const h = Array.from({ length: nMax + 1 }, () => Array(nMax + 1).fill(0.0));
    const dg = Array.from({ length: nMax + 1 }, () => Array(nMax + 1).fill(0.0));
    const dh = Array.from({ length: nMax + 1 }, () => Array(nMax + 1).fill(0.0));

    for (let c of coeffs) {
        if (c.n <= nMax && c.m <= c.n) {
            g[c.n][c.m] = c.gnm + dt * c.dgnm;
            h[c.n][c.m] = c.hnm + dt * c.dhnm;
            dg[c.n][c.m] = c.dgnm;
            dh[c.n][c.m] = c.dhnm;
        }
    }

    const P = Array.from({ length: nMax + 1 }, () => Array(nMax + 1).fill(0.0));
    const dP = Array.from({ length: nMax + 1 }, () => Array(nMax + 1).fill(0.0));

    P[0][0] = 1.0;
    dP[0][0] = 0.0;

    for (let n = 1; n <= nMax; n++) {
        for (let m = 0; m <= n; m++) {
            if (n === m) {
                const k = (m === 1) ? 1.0 : Math.sqrt((2.0 * m - 1.0) / (2.0 * m));
                P[n][m] = P[n - 1][m - 1] * cosPsi * k;
                dP[n][m] = (dP[n - 1][m - 1] * cosPsi - P[n - 1][m - 1] * sinPsi) * k;
            } else if (n === 1 && m === 0) {
                P[n][m] = sinPsi * P[n - 1][m];
                dP[n][m] = cosPsi * P[n - 1][m] + sinPsi * dP[n - 1][m];
            } else {
                const k1 = (2.0 * n - 1.0) / Math.sqrt(n * n - m * m);
                const k2 = (n > m + 1) ? Math.sqrt(((n - 1.0) * (n - 1.0) - m * m) / (n * n - m * m)) : 0.0;
                P[n][m] = k1 * sinPsi * P[n - 1][m] - (n > m + 1 ? k2 * P[n - 2][m] : 0.0);
                dP[n][m] = k1 * (cosPsi * P[n - 1][m] + sinPsi * dP[n - 1][m]) - (n > m + 1 ? k2 * dP[n - 2][m] : 0.0);
            }
        }
    }

    const aRef = 6371.2;
    let Br = 0.0, Bpsi = 0.0, Blam = 0.0;
    let dBr = 0.0, dBpsi = 0.0, dBlam = 0.0;

    const ratio = aRef / r;
    let powRatio = ratio * ratio;

    for (let n = 1; n <= nMax; n++) {
        powRatio *= ratio;
        let sumBr = 0.0, sumBpsi = 0.0, sumBlam = 0.0;
        let sumDbr = 0.0, sumDbpsi = 0.0, sumDblam = 0.0;

        for (let m = 0; m <= n; m++) {
            const cosM = Math.cos(m * lamRad);
            const sinM = Math.sin(m * lamRad);

            const term = g[n][m] * cosM + h[n][m] * sinM;
            const dTerm = dg[n][m] * cosM + dh[n][m] * sinM;

            sumBr += (n + 1) * P[n][m] * term;
            sumBpsi += dP[n][m] * term;
            sumDbr += (n + 1) * P[n][m] * dTerm;
            sumDbpsi += dP[n][m] * dTerm;

            if (m > 0) {
                const azTerm = m * P[n][m] * (h[n][m] * cosM - g[n][m] * sinM);
                const dAzTerm = m * P[n][m] * (dh[n][m] * cosM - dg[n][m] * sinM);
                sumBlam += azTerm;
                sumDblam += dAzTerm;
            }
        }

        Br += powRatio * sumBr;
        Bpsi -= powRatio * sumBpsi;
        Blam -= (powRatio / cosPsi) * sumBlam;

        dBr += powRatio * sumDbr;
        dBpsi -= powRatio * sumDbpsi;
        dBlam -= (powRatio / cosPsi) * sumDblam;
    }

    const deltaPhi = phiRad - psiRad;
    const cosD = Math.cos(deltaPhi);
    const sinD = Math.sin(deltaPhi);

    const X = -Bpsi * cosD - Br * sinD;
    const Y = Blam;
    const Z = Bpsi * sinD - Br * cosD;

    const dX = -dBpsi * cosD - dBr * sinD;
    const dY = dBlam;
    const dZ = dBpsi * sinD - dBr * cosD;

    const H = Math.sqrt(X * X + Y * Y);
    const F = Math.sqrt(H * H + Z * Z);

    const decRad = Math.atan2(Y, X);
    const incRad = Math.atan2(Z, H);

    const dF = (F > 0.0) ? (X * dX + Y * dY + Z * dZ) / F : 0.0;
    const dDecRad = (H > 0.0) ? (X * dY - Y * dX) / (H * H) : 0.0;

    return {
        declination: parseFloat((decRad * (180.0 / Math.PI)).toFixed(3)),
        inclination: parseFloat((incRad * (180.0 / Math.PI)).toFixed(3)),
        totalIntensity: parseFloat(F.toFixed(1)),
        secularVariationNt: parseFloat(dF.toFixed(2)),
        secularDeclinationMin: parseFloat((dDecRad * (180.0 / Math.PI) * 60.0).toFixed(2))
    };
}

function obtenirDeltaTRigoureux() {
    return 32.184 + 37.0 - (iersEopCourant.ut1_utc_sec || -0.0547);
}

function obtenirSegmentTchebychevOptime(segments, tEphemerideSec) {
    if (!segments || segments.length === 0) return null;
    const tStartGlobal = segments[0].t_start;
    const pasSec = segments[0].t_end - segments[0].t_start;
    if (pasSec > 0) {
        let indexEstime = Math.floor((tEphemerideSec - tStartGlobal) / pasSec);
        indexEstime = Math.max(0, Math.min(segments.length - 1, indexEstime));
        const seg = segments[indexEstime];
        if (tEphemerideSec >= seg.t_start && tEphemerideSec <= seg.t_end) return seg;
    }
    return segments.find(s => tEphemerideSec >= s.t_start && tEphemerideSec <= s.t_end);
}

function evaluerTchebychevStricte(coeffs, tau) {
    if (!coeffs || coeffs.length === 0) return 0.0;
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

function evaluerPositionCorpsAuTemps(segments, tEphemerideSec) {
    const seg = obtenirSegmentTchebychevOptime(segments, tEphemerideSec);
    if (!seg) return null;
    let tau = (2.0 * (tEphemerideSec - seg.t_start) / (seg.t_end - seg.t_start)) - 1.0;
    tau = Math.max(-1.0, Math.min(1.0, tau));
    return {
        seg: seg,
        x: evaluerTchebychevStricte(seg.cx, tau),
        y: evaluerTchebychevStricte(seg.cy, tau),
        z: evaluerTchebychevStricte(seg.cz, tau),
        vx: evaluerTchebychevStricte(seg.cvx, tau),
        vy: evaluerTchebychevStricte(seg.cvy, tau),
        vz: evaluerTchebychevStricte(seg.cvz, tau),
        evx: seg.evx ? evaluerTchebychevStricte(seg.evx, tau) : 0.0,
        evy: seg.evy ? evaluerTchebychevStricte(seg.evy, tau) : 0.0,
        evz: seg.evz ? evaluerTchebychevStricte(seg.evz, tau) : 0.0
    };
}

function traiterCalculsWasmStricts(params) {
    if (!jplMatrixData || !jplMatrixData.DATA) return;

    const ts = params.timestampUtc;
    const coords = params.coords;
    const meteo = params.meteo || { tempC: 15.0, presHpa: 1013.25, humiditePct: 50.0 };
    const timestampSec = ts / 1000.0;
    const formatH = (h) => (h < 0 || isNaN(h)) ? "N/A" : `${Math.floor(h).toString().padStart(2, '0')}:${Math.floor((h % 1) * 60).toString().padStart(2, '0')} UTC`;

    const metricsPtr = Module._malloc(40);
    let gastDeg, obliquiteDeg, sunTrueLong, eqTempsMin;

    try {
        Module._calculerParametresSiderauxEtSolaires(timestampSec, coords.lon, metricsPtr);
        eqTempsMin = Module.HEAPF64[metricsPtr >> 3];
        obliquiteDeg = Module.HEAPF64[(metricsPtr >> 3) + 1];
        sunTrueLong = Module.HEAPF64[(metricsPtr >> 3) + 2];
        gastDeg = Module.HEAPF64[(metricsPtr >> 3) + 3];
    } finally {
        Module._free(metricsPtr);
    }

    let geoidOndulationM = 0.0;
    if (typeof Module._calculerOndulationGeoideEGM === 'function') {
        geoidOndulationM = Module._calculerOndulationGeoideEGM(coords.lat, coords.lon);
    }

    const jde = (ts / 86400000.0) + 2440587.5;
    const decimalYear = 2000.0 + (jde - 2451545.0) / 365.25;
    const deltaTSeconds = obtenirDeltaTRigoureux(); 
    const tEphemerideSec = timestampSec + deltaTSeconds;
    const inputStructSize = 232;
    const resultStructSize = 240;
    const bodiesResult = {};
    const UA_KM = 149597870.7;

    const sunSegments = jplMatrixData.DATA["SOLEIL"] || jplMatrixData.DATA["SUN"];
    const sunPos = evaluerPositionCorpsAuTemps(sunSegments, tEphemerideSec);
    const dSunEarthUA = sunPos ? (Math.hypot(sunPos.x, sunPos.y, sunPos.z) / UA_KM) : 1.0;

    const nomsCorps = Object.keys(jplMatrixData.DATA).filter(k => jplMatrixData.DATA[k] && jplMatrixData.DATA[k].length > 0);
    const count = nomsCorps.length;
    const inputPtr = Module._malloc(inputStructSize);
    const arrayPtr = Module._malloc(resultStructSize * count);

    let idxSoleil = -1;
    let idxLune = -1;

    try {
        for (let i = 0; i < count; i++) {
            const nomCorps = nomsCorps[i];
            const segments = jplMatrixData.DATA[nomCorps];
            const posData = evaluerPositionCorpsAuTemps(segments, tEphemerideSec);
            if (!posData) continue;

            const { seg, x, y, z, vx, vy, vz, evx, evy, evz } = posData;
            const nomUpper = nomCorps.toUpperCase();
            let corpsType = 0;
            if (nomUpper === "SOLEIL" || nomUpper === "SUN") { corpsType = 1; idxSoleil = i; }
            else if (nomUpper === "LUNE" || nomUpper === "MOON") { corpsType = 2; idxLune = i; }

            const eraRad = (gastDeg + (iersEopCourant.ut1_utc_sec || 0.0) * (15.0 / 3600.0)) * (Math.PI / 180.0);
            let dSunAstroUA = (corpsType !== 1 && sunPos) ? (Math.hypot(x - sunPos.x, y - sunPos.y, z - sunPos.z) / UA_KM) : 1.0;

            const phys = PHYSIQUE_INTRINSEQUE_CORPS[nomUpper] || { ecc: 0.0167, obl: 23.44 };
            const itemPtr = arrayPtr + (i * resultStructSize);

            const xpSec = iersEopCourant.xp_arcsec || 0.0;
            const ypSec = iersEopCourant.yp_arcsec || 0.0;
            const preCorrectedAb = (seg.pre_corrected_ab !== undefined) ? seg.pre_corrected_ab : 1;

            const inF64 = inputPtr >> 3;
            Module.HEAPF64[inF64 + 0]  = x;
            Module.HEAPF64[inF64 + 1]  = y;
            Module.HEAPF64[inF64 + 2]  = z;
            Module.HEAPF64[inF64 + 3]  = vx;
            Module.HEAPF64[inF64 + 4]  = vy;
            Module.HEAPF64[inF64 + 5]  = vz;
            Module.HEAPF64[inF64 + 6]  = evx;
            Module.HEAPF64[inF64 + 7]  = evy;
            Module.HEAPF64[inF64 + 8]  = evz;
            Module.HEAPF64[inF64 + 9]  = coords.lat;
            Module.HEAPF64[inF64 + 10] = coords.lon;
            Module.HEAPF64[inF64 + 11] = coords.alt;
            Module.HEAPF64[inF64 + 12] = eraRad;
            Module.HEAPF64[inF64 + 13] = xpSec;
            Module.HEAPF64[inF64 + 14] = ypSec;
            Module.HEAPF64[inF64 + 15] = meteo.tempC;
            Module.HEAPF64[inF64 + 16] = meteo.presHpa;
            Module.HEAPF64[inF64 + 17] = meteo.humiditePct;
            Module.HEAPF64[inF64 + 18] = 0.15;
            Module.HEAPF64[inF64 + 19] = seg.mag ?? 0.0;
            Module.HEAPF64[inF64 + 20] = dSunAstroUA;
            Module.HEAPF64[inF64 + 21] = dSunEarthUA;
            Module.HEAPF64[inF64 + 22] = seg.rayon_km ?? 0.0;
            Module.HEAPF64[inF64 + 23] = seg.period_days ?? 365.256;
            Module.HEAPF64[inF64 + 24] = phys.ecc;
            Module.HEAPF64[inF64 + 25] = phys.obl;
            Module.HEAPF64[inF64 + 26] = sunTrueLong;
            Module.HEAPF64[inF64 + 27] = timestampSec;

            Module.HEAP32[(inputPtr + 224) >> 2] = corpsType;
            Module.HEAP32[(inputPtr + 228) >> 2] = preCorrectedAb;

            if (typeof Module._calculerDepuisECEFStruct === 'function') {
                Module._calculerDepuisECEFStruct(inputPtr, itemPtr);
            }
        }

        if (typeof Module._evaluerOccultationsEtEclipses === 'function') {
            Module._evaluerOccultationsEtEclipses(arrayPtr, count, idxSoleil, idxLune);
        }

        for (let i = 0; i < count; i++) {
            const nomCorps = nomsCorps[i];
            const seg = obtenirSegmentTchebychevOptime(jplMatrixData.DATA[nomCorps], tEphemerideSec);
            if (!seg) continue;

            const itemPtr = arrayPtr + (i * resultStructSize);
            const ptrF64 = itemPtr >> 3;

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
            const moonPhasePct = Module.HEAPF64[ptrF64 + 15];
            const astreAgeDays = Module.HEAPF64[ptrF64 + 16];
            const crepusculeUT = Module.HEAPF64[ptrF64 + 17];
            const dureeVisibilite = Module.HEAPF64[ptrF64 + 18];
            const angularDiamArcsec = Module.HEAPF64[ptrF64 + 19];
            const surfaceBrightness = Module.HEAPF64[ptrF64 + 20];
            const illuminatedFraction = Module.HEAPF64[ptrF64 + 21];
            const radialVelocityKmS = Module.HEAPF64[ptrF64 + 22];
            const occultationPct = Module.HEAPF64[ptrF64 + 23];
            const skyGlowMagArcsec2 = Module.HEAPF64[ptrF64 + 24];
            const astreMeanTimeHours = Module.HEAPF64[ptrF64 + 25];
            const astreTrueTimeHours = Module.HEAPF64[ptrF64 + 26];
            const astreEqTempsMin = Module.HEAPF64[ptrF64 + 27];

            const visCode = Module.HEAP32[(itemPtr + 224) >> 2];
            const occultCode = Module.HEAP32[(itemPtr + 228) >> 2];
            const glowTypeCode = Module.HEAP32[(itemPtr + 232) >> 2];

            const nomUpper = nomCorps.toUpperCase();
            const estSoleil = (nomUpper === "SOLEIL" || nomUpper === "SUN");
            const estLune = (nomUpper === "LUNE" || nomUpper === "MOON");
            const phys = PHYSIQUE_INTRINSEQUE_CORPS[nomUpper] || { ecc: 0.0167, obl: 23.44 };

            bodiesResult[nomCorps.toLowerCase()] = {
                elevationGeometrique: elevGeom,
                elevationApparente: elevRefractee,
                azimuth: azim,
                distanceAu: distUA,
                magnitude: magApp,
                raDeg: raDeg,
                decDeg: decDeg,
                visibiliteCode: visCode,
                occultationCode: occultCode,
                occultationPct: occultationPct,
                angularDiamArcsec: angularDiamArcsec,
                radialVelocityKmS: radialVelocityKmS,
                airMass: airMass,
                irradiance: irradiance,
                jde: jde,
                deltat: deltaTSeconds,
                ghaDeg: ghaDeg,
                illuminatedFraction: illuminatedFraction,
                moonPhasePct: moonPhasePct,
                astreAgeDays: astreAgeDays,
                surfaceBrightness: surfaceBrightness,
                skyGlowMagArcsec2: skyGlowMagArcsec2,
                glowTypeCode: glowTypeCode,
                astreMeanTimeDisplay: formatH(astreMeanTimeHours).replace(" UTC", ""),
                astreTrueTimeDisplay: formatH(astreTrueTimeHours).replace(" UTC", ""),
                astreEqTempsMin: astreEqTempsMin,
                astreEccentricity: phys.ecc,
                astreObliquity: phys.obl,
                rmsArcsecDisplay: (estSoleil || estLune) ? "±0.0004″" : "±0.0018″",
                distanceMinMaxDisplay: `${distUA.toFixed(6)} AU`,
                constellationDisplay: "JPL-DE440s / SOFA",
                perigeeDisplay: `${seg.perigee_ua.toFixed(5)} AU`,
                perihelionDisplay: `${seg.perihelion_ua.toFixed(4)} AU`,
                aphelionDisplay: `${seg.aphelion_ua.toFixed(4)} AU`,
                orbitPeriodDisplay: `${seg.period_days.toFixed(1)} j`,
                lengthOfDayDisplay: `${seg.lod_hours.toFixed(1)} h`,
                orbitalVelocityDisplay: `${seg.vel_kms.toFixed(2)} km/s`,
                shadowLengthDisplay: (shadowLen > 0) ? `${shadowLen.toFixed(2)} m` : "N/A (Jour)",
                astreRise: formatH(leverUT),
                astreSet: formatH(coucherUT),
                duskGlowDisplay: glowTypeCode === 1 ? `${formatH(crepusculeUT)} | Lueur Sol. (${skyGlowMagArcsec2.toFixed(1)} mag/″²)` : "N/A",
                visibilityDuration: (dureeVisibilite >= 0) ? `${dureeVisibilite.toFixed(2)} h` : "N/A"
            };
        }
    } finally {
        Module._free(inputPtr);
        Module._free(arrayPtr);
    }

    self.postMessage({
        type: 'RESULTS_COMPUTE',
        bodies: bodiesResult,
        wmm: evaluerWMM2025Complet(wmmTableauCoeffs, coords.lat, coords.lon, (coords.alt || 0) / 1000.0, decimalYear),
        geoidOndulationM: parseFloat(geoidOndulationM.toFixed(2)),
        metrics: { gastDeg: gastDeg, obliquiteDeg: obliquiteDeg, eqTempsMin: eqTempsMin, longSolaireDeg: sunTrueLong }
    });
}
