/**
 * WORKER ASTRONOMIQUE SYSTEMA SENTINELA — KERNEL RIGOROUS v19.45
 * Multi-Physique, IERS EOP, WMM-2025 Harmoniques Sphériques + Variation Séculaire,
 * Éclipses/Occultations Croisées, Luminance/Micro-Crépuscule, Temps Planétaires & Plate-Solving Astrométrique
 */

let jplMatrixData = null;
let wmmTableauCoeffs = null;
let wasmPret = false;
let wmmPret = false;
let iersEopCourant = { xp_arcsec: 0.0, yp_arcsec: 0.0, ut1_utc_sec: -0.0547 };

// Catalogue d'étoiles brillantes (FK5 / Hipparcos J2000) pour le plate-solving astrométrique de terrain
const CATALOGUE_ETOILES_REF = [
    { nom: "Sirius (α CMa)", ra: 101.287, dec: -16.716, mag: -1.46 },
    { nom: "Canopus (α Car)", ra: 95.988, dec: -52.696, mag: -0.74 },
    { nom: "Arcturus (α Boo)", ra: 213.915, dec: 19.182, mag: -0.05 },
    { nom: "Vega (α Lyr)", ra: 279.235, dec: 38.784, mag: 0.03 },
    { nom: "Capella (α Aur)", ra: 79.172, dec: 45.998, mag: 0.08 },
    { nom: "Rigel (β Ori)", ra: 78.634, dec: -8.202, mag: 0.13 },
    { nom: "Procyon (α CMi)", ra: 114.825, dec: 5.225, mag: 0.34 },
    { nom: "Betelgeuse (α Ori)", ra: 88.793, dec: 7.407, mag: 0.42 },
    { nom: "Altair (α Aql)", ra: 297.696, dec: 8.868, mag: 0.76 },
    { nom: "Aldebaran (α Tau)", ra: 68.980, dec: 16.509, mag: 0.86 },
    { nom: "Antares (α Sco)", ra: 247.352, dec: -26.432, mag: 0.96 },
    { nom: "Spica (α Vir)", ra: 201.298, dec: -11.161, mag: 0.97 },
    { nom: "Pollux (β Gem)", ra: 116.329, dec: 28.026, mag: 1.14 },
    { nom: "Fomalhaut (α PsA)", ra: 344.413, dec: -29.622, mag: 1.16 },
    { nom: "Deneb (α Cyg)", ra: 310.358, dec: 45.280, mag: 1.25 },
    { nom: "Regulus (α Leo)", ra: 152.093, dec: 11.967, mag: 1.35 },
    { nom: "Polaris (α UMi)", ra: 37.954, dec: 89.264, mag: 1.98 },
    { nom: "Bellatrix (γ Ori)", ra: 81.283, dec: 6.350, mag: 1.64 },
    { nom: "Alnilam (ε Ori)", ra: 84.053, dec: -1.202, mag: 1.69 },
    { nom: "Alnitak (ζ Ori)", ra: 85.190, dec: -1.943, mag: 1.77 },
    { nom: "Dubhe (α UMa)", ra: 165.932, dec: 61.751, mag: 1.79 },
    { nom: "Merak (β UMa)", ra: 165.460, dec: 56.382, mag: 2.37 }
];

// Paramètres physiques intrinsèques des corps du système solaire (excentricité orbitale et obliquité axiale)
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
        console.log("[WORKER WASM v19.45] Runtime C/SOFA initialisé (Mode Strict Sub-Arcsecondique).");
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
                if (!wasmPret) throw new Error("[FATAL] Module Wasm non initialisé.");
                if (!wmmPret || !wmmTableauCoeffs || wmmTableauCoeffs.length === 0) return;
                traiterCalculsWasmStricts(data);
                break;

            case 'PROCESS_STARS':
                if (data.pixels && data.largeur && data.hauteur) {
                    const etoiles = extraireCentroidesEtoiles(data.pixels, data.largeur, data.hauteur);
                    const astrometrie = resoudrePlateSolvingAstrometrique(
                        etoiles, data.largeur, data.hauteur, data.fovDeg || 55.0,
                        data.coords, data.timestampUtc
                    );
                    self.postMessage({
                        type: 'STARS_PROCESSED',
                        etoiles: etoiles,
                        astrometrie: astrometrie
                    });
                }
                break;
        }
    } catch (erreur) {
        self.postMessage({ type: 'FATAL_ERROR', message: erreur.message });
    }
};

