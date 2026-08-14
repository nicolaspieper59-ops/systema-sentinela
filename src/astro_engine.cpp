#include <emscripten/emscripten.h>
#include <cmath>
#include <cstring>

#ifndef M_PI
#define M_PI 3.14159265358979323846
#endif

#define DEG2RAD (M_PI / 180.0)
#define RAD2DEG (180.0 / M_PI)

struct AstroResult {
    double azim;          // Azimut en degrés (0° = Nord, 90° = Est)
    double elevGeom;      // Élévation géométrique (degrés)
    double elevRefractee; // Élévation avec réfraction atmosphérique (degrés)
    double raDeg;         // Ascension Droite (degrés)
    double decDeg;        // Déclinaison (degrés)
    double distUA;        // Distance (UA)
    double leverUT;       // Heure UTC lever (-1 si sous horizon, -2 si circumpolaire)
    double coucherUT;     // Heure UTC coucher
    int visibiliteCode;   // 0 = Invisible, 1 = Œil nu, 2 = Jumelles, 3 = Télescope
};

extern "C" {

/**
 * Calcul topocentrique direct à partir d'un vecteur ECEF/ITRS en mètres (ex: flux_live.json)
 */
EMSCRIPTEN_KEEPALIVE
void calculerDepuisECEF(
    double xECEF, double yECEF, double zECEF,
    double latDeg, double lonDeg, double altM,
    double tempC, double presHpa,
    double magApparente,
    AstroResult* result
) {
    double phi = latDeg * DEG2RAD;
    double lambda = lonDeg * DEG2RAD;
    double a = 6378137.0; // Demi-grand axe WGS84
    double f = 1.0 / 298.257223563;
    double e2 = f * (2.0 - f);

    double N = a / std::sqrt(1.0 - e2 * std::sin(phi) * std::sin(phi));
    double xObs = (N + altM) * std::cos(phi) * std::cos(lambda);
    double yObs = (N + altM) * std::cos(phi) * std::sin(lambda);
    double zObs = (N * (1.0 - e2) + altM) * std::sin(phi);

    // Vecteur relatif Topocentrique
    double dx = xECEF - xObs;
    double dy = yECEF - yObs;
    double dz = zECEF - zObs;

    // Passage ECEF -> ENU (East, North, Up)
    double E = -std::sin(lambda) * dx + std::cos(lambda) * dy;
    double N_top = -std::sin(phi) * std::cos(lambda) * dx - std::sin(phi) * std::sin(lambda) * dy + std::cos(phi) * dz;
    double U =  std::cos(phi) * std::cos(lambda) * dx + std::cos(phi) * std::sin(lambda) * dy + std::sin(phi) * dz;

    double distM = std::sqrt(dx*dx + dy*dy + dz*dz);
    result->distUA = distM / 149597870700.0;

    result->azim = std::fmod(std::atan2(E, N_top) * RAD2DEG + 360.0, 360.0);
    double rhoHorizontal = std::sqrt(E * E + N_top * N_top);
    result->elevGeom = std::atan2(U, rhoHorizontal) * RAD2DEG;

    // Réfraction Atmosphérique de Bennett
    if (result->elevGeom > -2.0) {
        double refArcMin = 1.02 / std::tan((result->elevGeom + 10.3 / (result->elevGeom + 5.1)) * DEG2RAD);
        double corMeteo = (presHpa / 1013.25) * (288.15 / (273.15 + tempC));
        result->elevRefractee = result->elevGeom + (refArcMin * corMeteo) / 60.0;
    } else {
        result->elevRefractee = result->elevGeom;
    }

    result->raDeg = std::fmod(std::atan2(yECEF, xECEF) * RAD2DEG + 360.0, 360.0);
    result->decDeg = std::asin(zECEF / std::sqrt(xECEF*xECEF + yECEF*yECEF + zECEF*zECEF)) * RAD2DEG;
    result->leverUT = 0.0;
    result->coucherUT = 0.0;

    if (result->elevRefractee < 0.0) {
        result->visibiliteCode = 0;
    } else {
        double k = 0.2;
        double magEff = magApparente + (k / std::sin(std::max(1.0, result->elevRefractee) * DEG2RAD));
        if (magEff <= 5.5) result->visibiliteCode = 1;
        else if (magEff <= 9.5) result->visibiliteCode = 2;
        else result->visibiliteCode = 3;
    }
}

/**
 * Calcul complet Écliptique J2000 -> Topocentrique
 */
EMSCRIPTEN_KEEPALIVE
void calculerPositionTopocentrique(
    double xEcl, double yEcl, double zEcl,
    double latDeg, double lonDeg, double altM,
    double eraRad,
    double tempC, double presHpa,
    double magApparente,
    bool isLuneInKm,
    AstroResult* result
) {
    double scale = isLuneInKm ? 1000.0 : 149597870700.0;
    double xM = xEcl * scale;
    double yM = yEcl * scale;
    double zM = zEcl * scale;

    double eps = 23.4392911 * DEG2RAD;
    double xEq = xM;
    double yEq = yM * std::cos(eps) - zM * std::sin(eps);
    double zEq = yM * std::sin(eps) + zM * std::cos(eps);

    double xECEF =  xEq * std::cos(eraRad) + yEq * std::sin(eraRad);
    double yECEF = -xEq * std::sin(eraRad) + yEq * std::cos(eraRad);
    double zECEF =  zEq;

    calculerDepuisECEF(xECEF, yECEF, zECEF, latDeg, lonDeg, altM, tempC, presHpa, magApparente, result);
}

}
