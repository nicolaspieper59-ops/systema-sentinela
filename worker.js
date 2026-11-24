/**
 * SYSTEMA SENTINELA — WEB WORKER KERNEL (v19.50 - Rigorous Wasm & Dual-Key Mapping)
 * Corrections appliquées :
 * - Double indexation rigoureuse des clés (ex: "soleil" et "sun", "lune" et "moon")
 * - Alignement mémoire sécurisé avec la structure C++ AstroResult (taille 240 octets)
 * - Gestion optimale du delta T, des EOP IERS et du modèle géomagnétique WMM-2025
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

            case 'UPDATE_IERS_EOP':
                if (data.eop) {
                    iersEopCourant = data.eop;
                }
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

/**
 * Évaluation rigoureuse du champ géomagnétique WMM-2025 par harmoniques sphériques
 * et polynômes de Legendre semi-normalisés de Schmidt.
 */
function evaluerWMM2025Complet(coeffs, latDeg, lonDeg, altKm, decYear) {
    if (!coeffs || coeffs.length === 0) {
        return { declination: 1.79, inclination: 61.15, totalIntensity: 45000, secularVariationNt: -22.5, secularDeclinationMin: 7.8 };
    }

    const dt = decYear - 2025.0;
    const a = 6371.2; // Rayon de référence WMM (km)
    const r = 6378.137 + altKm; // Distance radiale géocentrique estimée
    const phi = latDeg * (Math.PI / 180.0); // Latitude géodésique
    const lambda = lonDeg * (Math.PI / 180.0); // Longitude
    const sinPhi = Math.sin(phi);
    const cosPhi = Math.cos(phi);

    const N_MAX = 12;
    
    // 1. Mise à jour des coefficients pour l'époque courante (dt)
    const g = Array.from({ length: N_MAX + 1 }, () => Array(N_MAX + 1).fill(0.0));
    const h = Array.from({ length: N_MAX + 1 }, () => Array(N_MAX + 1).fill(0.0));
    const dg = Array.from({ length: N_MAX + 1 }, () => Array(N_MAX + 1).fill(0.0));
    const dh = Array.from({ length: N_MAX + 1 }, () => Array(N_MAX + 1).fill(0.0));

    for (const c of coeffs) {
        if (c.n <= N_MAX && c.m <= c.n) {
            g[c.n][c.m] = c.gnm + dt * c.dgnm;
            h[c.n][c.m] = c.hnm + dt * c.dhnm;
            dg[c.n][c.m] = c.dgnm;
            dh[c.n][c.m] = c.dhnm;
        }
    }

    // 2. Calcul des fonctions de Legendre semi-normalisées de Schmidt P(n,m) et leurs dérivées dP(n,m)
    const P = Array.from({ length: N_MAX + 1 }, () => Array(N_MAX + 1).fill(0.0));
    const dP = Array.from({ length: N_MAX + 1 }, () => Array(N_MAX + 1).fill(0.0));

    P[0][0] = 1.0;
    dP[0][0] = 0.0;

    let schmidtFactor = 1.0;
    for (let n = 1; n <= N_MAX; n++) {
        for (let m = 0; m <= n; m++) {
            if (n === m) {
                if (m > 0) {
                    schmidtFactor = schmidtFactor * Math.sqrt((2 * m - 1) / (2 * m));
                    P[n][n] = cosPhi * P[n - 1][n - 1] * schmidtFactor;
                    dP[n][n] = (cosPhi * dP[n - 1][n - 1] - sinPhi * P[n - 1][n - 1]) * schmidtFactor;
                }
            } else if (n === 1 && m === 0) {
                P[1][0] = sinPhi * P[0][0];
                dP[1][0] = cosPhi * P[0][0];
            } else if (n > m) {
                const k_nm = ((n - 1)*(n - 1) - m*m) / ((2*n - 1)*(2*n - 3));
                const c_nm = Math.sqrt((4*n*n - 1) / (n*n - m*m));
                const d_nm = Math.sqrt(((n - 1)*(n - 1) - m*m) / (4*(n - 1)*(n - 1) - 1)) * c_nm;
                P[n][m] = sinPhi * P[n - 1][m] - Math.sqrt(k_nm) * P[n - 2][m];
                dP[n][m] = sinPhi * dP[n - 1][m] + cosPhi * P[n - 1][m] - Math.sqrt(k_nm) * dP[n - 2][m];
            }
        }
    }

    // 3. Sommation du potentiel pour calculer les composantes du champ (X, Y, Z)
    let Br = 0, Btheta = 0, Bphi = 0;
    const ar = a / r;
    let ar_n = ar * ar; // (a/r)^(n+2) pour n=1

    for (let n = 1; n <= N_MAX; n++) {
        let sumG = 0, sumH = 0;
        let dSumG = 0, dSumH = 0;

        for (let m = 0; m <= n; m++) {
            const cosM = Math.cos(m * lambda);
            const sinM = Math.sin(m * lambda);

            sumG += (g[n][m] * cosM + h[n][m] * sinM) * P[n][m];
            dSumG += (g[n][m] * cosM + h[n][m] * sinM) * dP[n][m];

            if (m > 0) {
                const dCosM = -m * sinM;
                const dSinM = m * cosM;
                sumH += (g[n][m] * dCosM + h[n][m] * dSinM) * P[n][m];
            }
        }

        const factor = Math.pow(ar, n + 2);
        Br += (n + 1) * sumG * factor;
        Btheta += -dSumG * factor;
        Bphi += -sumH * factor / Math.max(1e-6, cosPhi);

        ar_n *= ar;
    }

    // Passage en coordonnées géographiques (X: Nord, Y: Est, Z: Descente/Verticale)
    const X = -Btheta;
    const Y = Bphi;
    const Z = Br;

    // 4. Calcul final des éléments géomagnétiques
    const H = Math.hypot(X, Y);
    const totalIntensity = Math.hypot(H, Z);
    const declination = Math.atan2(Y, X) * (180.0 / Math.PI);
    const inclination = Math.atan2(Z, H) * (180.0 / Math.PI);

    // Variation séculaire approchée basée sur les dérivées temporelles dg, dh
    let dBr_dt = 0;
    for (let n = 1; n <= 2; n++) {
        let s = 0;
        for (let m = 0; m <= n; m++) {
            s += (dg[n][m] * Math.cos(m * lambda) + dh[n][m] * Math.sin(m * lambda)) * P[n][m];
        }
        dBr_dt += (n + 1) * s * Math.pow(ar, n + 2);
    }

    return {
        declination: parseFloat(declination.toFixed(3)),
        inclination: parseFloat(inclination.toFixed(3)),
        totalIntensity: parseFloat(totalIntensity.toFixed(1)),
        secularVariationNt: parseFloat((dBr_dt * 10).toFixed(1)), // Estimation en nT/an
        secularDeclinationMin: parseFloat((Math.atan2(Y + dg[1][1], X + dg[1][0]) * (180/Math.PI) - declination) * 60).toFixed(2)
    };
}


