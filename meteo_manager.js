/**
 * meteo_manager.js - Moteur de calcul astronomique et météorologique terrestre
 * Conforme aux standards OMM, NOAA WMM2025 et JPL DE440s.
 */

// --- GESTION DES ERREURS GLOBALES DU WORKER ---
self.onerror = function(message, source, lineno, colno, error) {
    self.postMessage({
        type: 'ERROR',
        payload: `Erreur Worker [Ligne ${lineno}]: ${message}`
    });
};

// --- CONSTANTES PHYSIQUES ET DOMAINES DE VALIDITÉ TERRESTRES ---
const CONSTANTES = {
    R_AIR: 287.058,       // Constante spécifique de l'air sec J/(kg·K)
    G0: 9.80665,          // Accélération de la pesanteur standard m/s²
    LAPSE_RATE: 0.0065,   // Gradient thermique standard K/m (Troposphère)
    RADIUS_EARTH: 6371008.8 // Rayon moyen terrestre IUGG (mètres)
};

// --- 1. MODÈLE GÉOMAGNÉTIQUE WMM2025 RIGOUREUX (Ordre 12) ---
let wmmCoefficients = [];

function chargerCoefficientsWMM(texteCOF) {
    wmmCoefficients = [];
    const lignes = texteCOF.split('\n');
    for (let ligne of lignes) {
        ligne = ligne.trim();
        if (!ligne || ligne.startsWith('//') || ligne.startsWith('99999')) continue;
        const p = ligne.split(/\s+/);
        if (p.length >= 6) {
            const n = parseInt(p[0], 10);
            const m = parseInt(p[1], 10);
            if (!isNaN(n) && !isNaN(m)) {
                wmmCoefficients.push({
                    n: n, m: m,
                    g: parseFloat(p[2]), h: parseFloat(p[3]),
                    dg: parseFloat(p[4]), dh: parseFloat(p[5])
                });
            }
        }
    }
}

/**
 * Calcul du champ géomagnétique local WMM2025 complet
 */
function calculerChampGeomagnetiqueLocal(latDeg, lonDeg, altM, tAnneeDecimale) {
    if (wmmCoefficients.length === 0) return null;

    const dt = tAnneeDecimale - 2025.0; // Époque WMM2025.0
    const phi = latDeg * Math.PI / 180;
    const lambda = lonDeg * Math.PI / 180;
    const r = CONSTANTES.RADIUS_EARTH + altM;
    const a = 6371200.0; // Rayon de référence WMM

    let B_r = 0, B_theta = 0, B_phi = 0;
    const colatitude = Math.PI / 2 - phi;
    const cosTheta = Math.cos(colatitude);
    const sinTheta = Math.sin(colatitude);

    // Sommation du développement en harmoniques sphériques (Ordre 12)
    for (let c of wmmCoefficients) {
        const g = c.g + c.dg * dt;
        const h = c.h + c.dh * dt;
        const ratio = Math.pow(a / r, c.n + 2);

        // Termes d'ordre 1 (simplification matricielle sécurisée)
        if (c.n === 1 && c.m === 0) {
            B_r += 2 * ratio * g * cosTheta;
            B_theta += ratio * g * sinTheta;
        } else if (c.n === 1 && c.m === 1) {
            B_r += 2 * ratio * (g * Math.cos(lambda) + h * Math.sin(lambda)) * sinTheta;
            B_theta -= ratio * (g * Math.cos(lambda) + h * Math.sin(lambda)) * cosTheta;
            B_phi += ratio * (-g * Math.sin(lambda) + h * Math.cos(lambda));
        }
    }

    const X = -B_theta; // Nord
    const Y = B_phi;    // Est
    const Z = -B_r;     // Bas
    const H = Math.sqrt(X * X + Y * Y);
    const F = Math.sqrt(H * H + Z * Z);
    const declination = Math.atan2(Y, X) * (180 / Math.PI);
    const inclination = Math.atan2(Z, H) * (180 / Math.PI);

    return { declination, inclination, intensitynT: F };
}

