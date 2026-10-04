/**
 * METEO & GEOMAGNETIC MANAGER - STRICT MODE (WMM-2025)
 */

export class MeteoManager {
    constructor() {
        this.wmmCoeffs = null;
    }

    init() {
        console.log("[METEO MANAGER] Initialisé en mode strict.");
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
        console.log(`[METEO MANAGER] WMM-2025 chargé (${coeffs.length} coefficients).`);
    }

    computeWMM2025(latDeg, lonDeg, altKm, decimalYear) {
        if (!this.wmmCoeffs) {
            throw new Error("[FATAL] Calcul magnétique impossible : coefficients WMM non chargés.");
        }

        const rad = Math.PI / 180.0;
        const phi = latDeg * rad;
        const lambda = lonDeg * rad;

        let g10 = -29404.5, g11 = -1450.9, h11 = 4652.9;
        const dt = decimalYear - 2025.0;

        for (let c of this.wmmCoeffs) {
            if (c.n === 1 && c.m === 0) g10 += c.dg * dt;
            if (c.n === 1 && c.m === 1) { g11 += c.dg * dt; h11 += c.dh * dt; }
        }

        const B_r = 2.0 * (g10 * Math.sin(phi) + (g11 * Math.cos(lambda) + h11 * Math.sin(lambda)) * Math.cos(phi));
        const B_theta = - (g10 * Math.cos(phi) - (g11 * Math.cos(lambda) + h11 * Math.sin(lambda)) * Math.sin(phi));
        const B_phi = - (-g11 * Math.sin(lambda) + h11 * Math.cos(lambda));

        const X = -B_theta; 
        const Y = B_phi;    
        const Z = -B_r;     

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
            throw new Error("[FATAL] Paramètres atmosphériques requis (tempC et presHpa) absents pour la réfraction.");
        }
        if (trueElevationDeg < -1.0) return 0.0;
        const hRad = Math.max(trueElevationDeg, -0.5) * (Math.PI / 180.0);
        const R_arcmin = (1.0 / Math.tan(hRad + (7.31 / (hRad + 4.4 * (Math.PI / 180.0))))) * (presHpa / 1013.25) * (283.15 / (273.15 + tempC));
        return Math.max(0.0, R_arcmin / 60.0);
    }
}

export const meteoManager = new MeteoManager();
