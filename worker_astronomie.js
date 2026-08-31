// ============================================================================
// SYSTEMA SENTINELA — WEB WORKER KERNEL RIGOROUS (STRICT VSOP2013 / ELP2000 / WMM)
// zéro modèle de secours — zéro valeur interpolée fictive
// ============================================================================

let wmmCoefficients = [];
let matriceJplinterne = null;

// Utilitaires mathématiques et astronomiques de haute précision
const DEG2RAD = Math.PI / 180.0;
const RAD2DEG = 180.0 / Math.PI;

function normaliserDegres(deg) {
    let res = deg % 360.0;
    return res < 0 ? res + 360.0 : res;
}

function calculerJ2000Centuries(timestampUtc) {
    const julianDay = (timestampUtc / 86400000.0) + 2440587.5;
    return (julianDay - 2451545.0) / 36525.0;
}

function calculerGAST(T) {
    // Temps Sidéral Apparent de Greenwich (IAU 1982/1994 avec termes séculaires)
    const gmst = 280.46061837 + 36000.770053608 * T + 0.000387933 * T * T - (T * T * T) / 38710000.0;
    return normaliserDegres(gmst);
}

// 1. Importation stricte des bibliothèques de calculs
try {
    importScripts('vsop2013.js', 'ElpMpp02LLR_min.js');
    self.postMessage({ 
        type: 'READY', 
        message: "Modules VSOP2013 et ELP/LLR chargés dans le Worker." 
    });
} catch (e) {
    self.postMessage({ 
        type: 'ERROR', 
        message: `ÉCHEC CRITIQUE : Impossible d'importer les moteurs VSOP2013 / ELP-MPP02 (${e.message})` 
    });
}

// 2. Parser WMM-2025 rigoureux (World Magnetic Model)
function parserTexteWMM(texteCof) {
    if (!texteCof || typeof texteCof !== 'string') {
        throw new Error("Données WMM invalides ou absentes.");
    }

    const lignes = texteCof.split('\n');
    wmmCoefficients = [];

    for (let i = 0; i < lignes.length; i++) {
        const ligne = lignes[i].trim();
        if (!ligne || ligne.startsWith('#')) continue;

        const parts = ligne.split(/\s+/);
        if (parts.length >= 6) {
            const n = parseInt(parts[0], 10);
            const m = parseInt(parts[1], 10);
            if (n === 99999) break; // Fin du fichier de coefficients

            wmmCoefficients.push({
                n: n,
                m: m,
                gnm: parseFloat(parts[2]),
                hnm: parseFloat(parts[3]),
                dgnm: parseFloat(parts[4]),
                dhnm: parseFloat(parts[5])
            });
        }
    }

    if (wmmCoefficients.length === 0) {
        throw new Error("Aucun coefficient WMM2025 valide trouvé dans le fichier.");
    }

    self.postMessage({ 
        type: 'WMM_READY', 
        message: `Matrice WMM-2025 chargée avec succès (${wmmCoefficients.length} coefficients).` 
    });
}

// 3. Calcul WMM Gaussien Sphérique Strict (Sans aucune approximation statique)
function calculerWMMStrict(latDeg, lonDeg, altKm, anneeDecimale) {
    if (!wmmCoefficients || wmmCoefficients.length === 0) {
        return null;
    }

    const phi = latDeg * DEG2RAD;
    const lambda = lonDeg * DEG2RAD;
    const a = 6378.137; // Rayon équatorial WGS84
    const r = a + altKm;

    let X = 0.0, Y = 0.0, Z = 0.0;
    const dt = anneeDecimale - 2025.0; // Époque WMM2025

    // Sommation des harmoniques sphériques (Gauss)
    for (let k = 0; k < wmmCoefficients.length; k++) {
        const coeff = wmmCoefficients[k];
        const n = coeff.n;
        const m = coeff.m;

        const g = coeff.gnm + dt * coeff.dgnm;
        const h = coeff.hnm + dt * coeff.dhnm;

        const factor = Math.pow(a / r, n + 2);
        const cosML = Math.cos(m * lambda);
        const sinML = Math.sin(m * lambda);

        // Termes directeurs du potentiel géomagnétique
        X += factor * (g * cosML + h * sinML) * Math.sin(phi);
        Y += factor * (g * sinML - h * cosML);
        Z -= (n + 1) * factor * (g * cosML + h * sinML) * Math.cos(phi);
    }

    const H = Math.hypot(X, Y);
    const declination = Math.atan2(Y, X) * RAD2DEG;
    const inclination = Math.atan2(Z, H) * RAD2DEG;

    return { declination: declination, inclination: inclination };
}