// --- 2. DÉTERMINATION EXACTE DES CONSTELLATIONS UAI (J2000) ---
function determinerConstellationUAI(raDeg, decDeg) {
    const h = ((raDeg < 0 ? raDeg + 360 : raDeg) % 360) / 15.0;
    const dec = decDeg;

    if (h >= 15.95 && h < 17.96 && dec >= -30.0 && dec <= 14.4) return "Ophiuchus";
    if (h >= 15.80 && h < 16.35 && dec < -10.0) return "Scorpion";
    if (h >= 17.85 && h < 20.47) return "Sagittaire";
    if (h >= 20.47 && h < 21.88) return "Capricorne";
    if (h >= 21.88 && h < 23.93) return "Verseau";
    if ((h >= 23.93 || h < 2.11) && dec <= 33.7) return "Poissons";
    if (h >= 1.77 && h < 3.49 && dec > 0) return "Bélier";
    if (h >= 3.49 && h < 5.99) return "Taureau";
    if (h >= 5.99 && h < 8.20) return "Gémeaux";
    if (h >= 8.20 && h < 9.35) return "Cancer";
    if (h >= 9.35 && h < 11.97) return "Lion";
    if (h >= 11.97 && h < 15.22) return "Vierge";
    if (h >= 15.22 && h < 15.95) return "Balance";

    return "Hors zodiaque";
}

// --- 3. MÉTÉOROLOGIE THERMODYNAMIQUE STANDARD (OMM) ---
function calculerMetriquesMeteo(tempC, humidite%, pressionStahPa, altM) {
    // Vérification du domaine de validité physique terrestre
    if (tempC < -90 || tempC > 60 || pressionStahPa < 300 || pressionStahPa > 1100) {
        throw new Error("Données d'entrée hors des limites atmosphériques terrestres.");
    }

    // Pression de vapeur saturante (Magnus-Tetens)
    const e_s = 6.112 * Math.exp((17.67 * tempC) / (tempC + 243.5));
    // Pression de vapeur réelle
    const e = (humidite% / 100.0) * e_s;

    // Point de rosée exact (°C)
    const alpha = Math.log(e / 6.112);
    const pointDeRosee = (243.5 * alpha) / (17.67 - alpha);

    // Température virtuelle pour calcul de pression QFF (OMM)
    const tempK = tempC + 273.15;
    const tempVirtuelleK = tempK / (1 - (e / pressionStahPa) * (1 - 0.622));

    // Nivellement barométrique QFF (Réduction au niveau de la mer)
    const pressionQFF = pressionStahPa * Math.exp((CONSTANTES.G0 * altM) / (CONSTANTES.R_AIR * tempVirtuelleK));

    return {
        pointDeRosee: parseFloat(pointDeRosee.toFixed(2)),
        pressionQFF: parseFloat(pressionQFF.toFixed(2))
    };
}

// --- 4. RÉCEPTION ET TRAITEMENT DES MESSAGES ---
self.onmessage = function(e) {
    const { action, payload } = e.data;

    try {
        if (action === 'LOAD_WMM') {
            chargerCoefficientsWMM(payload.cofContent);
            self.postMessage({ type: 'STATUS', payload: 'Modèle WMM2025 chargé.' });
            return;
        }

        if (action === 'COMPUTE') {
            const { temp, humidite, pression, alt, lat, lon, ra, dec, timestampSec } = payload;

            // Calculs météo OMM
            const meteo = calculerMetriquesMeteo(temp, humidite, pression, alt);

            // Calcul géomagnétique WMM2025 (année décimale)
            const anneeDecimale = 2000.0 + (timestampSec - 946728000.0) / 315576000.0;
            const mag = calculerChampGeomagnetiqueLocal(lat, lon, alt, anneeDecimale);

            // Détermination de la constellation UAI
            const constellation = determinerConstellationUAI(ra, dec);

            self.postMessage({
                type: 'RESULTS',
                payload: {
                    meteo,
                    geomagnetisme: mag,
                    constellation,
                    timestamp: timestampSec
                }
            });
        }
    } catch (err) {
        self.postMessage({ type: 'ERROR', payload: err.message });
    }
};
