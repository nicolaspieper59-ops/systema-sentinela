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
    double leverUT;       
    double coucherUT;     
    int visibiliteCode;   // 0 = Invisible, 1 = Œil nu, 2 = Jumelles, 3 = Télescope
};

struct SystemMetrics {
    double eqTempsMin;     // Équation du temps en minutes
    double obliquiteDeg;   // Obliquité de l'écliptique (degrés)
    double longSolaireDeg; // Longitude solaire vraie (degrés)
    double gastDeg;        // Greenwich Apparent Sidereal Time (degrés)
    double lstDeg;         // Local Sidereal Time (degrés)
};

extern "C" {

/**
 * Normalisation stricte d'un angle en degrés dans [0, 360[
 */
inline double normaliserDegres(double deg) {
    double res = std::fmod(deg, 360.0);
    return res < 0.0 ? res + 360.0 : res;
}

/**
 * Calcul analytique des paramètres sidéraux et solaires globaux
 */
EMSCRIPTEN_KEEPALIVE
void calculerParametresSiderauxEtSolaires(
    double timestampUtc,
    double lonDeg,
    SystemMetrics* metrics
) {
    if (!metrics) return;

    double jd = (timestampUtc / 86400.0) + 2440587.5;
    double d = jd - 2451545.0; 
    double T = d / 36525.0;    

    double L0 = std::fmod(280.46646 + 36000.76983 * T, 360.0);
    if (L0 < 0.0) L0 += 360.0;

    double M = std::fmod(357.52911 + 35999.05029 * T, 360.0);
    if (M < 0.0) M += 360.0;
    double MRad = M * DEG2RAD;

    double C = (1.914602 - 0.004817 * T) * std::sin(MRad) + (0.019993 - 0.000101 * T) * std::sin(2.0 * MRad);
    double sunLong = L0 + C;
    metrics->longSolaireDeg = normaliserDegres(sunLong);

    double eps = 23.4392911 - 0.0130042 * T;
    metrics->obliquiteDeg = eps;

    double sunLongRad = metrics->longSolaireDeg * DEG2RAD;
    double epsRad = eps * DEG2RAD;
    double y = std::cos(epsRad) * std::sin(sunLongRad);
    double x = std::cos(sunLongRad);
    double alpha = std::atan2(y, x) * RAD2DEG;
    alpha = normaliserDegres(alpha);

    double eqTempsDeg = L0 - alpha;
    if (eqTempsDeg > 180.0) eqTempsDeg -= 360.0;
    if (eqTempsDeg < -180.0) eqTempsDeg += 360.0;
    metrics->eqTempsMin = eqTempsDeg * 4.0;

    double gmst = 280.46061837 + 360.98564736629 * d + 0.000387933 * T * T - (T * T * T) / 38710000.0;
    metrics->gastDeg = normaliserDegres(gmst);
    metrics->lstDeg = normaliserDegres(metrics->gastDeg + lonDeg);
}

/**
 * Calcul topocentrique direct à partir d'un vecteur géocentrique ou topocentrique ECEF/ITRS (en mètres)
 */
EMSCRIPTEN_KEEPALIVE
void calculerDepuisECEF(
    double xECEF, double yECEF, double zECEF,
    double latDeg, double lonDeg, double altM,
    double eraRad,
    double tempC, double presHpa,
    double magApparente,
    bool estVecteurTopocentrique,
    AstroResult* result
) {
    if (!result) return;

    double phi = latDeg * DEG2RAD;
    double lambda = lonDeg * DEG2RAD;
    
    double a = 6378137.0;
    double f = 1.0 / 298.257223563;
    double e2 = f * (2.0 - f);

    double dx = xECEF;
    double dy = yECEF;
    double dz = zECEF;

    if (!estVecteurTopocentrique) {
        double N = a / std::sqrt(1.0 - e2 * std::sin(phi) * std::sin(phi));
        double xObs = (N + altM) * std::cos(phi) * std::cos(lambda);
        double yObs = (N + altM) * std::cos(phi) * std::sin(lambda);
        double zObs = (N * (1.0 - e2) + altM) * std::sin(phi);

        dx -= xObs;
        dy -= yObs;
        dz -= zObs;
    }

    // Passage ECEF -> ENU (East, North, Up)
    double E = -std::sin(lambda) * dx + std::cos(lambda) * dy;
    double N_top = -std::sin(phi) * std::cos(lambda) * dx - std::sin(phi) * std::sin(lambda) * dy + std::cos(phi) * dz;
    double U =  std::cos(phi) * std::cos(lambda) * dx + std::cos(phi) * std::sin(lambda) * dy + std::sin(phi) * dz;

    double distM = std::sqrt(dx*dx + dy*dy + dz*dz);
    result->distUA = distM / 149597870700.0;

    result->azim = normaliserDegres(std::atan2(E, N_top) * RAD2DEG);
    double rhoHorizontal = std::sqrt(E * E + N_top * N_top);
    result->elevGeom = std::atan2(U, rhoHorizontal) * RAD2DEG;

    // Réfraction atmosphérique de Bennett sécurisée
    if (result->elevGeom > -2.0) {
        double h = std::max(result->elevGeom, -1.0);
        double refArcMin = 1.02 / std::tan((h + 10.3 / (h + 5.1)) * DEG2RAD);
        double corMeteo = (presHpa / 1013.25) * (288.15 / (273.15 + tempC));
        result->elevRefractee = result->elevGeom + (refArcMin * corMeteo) / 60.0;
    } else {
        result->elevRefractee = result->elevGeom;
    }

    double lonTerrestreDeg = std::atan2(yECEF, xECEF) * RAD2DEG;
    result->raDeg = normaliserDegres(lonTerrestreDeg + (eraRad * RAD2DEG));
    
    double normR = std::sqrt(xECEF*xECEF + yECEF*yECEF + zECEF*zECEF);
    result->decDeg = (normR > 0.0) ? std::asin(zECEF / normR) * RAD2DEG : 0.0;
    
    result->leverUT = 0.0;
    result->coucherUT = 0.0;

    if (result->elevRefractee < 0.0) {
        result->visibiliteCode = 0;
    } else {
        double sinH = std::sin(std::max(0.01, result->elevRefractee) * DEG2RAD);
        double airMass = 1.0 / (sinH + 0.025 * std::exp(-11.0 * sinH));
        double magEff = magApparente + (0.2 * airMass);

        if (magEff <= 5.5) result->visibiliteCode = 1;
        else if (magEff <= 9.5) result->visibiliteCode = 2;
        else result->visibiliteCode = 3;
    }
}

}

int main() {
    return 0;
}