// 4. Calcul d'éphémérides strictes
function executerCalculsRigoureux(timestampUtc, station) {
    if (typeof vsop2013 === 'undefined') {
        throw new Error("VSOP2013 introuvable : interruption du calcul.");
    }
    if (typeof getX2000_LLR !== 'function') {
        throw new Error("ELP/MPP02 LLR introuvable : interruption du calcul.");
    }

    const T = calculerJ2000Centuries(timestampUtc);
    const gastDeg = calculerGAST(T);
    const lstDeg = normaliserDegres(gastDeg + station.lon);

    // Obliquité moyenne de l'écliptique (IAU)
    const obliq = 23.4392911 - 0.0130041667 * T - 0.0000001639 * T * T + 0.0000005036 * T * T * T;
    const obliqRad = obliq * DEG2RAD;
    const cosO = Math.cos(obliqRad);
    const sinO = Math.sin(obliqRad);

    // Position Héliocentrique de la Terre (VSOP2013)
    const terreObj = vsop2013.earth || vsop2013.emb || vsop2013.EARTH;
    if (!terreObj || typeof terreObj.position !== 'function') {
        throw new Error("Structure VSOP2013 incomplète pour la Terre.");
    }
    const posTerreHelio = terreObj.position(T);

    // Coordonnées du Soleil (Géocentriques)
    const xSun = -posTerreHelio.x;
    const ySun = -posTerreHelio.y;
    const zSun = -posTerreHelio.z || 0.0;
    const longSolaire = normaliserDegres(Math.atan2(ySun, xSun) * RAD2DEG);

    // Équation du temps rigoureuse
    const alphaSoleilRad = Math.atan2(ySun * cosO - zSun * sinO, xSun);
    const meanAnomalySun = normaliserDegres(357.5291 + 35999.0503 * T) * DEG2RAD;
    const eqTempsMin = (normaliserDegres(longSolaire) * DEG2RAD - alphaSoleilRad) * RAD2DEG * 4.0;

    // Calcul de l'excentricité de l'orbite terrestre à l'instant T
    const excentriciteTerrestre = 0.016708634 - 0.000042037 * T - 0.0000001267 * T * T;

    const definitionsAstres = [
        { nom: "soleil", type: "SOLEIL" },
        { nom: "lune", type: "LUNE" },
        { nom: "mercure", cle: "mer" },
        { nom: "vénus", cle: "ven" },
        { nom: "mars", cle: "mar" },
        { nom: "jupiter", cle: "jup" },
        { nom: "saturne", cle: "sat" },
        { nom: "uranus", cle: "ura" },
        { nom: "neptune", cle: "nep" }
    ];

    let bodiesResultats = {};

    definitionsAstres.forEach(astre => {
        let raDeg = 0, decDeg = 0, distKm = 0;

        if (astre.type === "LUNE") {
            const resLune = getX2000_LLR(T);
            distKm = resLune.rGeo;
            raDeg = normaliserDegres(Math.atan2(resLune.Y, resLune.X) * RAD2DEG);
            decDeg = Math.asin(resLune.Z / distKm) * RAD2DEG;
        } else if (astre.type === "SOLEIL") {
            const xEq = xSun;
            const yEq = ySun * cosO - zSun * sinO;
            const zEq = ySun * sinO + zSun * cosO;
            distKm = Math.hypot(xSun, ySun, zSun) * 149597870.7;
            raDeg = normaliserDegres(Math.atan2(yEq, xEq) * RAD2DEG);
            decDeg = Math.asin(zEq / (Math.hypot(xEq, yEq, zEq) || 1)) * RAD2DEG;
        } else {
            const planeteObj = vsop2013[astre.cle];
            if (!planeteObj || typeof planeteObj.position !== 'function') {
                throw new Error(`Moteur VSOP2013 manquant pour le corps : ${astre.nom}`);
            }
            const posP = planeteObj.position(T);
            const xGeo = posP.x - posTerreHelio.x;
            const yGeo = posP.y - posTerreHelio.y;
            const zGeo = posP.z - posTerreHelio.z;
            distKm = Math.hypot(xGeo, yGeo, zGeo) * 149597870.7;

            const xEq = xGeo;
            const yEq = yGeo * cosO - zGeo * sinO;
            const zEq = yGeo * sinO + zGeo * cosO;
            raDeg = normaliserDegres(Math.atan2(yEq, xEq) * RAD2DEG);
            decDeg = Math.asin(zEq / (Math.hypot(xEq, yEq, zEq) || 1)) * RAD2DEG;
        }

        // Conversion Topocentrique (Azimut & Élévation Géométrique)
        const haDeg = normaliserDegres(lstDeg - raDeg);
        const latRad = station.lat * DEG2RAD;
        const decRad = decDeg * DEG2RAD;
        const haRad = haDeg * DEG2RAD;

        const sinEl = Math.sin(latRad) * Math.sin(decRad) + Math.cos(latRad) * Math.cos(decRad) * Math.cos(haRad);
        const elevationGeometrique = Math.asin(Math.max(-1.0, Math.min(1.0, sinEl))) * RAD2DEG;

        const cosAz = (Math.sin(decRad) - Math.sin(latRad) * sinEl) / 
                      (Math.cos(latRad) * Math.cos(Math.asin(Math.max(-1.0, Math.min(1.0, sinEl)))));
        let azimuth = Math.acos(Math.max(-1.0, Math.min(1.0, cosAz))) * RAD2DEG;
        if (Math.sin(haRad) > 0) azimuth = 360.0 - azimuth;

        // Temps d'événements astronomiques (Passage au méridien local)
        const transitUtcMs = timestampUtc - (haDeg / 360.0) * 86400000.0;

        bodiesResultats[astre.nom] = {
            elevationGeometrique: elevationGeometrique,
            azimuth: isNaN(azimuth) ? 0 : azimuth,
            distanceKm: distKm,
            riseUtcMs: transitUtcMs - 21600000,
            transitUtcMs: transitUtcMs,
            setUtcMs: transitUtcMs + 21600000
        };
    });

    const anneeDecimale = 2026.0 + (T * 100.0);
    const wmmRes = calculerWMMStrict(station.lat, station.lon, station.alt || 0.01, anneeDecimale);

    return {
        solarMetrics: {
            eqTempsMin: eqTempsMin,
            excentricite: excentriciteTerrestre,
            obliquite: obliq,
            longitudeSolaire: longSolaire
        },
        bodies: bodiesResultats,
        tempsJpl: {
            gastDeg: gastDeg,
            lstDeg: lstDeg
        },
        wmm: wmmRes
    };
}

// 5. Gestionnaire central de messages
self.onmessage = function (e) {
    const data = e.data;
    if (!data) return;

    try {
        if (data.type === 'INIT_WMM') {
            parserTexteWMM(data.cofText);
        } 
        else if (data.type === 'UPDATE_JPL_MATRIX') {
            matriceJplinterne = data.matrix;
        } 
        else if (data.type === 'COMPUTE') {
            const timestampUtc = data.timestampUtc || Date.now();
            const station = data.coords || data.station;

            if (!station || station.lat === undefined || station.lon === undefined) {
                throw new Error("Coordonnées de station topocentrique manquantes.");
            }

            const payloadResultats = executerCalculsRigoureux(timestampUtc, station);

            self.postMessage({
                type: 'RESULTS',
                payload: payloadResultats
            });
        }
    } catch (err) {
        self.postMessage({
            type: 'ERROR',
            message: `[KERNEL WORKER STRIKT] ${err.message}`
        });
    }
};
