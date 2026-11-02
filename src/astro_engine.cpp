#include <emscripten/emscripten.h>
#include <cmath>
#include <algorithm>
#include <cstdint>
#include <cstring>

extern "C" {
#include "sofa.h"
#include "sofam.h"
}

#ifndef M_PI
#define M_PI 3.14159265358979323846
#endif

#define DEG2RAD (M_PI / 180.0)
#define RAD2DEG (180.0 / M_PI)
#define UA_EN_METRES 149597870700.0
#define RAYON_SOLEIL_KM 696340.0

struct alignas(8) AstroResult {
    double azim;                  // 0
    double elevGeom;              // 1
    double elevRefractee;         // 2
    double raDeg;                 // 3
    double decDeg;                // 4
    double distUA;                // 5
    double leverUT;               // 6
    double coucherUT;             // 7
    double airMass;               // 8
    double irradiance;            // 9
    double deltaT;                // 10
    double ghaDeg;                // 11
    double jde;                   // 12
    double magnitudeApparente;    // 13
    double shadowLength;          // 14
    double moonPhasePct;          // 15
    double moonAgeDays;           // 16
    double crepusculeUT;          // 17
    double dureeJourHeures;       // 18
    double angularDiamArcsec;     // 19
    double surfaceBrightness;     // 20
    double illuminatedFraction;   // 21
    double radialVelocityKmS;     // 22
    int32_t visibiliteCode;       // Byte offset 184
    int32_t seasonCode;           // Byte offset 188
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

    double dj1 = 2440587.5;
    double dj2 = timestampSec / 86400.0;

    double epsA = iauObl06(dj1, dj2);
    double obliquiteDeg = epsA * RAD2DEG;

    double gastRad = iauGst06a(dj1, dj2, dj1, dj2);
    double gastDeg = normaliserDegres(gastRad * RAD2DEG);
    double lstDeg = normaliserDegres(gastDeg + lonDeg);

    double T = (dj1 + dj2 - 2451545.0) / 36525.0;
    double l0 = normaliserDegres(280.46646 + 36000.76983 * T);
    double m = normaliserDegres(357.52911 + 35999.05029 * T);
    double c = (1.914602 - 0.004817 * T) * std::sin(m * DEG2RAD) 
             + (0.019993 - 0.000101 * T) * std::sin(2.0 * m * DEG2RAD)
             + 0.000289 * std::sin(3.0 * m * DEG2RAD);
    double sunTrueLong = normaliserDegres(l0 + c);

    // Calcul trigonométrique sphérique direct (Sans dépendance ERFA externe)
    double lRad = sunTrueLong * DEG2RAD;
    double sinL = std::sin(lRad);
    double cosL = std::cos(lRad);
    double cosEps = std::cos(epsA);
    double sinEps = std::sin(epsA);

    double raSunRad = std::atan2(cosEps * sinL, cosL);
    double raSunDeg = normaliserDegres(raSunRad * RAD2DEG);

    double eqTempsMin = (l0 - raSunDeg) * 4.0;
    if (eqTempsMin > 20.0) eqTempsMin -= 1440.0;
    if (eqTempsMin < -20.0) eqTempsMin += 1440.0;

    metricsPtr[0] = eqTempsMin;
    metricsPtr[1] = obliquiteDeg;
    metricsPtr[2] = sunTrueLong;
    metricsPtr[3] = gastDeg;
    metricsPtr[4] = lstDeg;
}