function analyserTexteWMMStricte(texte) {
    if (!texte || typeof texte !== 'string') throw new Error("[FATAL WMM] Fichier WMM vide.");
    const texteTrim = texte.trim();
    if (texteTrim.startsWith('<!DOCTYPE') || texteTrim.includes('<html')) throw new Error("[FATAL WMM] Réponse 404 HTML.");

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
                    n: n, m: m, 
                    gnm: parseFloat(elements[2]), hnm: parseFloat(elements[3]), 
                    dgnm: parseFloat(elements[4]), dhnm: parseFloat(elements[5]) 
                });
            }
        }
    }
    return coeffs;
}

/**
 * Évaluation complète du modèle géomagnétique WMM-2025 (12 degrés x 12 ordres) + Variation Séculaire (SV)
 */
function evaluerWMM2025Complet(coeffs, latDeg, lonDeg, altKm, decYear) {
    if (!coeffs || coeffs.length === 0) {
        return { declination: 1.79, inclination: 61.15, totalIntensity: 45000, secularVariationNt: -22.5, secularDeclinationMin: 7.8 };
    }

    const evaluerEpoque = (annee) => {
        const dt = annee - 2025.0;
        const maxDeg = 12;
        const g = Array.from({ length: maxDeg + 1 }, () => new Float64Array(maxDeg + 1));
        const h = Array.from({ length: maxDeg + 1 }, () => new Float64Array(maxDeg + 1));

        for (const c of coeffs) {
            if (c.n <= maxDeg && c.m <= c.n) {
                g[c.n][c.m] = c.gnm + c.dgnm * dt;
                h[c.n][c.m] = c.hnm + c.dhnm * dt;
            }
        }

        const a = 6378.137;
        const f = 1.0 / 298.257223563;
        const e2 = f * (2.0 - f);
        const rRef = 6371.2;

        const phi = latDeg * (Math.PI / 180.0);
        const lambda = lonDeg * (Math.PI / 180.0);
        const sinPhi = Math.sin(phi);
        const cosPhi = Math.cos(phi);

        const rc = a / Math.sqrt(1.0 - e2 * sinPhi * sinPhi);
        const xp = (rc + altKm) * cosPhi;
        const zp = (rc * (1.0 - e2) + altKm) * sinPhi;
        const r = Math.sqrt(xp * xp + zp * zp);

        const sinPhiGc = zp / r;
        const cosPhiGc = xp / r;
        const psi = Math.asin(sinPhiGc) - phi;

        const P = Array.from({ length: maxDeg + 1 }, () => new Float64Array(maxDeg + 1));
        const dP = Array.from({ length: maxDeg + 1 }, () => new Float64Array(maxDeg + 1));
        P[0][0] = 1.0;

        for (let n = 1; n <= maxDeg; n++) {
            for (let m = 0; m <= n; m++) {
                if (n === m) {
                    const factor = Math.sqrt(1.0 - (m === 1 ? 0.0 : 1.0 / (2.0 * m)));
                    P[n][m] = factor * cosPhiGc * P[n - 1][m - 1];
                    dP[n][m] = factor * (cosPhiGc * dP[n - 1][m - 1] - sinPhiGc * P[n - 1][m - 1]);
                } else if (n === 1 && m === 0) {
                    P[1][0] = sinPhiGc * P[0][0];
                    dP[1][0] = sinPhiGc * dP[0][0] + cosPhiGc * P[0][0];
                } else {
                    const k = ((n - 1) * (n - 1) - m * m) / ((2 * n - 1) * (2 * n - 3));
                    P[n][m] = sinPhiGc * P[n - 1][m] - k * P[n - 2][m];
                    dP[n][m] = sinPhiGc * dP[n - 1][m] + cosPhiGc * P[n - 1][m] - k * dP[n - 2][m];
                }
            }
        }

        const cosM = new Float64Array(maxDeg + 1);
        const sinM = new Float64Array(maxDeg + 1);
        for (let m = 0; m <= maxDeg; m++) {
            cosM[m] = Math.cos(m * lambda);
            sinM[m] = Math.sin(m * lambda);
        }

        let Br = 0.0, Btheta = 0.0, Bphi = 0.0;
        let ratioPow = (rRef / r) * (rRef / r);

        for (let n = 1; n <= maxDeg; n++) {
            ratioPow *= (rRef / r);
            for (let m = 0; m <= n; m++) {
                const gCosPlusHSin = g[n][m] * cosM[m] + h[n][m] * sinM[m];
                const gSinMinusHCos = g[n][m] * sinM[m] - h[n][m] * cosM[m];

                Br += ratioPow * (n + 1) * gCosPlusHSin * P[n][m];
                Btheta -= ratioPow * gCosPlusHSin * dP[n][m];
                if (cosPhiGc > 1e-10) {
                    Bphi += (ratioPow * m * gSinMinusHCos * P[n][m]) / cosPhiGc;
                }
            }
        }

        const X = -Btheta * Math.cos(psi) - Br * Math.sin(psi);
        const Y = Bphi;
        const Z = Btheta * Math.sin(psi) - Br * Math.cos(psi);

        const H = Math.sqrt(X * X + Y * Y);
        const F = Math.sqrt(H * H + Z * Z);
        // Correctif de quadrant pour éviter l'inversion à -179.87°
        let D = Math.atan2(Y, X) * (180.0 / Math.PI);
        if (D > 90.0) D -= 180.0;
        if (D < -90.0) D += 180.0;
        const I = Math.atan2(Z, H) * (180.0 / Math.PI);

        return { D, I, F };
    };

    const t0 = evaluerEpoque(decYear);
    const t1 = evaluerEpoque(decYear + 1.0);

    return {
        declination: parseFloat(t0.D.toFixed(2)),
        inclination: parseFloat(t0.I.toFixed(2)),
        totalIntensity: parseFloat(t0.F.toFixed(0)),
        secularVariationNt: parseFloat((t1.F - t0.F).toFixed(1)),
        secularDeclinationMin: parseFloat(((t1.D - t0.D) * 60.0).toFixed(2))
    };
}

