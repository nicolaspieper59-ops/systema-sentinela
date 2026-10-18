/**
 * METEO & GEOMAGNETIC MANAGER - STRICT MODE (WMM-2025 COMPLET 12x12)
 */

export class MeteoManager {
    constructor() {
        this.wmmCoeffs = null;
    }

    init() {
        console.log("[METEO MANAGER] Initialisé en mode strict (WMM-2025 complet).");
    }

    parseWMM2025COF(cofText) {
        if (!cofText || cofText.trim().length === 0) {
            throw new Error("[FATAL] Fichier WMM2025.COF absent ou vide.");
        }
        const lines = cofText.split('\n');
        const coeffs = [];
        for (let line of lines) {
            line = line.trim();
            if (!line || line.startsWith('99999999') || line.startsWith('WMM')) continue;
            const parts = line.split(/\s+/);
            if (parts.length >= 6) {
                coeffs.push({
                    n: parseInt(parts[0], 10),
                    m: parseInt(parts[1], 10),
                    g: parseFloat(parts[2]),
                    h: parseFloat(parts[3]),
                    dg: parseFloat(parts[4]),
                    dh: parseFloat(parts[5])
                });
            }
        }
        if (coeffs.length === 0) {
            throw new Error("[FATAL] Aucun coefficient valide trouvé dans WMM2025.COF.");
        }
        this.wmmCoeffs = coeffs;
        console.log(`[METEO MANAGER] WMM-2025 chargé (${coeffs.length} coefficients).`);[cite: 6]
    }

    computeWMM2025(latDeg, lonDeg, altKm, decimalYear) {
        if (!this.wmmCoeffs) {
            throw new Error("[FATAL] Calcul magnétique impossible : coefficients WMM non chargés.");[cite: 6]
        }

        const dt = decimalYear - 2025.0;
        const rad = Math.PI / 180.0;
        const phi = latDeg * rad;
        const lambda = lonDeg * rad;

        // Paramètres géodésiques de référence WMM-2025 (WGS84)
        const a = 6371.2; // Rayon moyen de référence (km)
        const r = a + altKm;
        const altRatio = a / r;

        // Tableaux dynamiques pour les harmoniques sphériques (Degré max = 12)
        const nMax = 12;
        let P = Array.from({ length: nMax + 2 }, () => new Array(nMax + 2).fill(0.0));
        let dP = Array.from({ length: nMax + 2 }, () => new Array(nMax + 2).fill(0.0));

        // Initialisation des fonctions de Legendre semi-normalisées de Schmidt
        P[0][0] = 1.0;
        dP[0][0] = 0.0;

        const sinPhi = Math.sin(phi);
        const cosPhi = Math.cos(phi);

        for (let n = 1; n <= nMax; n++) {
            for (let m = 0; m <= n; m++) {
                if (n === m) {
                    P[n][n] = sinPhi * P[n - 1][n - 1];
                    dP[n][n] = sinPhi * dP[n - 1][n - 1] + cosPhi * P[n - 1][n - 1];
                } else if (n === 1 && m === 0) {
                    P[1][0] = sinPhi * P[0][0];
                    dP[1][0] = sinPhi * dP[0][0] - cosPhi * P[0][0];
                } else if (n > 1 && n !== m) {
                    let k = (((n - 1) * (n - 1)) - (m * m)) / (((2 * n - 1) * (2 * n - 3)));
                    P[n][m] = sinPhi * P[n - 1][m] - Math.sqrt(k) * P[n - 2][m];
                    dP[n][m] = sinPhi * dP[n - 1][m] - cosPhi * P[n - 1][m] - Math.sqrt(k) * dP[n - 2][m];
                }
            }
        }

        let q = altRatio;
        let B_r = 0.0, B_theta = 0.0, B_phi = 0.0;

        // Cosinus et sinus de l'ordre m * lambda
        let cosMlambda = new Array(nMax + 1);
        let sinMlambda = new Array(nMax + 1);
        cosMlambda[0] = 1.0;
        sinMlambda[0] = 0.0;
        for (let m = 1; m <= nMax; m++) {
            cosMlambda[m] = Math.cos(m * lambda);
            sinMlambda[m] = Math.sin(m * lambda);
        }

        for (let c of this.wmmCoeffs) {
            if (c.n > nMax || c.m > c.n) continue;
            
            const g = c.g + c.dg * dt;
            const h = c.h + c.dh * dt;

            let q_pow = Math.pow(altRatio, c.n + 2);

            const p_val = P[c.n][c.m];
            const dp_val = dP[c.n][c.m];

            const cos_term = g * cosMlambda[c.m] + h * sinMlambda[c.m];
            const sin_term = g * sinMlambda[c.m] - h * cosMlambda[c.m];

            B_r += q_pow * (c.n + 1) * p_val * cos_term;
            B_theta -= q_pow * dp_val * cos_term;
            if (c.m > 0) {
                B_phi += q_pow * (c.m / Math.max(1e-6, cosPhi)) * p_val * sin_term;
            }
        }

        B_r = -B_r;
        B_theta = -B_theta;

        const X = -B_theta; 
        const Y = B_phi;    
        const Z = B_r;     

        const H = Math.sqrt(X * X + Y * Y);
        const F = Math.sqrt(H * H + Z * Z);

        return {
            declination: Math.atan2(Y, X) * (180.0 / Math.PI),
            inclination: Math.atan2(Z, H) * (180.0 / Math.PI),
            totalIntensity: Math.abs(F),
            horizontalIntensity: H
        };
    }

    computeRefraction(trueElevationDeg, tempC, presHpa) {
        if (tempC === undefined || presHpa === undefined || tempC === null || presHpa === null) {
            throw new Error("[FATAL] Paramètres atmosphériques requis (tempC et presHpa) absents pour la réfraction.");[cite: 6]
        }
        if (trueElevationDeg < -1.0) return 0.0;
        const hRad = Math.max(trueElevationDeg, -0.5) * (Math.PI / 180.0);
        const R_arcmin = (1.0 / Math.tan(hRad + (7.31 / (hRad + 4.4 * (Math.PI / 180.0))))) * (presHpa / 1013.25) * (283.15 / (273.15 + tempC));
        return Math.max(0.0, R_arcmin / 60.0);[cite: 6]
    }
}

export const meteoManager = new MeteoManager();[cite: 6]