EMSCRIPTEN_KEEPALIVE
void calculerDepuisECEF(
    double xICRF_km, double yICRF_km, double zICRF_km,
    double vx_km_s, double vy_km_s, double vz_km_s,
    double latDeg, double lonDeg, double altM,
    double eraRad, double tempC, double presHpa, double extinctionCoeff,
    double magBruteAstre, int32_t estSoleil,
    AstroResult* result
) {
    if (!result) return;
    std::memset(result, 0, sizeof(AstroResult));

    double p[3] = {xICRF_km, yICRF_km, zICRF_km};
    double v[3] = {vx_km_s / 299792.458, vy_km_s / 299792.458, vz_km_s / 299792.458};
    double pabar[3];
    iauAb(p, v, 0.0, 0.0, pabar);

    double xI = pabar[0] * 1000.0;
    double yI = pabar[1] * 1000.0;
    double zI = pabar[2] * 1000.0;

    double normICRF = std::sqrt(xI * xI + yI * yI + zI * zI);
    result->raDeg = normaliserDegres(std::atan2(yI, xI) * RAD2DEG);
    result->decDeg = (normICRF > 0.0) ? std::asin(std::fmax(-1.0, std::min(1.0, zI / normICRF))) * RAD2DEG : 0.0;
    result->ghaDeg = normaliserDegres((eraRad * RAD2DEG) - result->raDeg);

    double cosERA = std::cos(eraRad);
    double sinERA = std::sin(eraRad);
    double xECEF =  xI * cosERA + yI * sinERA;
    double yECEF = -xI * sinERA + yI * cosERA;
    double zECEF =  zI;

    double phi = latDeg * DEG2RAD;
    double lambda = lonDeg * DEG2RAD;
    double a = 6378137.0;
    double f = 1.0 / 298.257223563;
    double e2 = f * (2.0 - f);

    double N_obs = a / std::sqrt(1.0 - e2 * std::sin(phi) * std::sin(phi));
    double xObs = (N_obs + altM) * std::cos(phi) * std::cos(lambda);
    double yObs = (N_obs + altM) * std::cos(phi) * std::sin(lambda);
    double zObs = (N_obs * (1.0 - e2) + altM) * std::sin(phi);

    double dx = xECEF - xObs;
    double dy = yECEF - yObs;
    double dz = zECEF - zObs;

    double E = -std::sin(lambda) * dx + std::cos(lambda) * dy;
    double N_top = -std::sin(phi) * std::cos(lambda) * dx - std::sin(phi) * std::sin(lambda) * dy + std::cos(phi) * dz;
    double U = std::cos(phi) * std::cos(lambda) * dx + std::cos(phi) * std::sin(lambda) * dy + std::sin(phi) * dz;

    double distM = std::sqrt(dx * dx + dy * dy + dz * dz);
    result->distUA = distM / UA_EN_METRES;

    result->azim = normaliserDegres(std::atan2(E, N_top) * RAD2DEG);
    double rhoHorizontal = std::sqrt(E * E + N_top * N_top);
    result->elevGeom = std::atan2(U, rhoHorizontal) * RAD2DEG;

    if (result->distUA > 0.0) {
        double rayonAstreKm = estSoleil ? RAYON_SOLEIL_KM : 1737.4;
        result->angularDiamArcsec = (2.0 * std::asin((rayonAstreKm * 1000.0) / distM)) * RAD2DEG * 3600.0;
    }

    if (result->elevGeom > -5.0) {
        double refa, refb;
        iauRefco(presHpa, tempC, 50.0, 0.55, &refa, &refb);
        double zObsRad = (90.0 - result->elevGeom) * DEG2RAD;
        if (zObsRad > 0 && zObsRad < (M_PI / 2.0 + 0.1)) {
            double tanZ = std::tan(zObsRad);
            double deltaZRad = (refa * tanZ + refb * tanZ * tanZ * tanZ);
            result->elevRefractee = result->elevGeom + (deltaZRad * RAD2DEG);
        } else {
            result->elevRefractee = result->elevGeom;
        }
    } else {
        result->elevRefractee = result->elevGeom;
    }

    if (result->elevRefractee > 0.0) {
        double sinH = std::sin(result->elevRefractee * DEG2RAD);
        result->airMass = 1.0 / (sinH + 0.025 * std::exp(-11.0 * sinH));
    } else {
        result->airMass = -1.0; 
    }

    result->magnitudeApparente = magBruteAstre + (extinctionCoeff * std::fmax(0.0, result->airMass));
    
    if (estSoleil == 1) {
        result->irradiance = (result->elevRefractee > 0.0) ? (1361.0 / (result->distUA * result->distUA)) * std::pow(0.7, result->airMass) : 0.0;
        result->shadowLength = (result->elevRefractee > 0.0) ? 1.0 / std::tan(std::fmax(1e-4, result->elevRefractee * DEG2RAD)) : -1.0;

        double demiDiamDeg = (result->angularDiamArcsec / 3600.0) / 2.0;
        double altRef = (-0.5667 - demiDiamDeg) * DEG2RAD;
        double decRad = result->decDeg * DEG2RAD;
        double cosH0 = (std::sin(altRef) - std::sin(phi) * std::sin(decRad)) / (std::cos(phi) * std::cos(decRad));
        
        if (cosH0 >= 1.0) {
            result->dureeJourHeures = 0.0;
            result->leverUT = -1.0; 
            result->coucherUT = -1.0;
        } else if (cosH0 <= -1.0) {
            result->dureeJourHeures = 24.0;
            result->leverUT = 0.0; 
            result->coucherUT = 24.0;
        } else {
            double H0 = std::acos(cosH0) * RAD2DEG;
            result->dureeJourHeures = (2.0 * H0) / 15.0;
            double tsw = 12.0 - (lonDeg / 15.0);
            result->leverUT = normaliserDegres((tsw * 15.0 - H0)) / 15.0;
            result->coucherUT = normaliserDegres((tsw * 15.0 + H0)) / 15.0;
        }

        double cosH6 = (std::sin(-6.0 * DEG2RAD) - std::sin(phi) * std::sin(decRad)) / (std::cos(phi) * std::cos(decRad));
        if (cosH6 > -1.0 && cosH6 < 1.0) {
            double H6 = std::acos(cosH6) * RAD2DEG;
            double tsw = 12.0 - (lonDeg / 15.0);
            result->crepusculeUT = normaliserDegres((tsw * 15.0 + H6)) / 15.0;
        } else {
            result->crepusculeUT = -1.0;
        }
    } else {
        result->irradiance = 0.0;
        result->shadowLength = -1.0;
        result->leverUT = -1.0;
        result->coucherUT = -1.0;
        result->crepusculeUT = -1.0;
        result->dureeJourHeures = -1.0;
    }

    if (result->elevRefractee <= 0.0) {
        result->visibiliteCode = 0;
    } else if (result->magnitudeApparente <= 6.0) {
        result->visibiliteCode = 1;
    } else if (result->magnitudeApparente <= 10.0) {
        result->visibiliteCode = 2;
    } else {
        result->visibiliteCode = 3;
    }
}

}