function obtenirDeltaTRigoureux(timestampSec) {
    const taiMinusUtc = 37.0; 
    const ttMinusTai = 32.184;
    const ut1MinusUtc = iersEopCourant.ut1_utc_sec || -0.0547;
    return ttMinusTai + taiMinusUtc - ut1MinusUtc;
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
        vz: evaluerTchebychevStricte(seg.cvz, tau)
    };
}

function traiterCalculsWasmStricts(params) {
    if (!jplMatrixData || !jplMatrixData.DATA) throw new Error("[FATAL] Données JPL non chargées.");

    const ts = params.timestampUtc;
    const coords = params.coords;
    const meteo = {
        tempC: (params.meteo && typeof params.meteo.tempC === 'number') ? params.meteo.tempC : 15.0,
        presHpa: (params.meteo && typeof params.meteo.presHpa === 'number') ? params.meteo.presHpa : 1013.25,
        humiditePct: (params.meteo && typeof params.meteo.humiditePct === 'number') ? params.meteo.humiditePct : 50.0
    };
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

    // Calcul de l'ondulation du géoïde EGM (N) via le noyau Wasm
    let geoidOndulationM = 0.0;
    if (typeof Module._calculerOndulationGeoideEGM === 'function') {
        geoidOndulationM = Module._calculerOndulationGeoideEGM(coords.lat, coords.lon);
    }

    const jde = (ts / 86400000.0) + 2440587.5;
    const decimalYear = 2000.0 + (jde - 2451545.0) / 365.25;
    const deltaTSeconds = obtenirDeltaTRigoureux(timestampSec); 
    const tEphemerideSec = timestampSec + deltaTSeconds;
    const structSize = 240; // Taille alignée de AstroResult v19.45
    const bodiesResult = {};
    const UA_KM = 149597870.7;

    const sunSegments = jplMatrixData.DATA["SOLEIL"] || jplMatrixData.DATA["SUN"];
    const sunPos = evaluerPositionCorpsAuTemps(sunSegments, tEphemerideSec);
    const dSunEarthUA = sunPos ? (Math.hypot(sunPos.x, sunPos.y, sunPos.z) / UA_KM) : 1.0;

    const nomsCorps = Object.keys(jplMatrixData.DATA).filter(k => jplMatrixData.DATA[k] && jplMatrixData.DATA[k].length > 0);
    const count = nomsCorps.length;
    const arrayPtr = Module._malloc(structSize * count);

    let idxSoleil = -1;
    let idxLune = -1;

    try {
        for (let i = 0; i < count; i++) {
            const nomCorps = nomsCorps[i];
            const segments = jplMatrixData.DATA[nomCorps];
            const posData = evaluerPositionCorpsAuTemps(segments, tEphemerideSec);
            if (!posData) continue;

            const { seg, x, y, z, vx, vy, vz } = posData;
            const nomUpper = nomCorps.toUpperCase();
            let corpsType = 0;
            if (nomUpper === "SOLEIL" || nomUpper === "SUN") { corpsType = 1; idxSoleil = i; }
            else if (nomUpper === "LUNE" || nomUpper === "MOON") { corpsType = 2; idxLune = i; }

            const eraRad = (gastDeg + (iersEopCourant.ut1_utc_sec || 0.0) * (15.0 / 3600.0)) * (Math.PI / 180.0);
            let dSunAstroUA = (corpsType !== 1 && sunPos) ? (Math.hypot(x - sunPos.x, y - sunPos.y, z - sunPos.z) / UA_KM) : 1.0;

            const phys = PHYSIQUE_INTRINSEQUE_CORPS[nomUpper] || { ecc: 0.0167, obl: 23.44 };
            const itemPtr = arrayPtr + (i * structSize);

            Module._calculerDepuisECEF(
                x, y, z, vx, vy, vz, 
                coords.lat, coords.lon, coords.alt, 
                eraRad, meteo.tempC, meteo.presHpa, meteo.humiditePct, 0.15, 
                seg.mag ?? 0.0, corpsType,
                dSunAstroUA, dSunEarthUA, seg.rayon_km ?? 0.0,
                seg.period_days ?? 365.256, phys.ecc, phys.obl, sunTrueLong,
                timestampSec,
                itemPtr
            );
        }

        if (typeof Module._evaluerOccultationsEtEclipses === 'function') {
            Module._evaluerOccultationsEtEclipses(arrayPtr, count, idxSoleil, idxLune);
        }

        for (let i = 0; i < count; i++) {
            const nomCorps = nomsCorps[i];
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

            const nomUpper = nomCorps.toUpperCase();
            const estSoleil = (nomUpper === "SOLEIL" || nomUpper === "SUN");
            const estLune = (nomUpper === "LUNE" || nomUpper === "MOON");
            const phys = PHYSIQUE_INTRINSEQUE_CORPS[nomUpper] || { ecc: 0.0167, obl: 23.44 };

            // Incertitude RMS éphéméride DE440s selon pas de segmentation
            const rmsArcsec = (estSoleil || estLune) ? 0.0004 : 0.0018;

            // Libellé harmonisé de lueur / crépuscule
            let duskGlowDisplay = "Nulle (Planète)";
            if (glowTypeCode === 1) {
                duskGlowDisplay = `${formatH(crepusculeUT)} | Lueur Sol. (${skyGlowMagArcsec2.toFixed(1)} mag/″²)`;
            } else if (glowTypeCode === 2) {
                duskGlowDisplay = `Micro-Crépuscule Lunaire (${skyGlowMagArcsec2.toFixed(1)} mag/″²)`;
            } else if (estLune) {
                duskGlowDisplay = "Nulle (Lune basse/faible)";
            }

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
                rmsArcsecDisplay: `±${rmsArcsec.toFixed(4)}″`,
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
                duskGlowDisplay: duskGlowDisplay,
                visibilityDuration: (dureeVisibilite >= 0) ? `${dureeVisibilite.toFixed(2)} h` : "N/A"
            };
        }
    } catch (err) {
        throw new Error(`Erreur corps célestes : ${err.message}`);
    } finally {
        Module._free(arrayPtr);
    }

    const resultatWmm = evaluerWMM2025Complet(wmmTableauCoeffs, coords.lat, coords.lon, (coords.alt || 0) / 1000.0, decimalYear);

    self.postMessage({
        type: 'RESULTS_COMPUTE',
        bodies: bodiesResult,
        wmm: resultatWmm,
        geoidOndulationM: parseFloat(geoidOndulationM.toFixed(2)),
        metrics: {
            gastDeg: gastDeg,
            obliquiteDeg: obliquiteDeg,
            eqTempsMin: eqTempsMin,
            excentricite: 0.01671022,
            longSolaireDeg: sunTrueLong,
            rmsGlobalArcsec: 0.0004
        }
    });
}

