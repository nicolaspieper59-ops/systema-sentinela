#include <emscripten/emscripten.h>
#include <cmath>
#include <cstring>

#ifndef M_PI
#define M_PI 3.14159265358979323846
#endif

#define DEG2RAD (M_PI / 180.0)
#define RAD2DEG (180.0 / M_PI)

// Structure de sortie contenant les métriques astronomiques complètes
struct AstroResult {
    double azim;          // Azimut (0° = Nord, 90° = Est)
    double elevGeom;      // Élévation géométrique (degrés)
    double elevRefractee; // Élévation apparente avec réfraction (degrés)
    double raDeg;         // Ascension Droite (degrés)
    double decDeg;        // Déclinaison (degrés)
    double distUA;        // Distance à l'observateur (UA)
    double leverUT;       // Heure estimée lever (heures UT)
    double coucherUT;     // Heure estimée coucher (heures UT)
    int visibiliteCode;   // 0 = Masqué/Sous horizon, 1 = Œil nu, 2 = Jumelles, 3 = Télescope
};

extern "C" {

/**
 * Calcul complet de transformation spatiale et métriques de visibilité
 */
EMSCRIPTEN_KEEPALIVE
void calculerPositionTopocentrique(
    double xEcl, double yEcl, double zEcl, // Coordonnées Écliptique J2000 (UA ou Mètres)
    double latDeg, double lonDeg, double altM, // Station Observateur WGS84
    double eraRad,                             // Earth Rotation Angle (ERA en radians)
    double tempC, double presHpa,              // Météo locale
    double magApparente,                       // Magnitude apparente de l'astre
    bool isLuneInKm,                           // True si x,y,z sont en Km (ex: ELP/MPP02)
    AstroResult* result
) {
    // 1. Uniformisation des unités en mètres
    double scale = isLuneInKm ? 1000.0 : 149597870700.0;
    double xM = xEcl * scale;
    double yM = yEcl * scale;
    double zM = zEcl * scale;

    // 2. Obliquité de l'Écliptique (J2000 / IAU 2006)
    double eps = 23.4392911 * DEG2RAD;
    double xEq = xM;
    double yEq = yM * std::cos(eps) - zM * std::sin(eps);
    double zEq = yM * std::sin(eps) + zM * std::cos(eps);

    double rDist = std::sqrt(xEq * xEq + yEq * yEq + zEq * zEq);
    result->distUA = isLuneInKm ? (rDist / 149597870700.0) : std::sqrt(xEcl*xEcl + yEcl*yEcl + zEcl*zEcl);

    // Ascension droite et Déclinaison Vraie
    result->raDeg = std::fmod(std::atan2(yEq, xEq) * RAD2DEG + 360.0, 360.0);
    result->decDeg = std::asin(zEq / rDist) * RAD2DEG;

    // 3. Transformation ITRS / ECEF (Rotation de la Terre)
    double xECEF =  xEq * std::cos(eraRad) + yEq * std::sin(eraRad);
    double yECEF = -xEq * std::sin(eraRad) + yEq * std::cos(eraRad);
    double zECEF =  zEq;

    // 4. Position Geocentrique WGS84 de la station observateur
    double phi = latDeg * DEG2RAD;
    double lambda = lonDeg * DEG2RAD;
    double a = 6378137.0; // Demi-grand axe WGS84
    double f = 1.0 / 298.257223563;
    double e2 = f * (2.0 - f);

    double N = a / std::sqrt(1.0 - e2 * std::sin(phi) * std::sin(phi));
    double xObs = (N + altM) * std::cos(phi) * std::cos(lambda);
    double yObs = (N + altM) * std::cos(phi) * std::sin(lambda);
    double zObs = (N * (1.0 - e2) + altM) * std::sin(phi);

    // Vecteur relatif Topocentrique (Même repère)
    double dx = xECEF - xObs;
    double dy = yECEF - yObs;
    double dz = zECEF - zObs;

    // 5. Matrice de passage ECEF -> ENU (East, North, Up)
    double E = -std::sin(lambda) * dx + std::cos(lambda) * dy;
    double N_top = -std::sin(phi) * std::cos(lambda) * dx - std::sin(phi) * std::sin(lambda) * dy + std::cos(phi) * dz;
    double U =  std::cos(phi) * std::cos(lambda) * dx + std::cos(phi) * std::sin(lambda) * dy + std::sin(phi) * dz;

    // Azimut et Élévation géométrique
    result->azim = std::fmod(std::atan2(E, N_top) * RAD2DEG + 360.0, 360.0);
    double rhoHorizontal = std::sqrt(E * E + N_top * N_top);
    result->elevGeom = std::atan2(U, rhoHorizontal) * RAD2DEG;

    // 6. Réfraction Atmosphérique de Bennett avec correction Pression / Température
    if (result->elevGeom > -2.0) {
        double elRad = result->elevGeom * DEG2RAD;
        double refArcMin = 1.02 / std::tan((result->elevGeom + 10.3 / (result->elevGeom + 5.1)) * DEG2RAD);
        double corMeteo = (presHpa / 1013.25) * (288.15 / (273.15 + tempC));
        result->elevRefractee = result->elevGeom + (refArcMin * corMeteo) / 60.0;
    } else {
        result->elevRefractee = result->elevGeom;
    }

    // 7. Calcul rigoureux de l'Angle Horaire (HA) pour Lever / Coucher
    // h0 standard pour le Soleil = -0.8333°, Planètes = -0.5667°
    double h0 = -0.8333 * DEG2RAD;
    double decRad = result->decDeg * DEG2RAD;
    
    double cosHA = (std::sin(h0) - std::sin(phi) * std::sin(decRad)) / (std::cos(phi) * std::cos(decRad));

    if (cosHA >= 1.0) {
        result->leverUT = -1.0;  // Toujours sous l'horizon (Nuit polaire)
        result->coucherUT = -1.0;
    } else if (cosHA <= -1.0) {
        result->leverUT = -2.0;  // Toujours au-dessus (Jour polaire / Circumpolaire)
        result->coucherUT = -2.0;
    } else {
        double haDeg = std::acos(cosHA) * RAD2DEG;
        double transitUT = (15.0 - (result->raDeg - (eraRad * RAD2DEG))) / 15.0;
        transitUT = std::fmod(transitUT + 24.0, 24.0);

        result->leverUT = std::fmod(transitUT - (haDeg / 15.0) + 24.0, 24.0);
        result->coucherUT = std::fmod(transitUT + (haDeg / 15.0) + 24.0, 24.0);
    }

    // 8. Algorithme de Visibilité (Style Timeanddate)
    if (result->elevRefractee < 0.0) {
        result->visibiliteCode = 0; // Sous l'horizon
    } else {
        // Extinction atmosphérique simplifiée
        double k = 0.2;
        double magEff = magApparente + (k / std::sin(std::max(1.0, result->elevRefractee) * DEG2RAD));

        if (magEff <= 5.5) result->visibiliteCode = 1;      // Visibilité Excellente (Œil nu)
        else if (magEff <= 9.5) result->visibiliteCode = 2; // Jumelles requises
        else result->visibiliteCode = 3;                    // Télescope requis
    }
}

}
