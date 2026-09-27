#include <emscripten/emscripten.h>
#include <cmath>
#include <algorithm>
#include <cstdint>

#ifndef M_PI
#define M_PI 3.14159265358979323846
#endif

#define DEG2RAD (M_PI / 180.0)
#define RAD2DEG (180.0 / M_PI)
#define VITESSE_LUMIERE_M_S 299792458.0
#define UA_EN_METRES 149597870700.0

// Alignement mémoire strict sur blocs de 8 octets pour les doubles, suivis des int32
struct alignas(8) AstroResult {
    double azim;               // offset  0 (HEAPF64[off + 0])
    double elevGeom;           // offset  8 (HEAPF64[off + 1])
    double elevRefractee;      // offset 16 (HEAPF64[off + 2])
    double raDeg;              // offset 24 (HEAPF64[off + 3])
    double decDeg;             // offset 32 (HEAPF64[off + 4])
    double distUA;             // offset 40 (HEAPF64[off + 5])
    double leverUT;            // offset 48 (HEAPF64[off + 6])
    double coucherUT;          // offset 56 (HEAPF64[off + 7])
    double airMass;            // offset 64 (HEAPF64[off + 8])
    double irradiance;         // offset 72 (HEAPF64[off + 9])
    double deltaT;             // offset 80 (HEAPF64[off + 10])
    double ghaDeg;             // offset 88 (HEAPF64[off + 11])
    double jde;                // offset 96 (HEAPF64[off + 12])
    double magnitudeApparente; // offset 104 (HEAPF64[off + 13])
    double shadowLength;       // offset 112 (HEAPF64[off + 14])
    double moonPhasePct;       // offset 120 (HEAPF64[off + 15])
    double moonAgeDays;        // offset 128 (HEAPF64[off + 16])
    int32_t visibiliteCode;    // offset 136 (HEAP32[136 / 4])
    int32_t seasonCode;        // offset 140 (HEAP32[140 / 4])
    int32_t padding;           // offset 144 (remplissage pour alignement 8 octets)
};