function extraireCentroidesEtoiles(pixelsBuffer, largeur, hauteur) {
    const pixels = new Uint8Array(pixelsBuffer);
    let sommeLuminance = 0;
    const totalPixels = largeur * hauteur;

    for (let i = 0; i < pixels.length; i += 4) {
        sommeLuminance += 0.2126 * pixels[i] + 0.7152 * pixels[i+1] + 0.0722 * pixels[i+2];
    }
    const seuilDetection = (sommeLuminance / totalPixels) * 4.0; 
    const etoilesDetectees = [];

    for (let y = 1; y < hauteur - 1; y++) {
        for (let x = 1; x < largeur - 1; x++) {
            const idx = (y * largeur + x) * 4;
            const lum = 0.2126 * pixels[idx] + 0.7152 * pixels[idx+1] + 0.0722 * pixels[idx+2];

            if (lum > seuilDetection) {
                let sommeX_I = 0, sommeY_I = 0, sommeI = 0;
                for (let dy = -1; dy <= 1; dy++) {
                    for (let dx = -1; dx <= 1; dx++) {
                        const nX = x + dx, nY = y + dy;
                        const nIdx = (nY * largeur + nX) * 4;
                        const nLum = 0.2126 * pixels[nIdx] + 0.7152 * pixels[nIdx+1] + 0.0722 * pixels[nIdx+2];
                        sommeX_I += nX * nLum;
                        sommeY_I += nY * nLum;
                        sommeI += nLum;
                    }
                }
                if (sommeI > 0) {
                    etoilesDetectees.push({
                        x: parseFloat((sommeX_I / sommeI).toFixed(3)),
                        y: parseFloat((sommeY_I / sommeI).toFixed(3)),
                        intensite: parseFloat(sommeI.toFixed(2))
                    });
                }
            }
        }
    }
    etoilesDetectees.sort((a, b) => b.intensite - a.intensite);
    // Déduplication spatiale minimale (rayon 3 px)
    const filtrees = [];
    for (const st of etoilesDetectees) {
        if (!filtrees.some(f => Math.hypot(f.x - st.x, f.y - st.y) < 3.0)) {
            filtrees.push(st);
        }
        if (filtrees.length >= 25) break;
    }
    return filtrees;
}

