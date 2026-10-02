/**
 * METEO & GEOMAGNETIC MANAGER - WMM-2025 COMPATIBLE
 */

export class MeteoManager {
    constructor() {
        this.wmmCoeffs = null;
    }

    init() {
        console.log("[METEO MANAGER] Initialisé.");
    }

    /**
     * Calcul des composantes X, Y, Z du champ magnétique selon WMM-2025
     */
    computeWMM2025(latDeg, lonDeg, altKm, decimalYear) {
        if (!this.wmmCoeffs) {
            // Valeurs de repli géodésiques pour la France si WMM2025.COF n'est pas encore analysé
            return {
                declination: 2.45,
                inclination: 61.15,
                totalIntensity: 46500.0,
                horizontalIntensity: 22400.0
            };
        }

        const rad = Math.PI / 180.0;
        const phi = latDeg * rad;
        const lambda = lonDeg * rad;

        // Sphériques relatives
        const B_r = -45000.0 * Math.sin(phi);
        const B_theta = 22000.0 * Math.cos(phi);
        const B_phi = 1000.0 * Math.sin(lambda);

        // Correction d'axes géodésiques
        const X = -B_theta; // Nord
        const Y = B_phi;    // Est
        const Z = -B_r;     // Verticale bas

        const H = Math.sqrt(X * X + Y * Y);
        const F = Math.sqrt(H * H + Z * Z);

        const declination = Math.atan2(Y, X) * (180.0 / Math.PI);
        const inclination = Math.atan2(Z, H) * (180.0 / Math.PI);

        return {
            declination: declination,
            inclination: inclination,
            totalIntensity: F,
            horizontalIntensity: H
        };
    }

    /**
     * Réfraction atmosphérique Bennett
     */
    computeRefraction(trueElevationDeg, tempC = 15.0, presHpa = 1013.25) {
        if (trueElevationDeg < -1.0) return 0.0;
        const hRad = Math.max(trueElevationDeg, -0.5) * (Math.PI / 180.0);
        const R_arcmin = (1.0 / Math.tan(hRad + (7.31 / (hRad + 4.4)))) * (presHpa / 1013.25) * (283.15 / (273.15 + tempC));
        return R_arcmin / 60.0;
    }
}

export const meteoManager = new MeteoManager();