extern "C" {

EMSCRIPTEN_KEEPALIVE
double normaliserDegres(double deg) {
    double res = std::fmod(deg, 360.0);
    return res < 0.0 ? res + 360.0 : res;
}

EMSCRIPTEN_KEEPALIVE
void calculerParametresSiderauxEtSolaires(double timestampSec, double lonDeg, double* metricsPtr) {
    if (!metricsPtr) return;

    double jd = (timestampSec / 86400.0) + 2440587.5;
    double T = (jd - 2451545.0) / 36525.0;

    // Obliquité moyenne de l'écliptique (IAU 2006)
    double eps0Arcsec = 84381.448 - 46.8150 * T - 0.00059 * T * T + 0.001813 * T * T * T;
    double obliquiteDeg = eps0Arcsec / 3600.0;

    // Angle de Rotation Terrestre (ERA / IAU 2000)
    double du = jd - 2451545.0;
    double eraRad = 2.0 * M_PI * (0.7790572732640 + 1.00273781191135448 * du);
    double eraDeg = normaliserDegres(eraRad * RAD2DEG);

    // Temps Sidéral Apparent de Greenwich (GAST IAU 2006)
    double gastDeg = normaliserDegres(eraDeg + (0.00264 * std::sin((125.04 - 1934.136 * T) * DEG2RAD)));
    double lstDeg = normaliserDegres(gastDeg + lonDeg);

    // Longitude solaire vraie
    double l0 = normaliserDegres(280.46646 + 36000.76983 * T);
    double m = normaliserDegres(357.52911 + 35999.05029 * T);
    double c = (1.914602 - 0.004817 * T) * std::sin(m * DEG2RAD) + (0.019993 - 0.000101 * T) * std::sin(2.0 * m * DEG2RAD);
    double sunTrueLong = normaliserDegres(l0 + c);

    // Équation du temps
    double y = std::tan((obliquiteDeg / 2.0) * DEG2RAD);
    y *= y;
    double l0Rad = l0 * DEG2RAD;
    double mRad = m * DEG2RAD;
    double eqTempsRad = y * std::sin(2.0 * l0Rad) - 2.0 * 0.016708634 * std::sin(mRad) + 4.0 * 0.016708634 * y * std::sin(mRad) * std::cos(2.0 * l0Rad) - 0.5 * y * y * std::sin(4.0 * l0Rad);
    double eqTempsMin = (eqTempsRad * RAD2DEG) * 4.0;

    metricsPtr[0] = eqTempsMin;
    metricsPtr[1] = obliquiteDeg;
    metricsPtr[2] = sunTrueLong;
    metricsPtr[3] = gastDeg;
    metricsPtr[4] = lstDeg;
}

EMSCRIPTEN_KEEPALIVE
void calculerDepuisECEF(
    double xECEF, double yECEF, double zECEF,
    double latDeg, double lonDeg, double altM,
    double eraRad, double timestampUtc,
    double tempC, double presHpa, double extinctionCoeff,
    double magBruteAstre,
    bool estVecteurTopocentrique,
    AstroResult* result
) {
    if (!result) return;

    double phi = latDeg * DEG2RAD;
    double lambda = lonDeg * DEG2RAD;
    
    // Ellipsoïde WGS-84
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

    // Conversion ECEF -> ENU (East, North, Up)
    double E = -std::sin(lambda) * dx + std::cos(lambda) * dy;
    double N_top = -std::sin(phi) * std::cos(lambda) * dx - std::sin(phi) * std::sin(lambda) * dy + std::cos(phi) * dz;
    double U =  std::cos(phi) * std::cos(lambda) * dx + std::cos(phi) * std::sin(lambda) * dy + std::sin(phi) * dz;

    double distM = std::sqrt(dx * dx + dy * dy + dz * dz);
    result->distUA = distM / UA_EN_METRES;

    result->azim = normaliserDegres(std::atan2(E, N_top) * RAD2DEG);
    double rhoHorizontal = std::sqrt(E * E + N_top * N_top);
    result->elevGeom = std::atan2(U, rhoHorizontal) * RAD2DEG;

    // Refraction atmospherique dynamique (Formule de Bennett corrigee P/T)
    if (result->elevGeom > -2.0) {
        double h = std::max(result->elevGeom, -1.0);
        double refArcMin = 1.02 / std::tan((h + 10.3 / (h + 5.1)) * DEG2RAD);
        double facteurMeteoBaro = (presHpa / 1013.25) * (288.15 / (273.15 + tempC));
        result->elevRefractee = result->elevGeom + (refArcMin * facteurMeteoBaro) / 60.0;
    } else {
        result->elevRefractee = result->elevGeom;
    }

    // Masse d'air (Pickering 2002)
    if (result->elevRefractee > 0.0) {
        double sinH = std::sin(std::max(0.01, result->elevRefractee) * DEG2RAD);
        result->airMass = 1.0 / (sinH + 0.025 * std::exp(-11.0 * sinH));
    } else {
        result->airMass = 40.0;
    }

    result->magnitudeApparente = magBruteAstre + (extinctionCoeff * result->airMass);
    result->irradiance = (result->elevRefractee > 0.0) ? 1361.0 * std::pow(0.7, result->airMass) / (result->distUA * result->distUA) : 0.0;
    result->shadowLength = (result->elevRefractee > 0.0) ? 1.0 / std::tan(std::max(1e-4, result->elevRefractee * DEG2RAD)) : -1.0;

    double lonTerrestreDeg = std::atan2(yECEF, xECEF) * RAD2DEG;
    result->raDeg = normaliserDegres(lonTerrestreDeg + (eraRad * RAD2DEG));
    double normR = std::sqrt(xECEF * xECEF + yECEF * yECEF + zECEF * zECEF);
    result->decDeg = (normR > 0.0) ? std::asin(zECEF / normR) * RAD2DEG : 0.0;
    result->ghaDeg = normaliserDegres((eraRad * RAD2DEG) - result->raDeg);

    // Calcul exact du lever et coucher de soleil
    double decRad = result->decDeg * DEG2RAD;
    double cosH0 = -std::tan(phi) * std::tan(decRad);
    double solarNoonUT = normaliserDegres(12.0 - (lonDeg * 4.0)) / 15.0;

    if (cosH0 < -1.0) {
        result->leverUT = 0.0; // Nuit polaire
        result->coucherUT = 24.0;
    } else if (cosH0 > 1.0) {
        result->leverUT = 0.0; // Jour polaire
        result->coucherUT = 24.0;
    } else {
        double h0Deg = std::acos(cosH0) * RAD2DEG;
        double demiArcJour = h0Deg / 15.0;
        result->leverUT = normaliserDegres((solarNoonUT - demiArcJour) * 15.0) / 15.0;
        result->coucherUT = normaliserDegres((solarNoonUT + demiArcJour) * 15.0) / 15.0;
    }

    double jd = (timestampUtc / 86400.0) + 2440587.5;
    result->jde = jd;
    double tCenturies = (jd - 2451545.0) / 36525.0;
    result->deltaT = 64.6 + 31.5 * tCenturies + 65.5 * tCenturies * tCenturies;

    result->moonPhasePct = 0.0;
    result->moonAgeDays = 0.0;
    result->seasonCode = 0;
    result->visibiliteCode = (result->elevRefractee < 0.0) ? 0 : (result->magnitudeApparente <= 5.5 ? 1 : 2);
}

}
