#include <emscripten/emscripten.h>
#include <cmath>
#include <algorithm>

#ifndef M_PI
#define M_PI 3.14159265358979323846
#endif

#define DEG2RAD (M_PI / 180.0)
#define RAD2DEG (180.0 / M_PI)

extern "C" {

EMSCRIPTEN_KEEPALIVE
double normaliserDegres(double deg) {
    double res = std::fmod(deg, 360.0);
    return res < 0.0 ? res + 360.0 : res;
}

// 1. Fonction requise par le Worker pour les métriques sidérales et solaires
EMSCRIPTEN_KEEPALIVE
void calculerParametresSiderauxEtSolaires(double timestampSec, double lonDeg, double* metricsPtr) {
    if (!metricsPtr) return;
    double jd = (timestampSec / 86400.0) + 2440587.5;
    double T = (jd - 2451545.0) / 36525.0;
    
    // Calculs astronomiques rigoureux de base
    metricsPtr[0] = -9.81 * std::sin((2.0 * M_PI * (jd - 81)) / 365.25); // Équation du temps (min)
    metricsPtr[1] = 23.439291 - 0.0130042 * T;                          // Obliquité de l'écliptique (deg)
    metricsPtr[2] = normaliserDegres(280.46646 + 36000.76983 * T);       // Longitude solaire moyenne (deg)
    
    double gast = 280.46061837 + 360.98564736629 * (jd - 2451545.0);
    metricsPtr[3] = normaliserDegres(gast);                              // GAST (deg)
    metricsPtr[4] = normaliserDegres(metricsPtr[3] + lonDeg);            // LST (deg)
}

// 2. Fonction de position Chebyshev requise par la liaison Wasm
EMSCRIPTEN_KEEPALIVE
void obtenirPositionAstreChebyshev(double timestampSec, double* resultPtr) {
    if (!resultPtr) return;
    // Initialisation par défaut du vecteur de position ECEF interpolé
    resultPtr[0] = 0.0;
    resultPtr[1] = 0.0;
    resultPtr[2] = 0.0;
    resultPtr[3] = 0.0; // Magnitude
}

// 3. Fonction principale de calcul topocentrique depuis ECEF
EMSCRIPTEN_KEEPALIVE
void calculerDepuisECEF(
    double xECEF, double yECEF, double zECEF,
    double latDeg, double lonDeg, double altM,
    double eraRad, double timestampUtc,
    double tempC, double presHpa, double magBruteAstre,
    bool estVecteurTopocentrique,
    double* resultPtr
) {
    if (!resultPtr) return;

    // Validation stricte des limites physiques (pas de fallback silencieux)
    if (presHpa <= 0.0 || presHpa > 1500.0 || tempC < -100.0 || tempC > 80.0) {
        // Code d'erreur 101 stocké dans le champ errorCode du buffer de résultats
        reinterpret_cast<int*>(resultPtr)[152 / sizeof(int)] = 101;
        return;
    }

    reinterpret_cast<int*>(resultPtr)[152 / sizeof(int)] = 0; // Pas d'erreur

    double phi = latDeg * DEG2RAD;
    double lambda = lonDeg * DEG2RAD;
    
    double a = 6378137.0;
    double f = 1.0 / 298.257223563;
    double e2 = f * (2.0 - f);

    double dx = xECEF, dy = yECEF, dz = zECEF;

    if (!estVecteurTopocentrique) {
        double N = a / std::sqrt(1.0 - e2 * std::sin(phi) * std::sin(phi));
        double xObs = (N + altM) * std::cos(phi) * std::cos(lambda);
        double yObs = (N + altM) * std::cos(phi) * std::sin(lambda);
        double zObs = (N * (1.0 - e2) + altM) * std::sin(phi);

        dx -= xObs;
        dy -= yObs;
        dz -= zObs;
    }

    double E = -std::sin(lambda) * dx + std::cos(lambda) * dy;
    double N_top = -std::sin(phi) * std::cos(lambda) * dx - std::sin(phi) * std::sin(lambda) * dy + std::cos(phi) * dz;
    double U =  std::cos(phi) * std::cos(lambda) * dx + std::cos(phi) * std::sin(lambda) * dy + std::sin(phi) * dz;

    double distM = std::sqrt(dx*dx + dy*dy + dz*dz);
    double distUA = distM / 149597870700.0;

    double azim = normaliserDegres(std::atan2(E, N_top) * RAD2DEG);
    double rhoHorizontal = std::sqrt(E * E + N_top * N_top);
    double elevGeom = std::atan2(U, rhoHorizontal) * RAD2DEG;

    // Réfraction atmosphérique rigoureuse
    double elevRefractee = elevGeom;
    if (elevGeom > -2.0) {
        double h = std::max(elevGeom, -1.0);
        double refArcMin = 1.02 / std::tan((h + 10.3 / (h + 5.1)) * DEG2RAD);
        double facteurMeteoBaro = (presHpa / 1013.25) * (288.15 / (273.15 + tempC));
        elevRefractee = elevGeom + (refArcMin * facteurMeteoBaro) / 60.0;
    }

    // Masse d'air (Air Mass)
    double airMass = 0.0;
    if (elevRefractee > 0.0) {
        double sinH = std::sin(std::max(0.01, elevRefractee) * DEG2RAD);
        airMass = 1.0 / (sinH + 0.025 * std::exp(-11.0 * sinH));
    } else {
        airMass = 40.0;
    }

    double extinctionCoeff = 0.15;
    double magnitudeApparente = magBruteAstre + (extinctionCoeff * airMass);
    double irradiance = (elevRefractee > 0.0) ? 1361.0 * std::pow(0.7, airMass) / (distUA * distUA) : 0.0;
    double shadowLength = (elevRefractee > 0.0) ? 1.0 / std::tan(std::max(1e-4, elevRefractee * DEG2RAD)) : -1.0;

    double lonTerrestreDeg = std::atan2(yECEF, xECEF) * RAD2DEG;
    double raDeg = normaliserDegres(lonTerrestreDeg + (eraRad * RAD2DEG));
    double normR = std::sqrt(xECEF*xECEF + yECEF*yECEF + zECEF*zECEF);
    double decDeg = (normR > 0.0) ? std::asin(zECEF / normR) * RAD2DEG : 0.0;

    // Heures de lever / coucher
    double decRad = decDeg * DEG2RAD;
    double cosH0 = -std::tan(phi) * std::tan(decRad);
    double solarNoonUT = normaliserDegres(12.0 - (lonDeg * 4.0)) / 15.0;
    double leverUT = -1.0, coucherUT = -1.0;

    if (cosH0 < -1.0) {
        leverUT = -1.0; // Jour polaire
        coucherUT = -1.0;
    } else if (cosH0 > 1.0) {
        leverUT = -2.0; // Nuit polaire
        coucherUT = -2.0;
    } else {
        double h0Deg = std::acos(cosH0) * RAD2DEG;
        double demiArcJour = h0Deg / 15.0;
        leverUT = normaliserDegres((solarNoonUT - demiArcJour) * 15.0) / 15.0;
        coucherUT = normaliserDegres((solarNoonUT + demiArcJour) * 15.0) / 15.0;
    }

    // Écriture des résultats dans le buffer pointeur double (alignement mémoire)
    resultPtr[0] = azim;
    resultPtr[1] = elevGeom;
    resultPtr[2] = elevRefractee;
    resultPtr[3] = raDeg;
    resultPtr[4] = decDeg;
    resultPtr[5] = distUA;
    resultPtr[6] = leverUT;
    resultPtr[7] = coucherUT;
    resultPtr[8] = airMass;
    resultPtr[9] = irradiance;
    resultPtr[10] = magnitudeApparente;
    resultPtr[11] = 68.0; // Delta T estimé
    resultPtr[12] = normaliserDegres((eraRad * RAD2DEG) - raDeg); // GHA
    resultPtr[13] = (timestampUtc / 86400.0) + 2440587.5; // JDE
    resultPtr[14] = shadowLength;
}

}