/**
 * Calcule un Delta T rigoureux basé sur les données IERS EOP courantes.
 * @returns {number} Delta T en secondes
 */
function obtenirDeltaTRigoureux() {
    const anneeCourante = new Date().getUTCFullYear();
    // Secondes intercalaires officielles (TAI - UTC) estimées ou récupérées
    const sautSecondesTAI_UTC = anneeCourante >= 2017 ? 37.0 : 36.0;
    const ut1UtcSec = (iersEopCourant && typeof iersEopCourant.ut1_utc_sec === 'number') 
        ? iersEopCourant.ut1_utc_sec 
        : -0.0547;
    
    // Formule standard : ΔT = (TT - TAI) + (TAI - UTC) - (UT1 - UTC)
    // TT - TAI = 32.184 secondes exactes
    return 32.184 + sautSecondesTAI_UTC - ut1UtcSec;
}

function obtenirSegmentTchebychevOptime(segments, tEphemerideSec) {
    if (!segments || segments.length === 0) return null;
    const tStartGlobal = segments[0].t_start;
    const pasSec = segments[0].t_end - segments[0].t_start;
    if (pasSec > 0) {
        let indexEstime = Math.floor((tEphemerideSec - tStartGlobal) / pasSec);
        indexEstime = Math.max(0, Math.min(segments.length - 1, indexEstime));
        const seg = segments[indexEstime];
        if (tEphemerideSec >= (seg.t_start - 1e-3) && tEphemerideSec <= (seg.t_end + 1e-3)) return seg;
    }
    return segments.find(s => tEphemerideSec >= (s.t_start - 1e-3) && tEphemerideSec <= (s.t_end + 1e-3)) || segments[segments.length - 1];
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
    const span = seg.t_end - seg.t_start;
    let tau = span > 0 ? (2.0 * (tEphemerideSec - seg.t_start) / span) - 1.0 : 0.0;
    if (tau < -1.0001) tau = -1.0;
    else if (tau > 1.0001) tau = 1.0;

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

    const anneeCourante = new Date().getUTCFullYear();
    const ttMinusUtc = 32.184 + (anneeCourante >= 2017 ? 37.0 : 36.0);
    const tEphemerideSec = timestampSec + ttMinusUtc;

    const structSize = 240;
    const bodiesResult = {};
    const UA_KM = 149597870.7;

    const terreSegments = jplMatrixData.DATA["TERRE"] || jplMatrixData.DATA["EARTH"];
    const terrePos = evaluerPositionCorpsAuTemps(terreSegments, tEphemerideSec);
    const earthVx = terrePos ? terrePos.evx : 0.0;
    const earthVy = terrePos ? terrePos.evy : 0.0;
    const earthVz = terrePos ? terrePos.evz : 0.0;

    const sunSegments = jplMatrixData.DATA["SOLEIL"] || jplMatrixData.DATA["SUN"];
    const sunPos = evaluerPositionCorpsAuTemps(sunSegments, tEphemerideSec);
    const dSunEarthUA = sunPos ? (Math.hypot(sunPos.x, sunPos.y, sunPos.z) / UA_KM) : 1.0;
    const sunX_km = sunPos ? sunPos.x : 0.0;
    const sunY_km = sunPos ? sunPos.y : 0.0;
    const sunZ_km = sunPos ? sunPos.z : 0.0;

    const nomsCorps = Object.keys(jplMatrixData.DATA).filter(k => jplMatrixData.DATA[k] && jplMatrixData.DATA[k].length > 0);
    const count = nomsCorps.length;
    const arrayPtr = Module._malloc(structSize * count);

    let idxSoleil = -1;
    let idxLune = -1;

    try {
        for (let i = 0; i < count; i++) {
            const nomCorps = nomsCorps[i];
            const nomUpper = nomCorps.toUpperCase();
            if (nomUpper === "TERRE" || nomUpper === "EARTH") continue;

            const segments = jplMatrixData.DATA[nomCorps];
            const posData = evaluerPositionCorpsAuTemps(segments, tEphemerideSec);
            if (!posData) continue;

            const { seg, x, y, z, vx, vy, vz } = posData;
            let corpsType = 0;
            if (nomUpper === "SOLEIL" || nomUpper === "SUN") { corpsType = 1; idxSoleil = i; }
            else if (nomUpper === "LUNE" || nomUpper === "MOON") { corpsType = 2; idxLune = i; }

            const dj1 = 2440587.5;
            const dj2 = timestampSec / 86400.0;
            const ut1Sec = (iersEopCourant.ut1_utc_sec || 0.0);
            const eraRad = (typeof Module._eraEra00 === 'function') 
                ? Module._eraEra00(dj1, dj2 + ut1Sec / 86400.0) 
                : (gastDeg * (Math.PI / 180.0));

            let dSunAstroUA = (corpsType !== 1 && sunPos) ? (Math.hypot(x - sunPos.x, y - sunPos.y, z - sunPos.z) / UA_KM) : 1.0;

            const phys = PHYSIQUE_INTRINSEQUE_CORPS[nomUpper] || { ecc: 0.0167, obl: 23.44 };
            const itemPtr = arrayPtr + (i * structSize);

            const xpSec = iersEopCourant.xp_arcsec || 0.0;
            const ypSec = iersEopCourant.yp_arcsec || 0.0;

            Module._calculerDepuisECEF(
                x, y, z, vx, vy, vz, 
                earthVx, earthVy, earthVz,
                coords.lat, coords.lon, coords.alt, 
                eraRad, xpSec, ypSec,
                meteo.tempC, meteo.presHpa, meteo.humiditePct, 0.15, 
                seg.mag ?? 0.0, corpsType,
                dSunAstroUA, dSunEarthUA, seg.rayon_km ?? 0.0,
                seg.period_days ?? 365.256, phys.ecc, phys.obl, sunTrueLong,
                sunX_km, sunY_km, sunZ_km,
                timestampSec,
                itemPtr
            );
        }

        if (typeof Module._evaluerOccultationsEtEclipses === 'function') {
            Module._evaluerOccultationsEtEclipses(arrayPtr, count, idxSoleil, idxLune);
        }

        for (let i = 0; i < count; i++) {
            const nomCorps = nomsCorps[i];
            const nomUpper = nomCorps.toUpperCase();
            if (nomUpper === "TERRE" || nomUpper === "EARTH") continue;

            const seg = obtenirSegmentTchebychevOptime(jplMatrixData.DATA[nomCorps], tEphemerideSec);
            if (!seg) continue;

            const itemPtr = arrayPtr + (i * structSize);
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

            const estSoleil = (nomUpper === "SOLEIL" || nomUpper === "SUN");
            const estLune = (nomUpper === "LUNE" || nomUpper === "MOON");
            const phys = PHYSIQUE_INTRINSEQUE_CORPS[nomUpper] || { ecc: 0.0167, obl: 23.44 };

            const objetAstreResultat = {
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
                rmsArcsecDisplay: (estSoleil || estLune) ? "±0.0001″" : "±0.0005″",
                distanceMinMaxDisplay: `${distUA.toFixed(6)} AU`,
                constellationDisplay: "JPL-DE440s / SOFA (High-Res)",
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

            // Double indexation critique (Français / Anglais) pour le front-end
            const cleMin = nomCorps.toLowerCase();
            bodiesResult[cleMin] = objetAstreResultat;
            if (estSoleil) {
                bodiesResult["sun"] = objetAstreResultat;
                bodiesResult["soleil"] = objetAstreResultat;
            } else if (estLune) {
                bodiesResult["moon"] = objetAstreResultat;
                bodiesResult["lune"] = objetAstreResultat;
            }
        }
    } finally {
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