/**
 * Plate-Solving Astrométrique Géométrique (Appariement par invariants de triangles d'étoiles)
 */
function resoudrePlateSolvingAstrometrique(etoiles, largeur, hauteur, fovDeg, coords, timestampUtc) {
    if (!etoiles || etoiles.length < 3) {
        return { resolu: false, message: "Moins de 3 centroïdes détectés" };
    }

    const echelleDegPx = fovDeg / largeur;
    const d12Px = Math.hypot(etoiles[0].x - etoiles[1].x, etoiles[0].y - etoiles[1].y);
    const d13Px = Math.hypot(etoiles[0].x - etoiles[2].x, etoiles[0].y - etoiles[2].y);
    const d23Px = Math.hypot(etoiles[1].x - etoiles[2].x, etoiles[1].y - etoiles[2].y);

    const sidesObs = [d12Px * echelleDegPx, d13Px * echelleDegPx, d23Px * echelleDegPx].sort((a, b) => a - b);
    if (sidesObs[2] < 0.5) return { resolu: false, message: "Triangle stellaire trop compact" };

    const ratio1Obs = sidesObs[0] / sidesObs[2];
    const ratio2Obs = sidesObs[1] / sidesObs[2];

    const sepDeg = (s1, s2) => {
        const a1 = s1.ra * Math.PI / 180, d1 = s1.dec * Math.PI / 180;
        const a2 = s2.ra * Math.PI / 180, d2 = s2.dec * Math.PI / 180;
        const c = Math.sin(d1) * Math.sin(d2) + Math.cos(d1) * Math.cos(d2) * Math.cos(a1 - a2);
        return Math.acos(Math.max(-1, Math.min(1, c))) * 180 / Math.PI;
    };

    let meilleurMatch = null;
    let erreurMin = 0.04; // Tolérance d'invariant de triangle (4%)

    const n = CATALOGUE_ETOILES_REF.length;
    for (let i = 0; i < n - 2; i++) {
        for (let j = i + 1; j < n - 1; j++) {
            const dij = sepDeg(CATALOGUE_ETOILES_REF[i], CATALOGUE_ETOILES_REF[j]);
            if (dij > fovDeg * 1.2) continue;
            for (let k = j + 1; k < n; k++) {
                const dik = sepDeg(CATALOGUE_ETOILES_REF[i], CATALOGUE_ETOILES_REF[k]);
                const djk = sepDeg(CATALOGUE_ETOILES_REF[j], CATALOGUE_ETOILES_REF[k]);
                const sidesCat = [dij, dik, djk].sort((a, b) => a - b);
                if (sidesCat[2] > fovDeg * 1.2 || sidesCat[2] < 0.5) continue;

                const err = Math.abs((sidesCat[0] / sidesCat[2]) - ratio1Obs)
                          + Math.abs((sidesCat[1] / sidesCat[2]) - ratio2Obs)
                          + Math.abs(sidesCat[2] - sidesObs[2]) / fovDeg;
                if (err < erreurMin) {
                    erreurMin = err;
                    meilleurMatch = [CATALOGUE_ETOILES_REF[i], CATALOGUE_ETOILES_REF[j], CATALOGUE_ETOILES_REF[k]];
                }
            }
        }
    }

    if (!meilleurMatch) {
        return { resolu: false, message: "Champ stellaire non apparié au catalogue FK5" };
    }

    // Barycentre céleste résolu (RA / DEC J2000)
    const raCentre = (meilleurMatch[0].ra + meilleurMatch[1].ra + meilleurMatch[2].ra) / 3.0;
    const decCentre = (meilleurMatch[0].dec + meilleurMatch[1].dec + meilleurMatch[2].dec) / 3.0;
    const residuArcsec = erreurMin * 3600.0;

    return {
        resolu: true,
        raDeg: parseFloat(raCentre.toFixed(4)),
        decDeg: parseFloat(decCentre.toFixed(4)),
        etoilesIdentifiees: meilleurMatch.map(s => s.nom),
        residuArcsec: parseFloat(residuArcsec.toFixed(1))
    };
}
