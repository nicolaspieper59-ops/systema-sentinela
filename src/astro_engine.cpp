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
#define VITESSE_LUMIERE_KM_S 299792.458
#define RAYON_SOLEIL_KM 696340.0
#define RAYON_TERRE_KM 6378.137

struct alignas(8) AstroResult {
    double azim;
    double elevGeom;
    double elevRefractee;
    double raDeg;
    double decDeg;
    double distUA;
    double leverUT;
    double coucherUT;
    double airMass;
    double irradiance;
    double deltaT;
    double ghaDeg;
    double jde;
    double magnitudeApparente;
    double shadowLength;
    double moonPhasePct;
    double astreAgeDays;
    double crepusculeUT;
    double dureeVisibiliteHeures;
    double angularDiamArcsec;
    double surfaceBrightness;
    double illuminatedFraction;
    double radialVelocityKmS;
    double occultationPct;
    double skyGlowMagArcsec2;
    double astreMeanTimeHours;
    double astreTrueTimeHours;
    double astreEqTempsMin;
    int32_t visibiliteCode;
    int32_t occultationCode;
    int32_t glowTypeCode;
    int32_t padding;
};

inline double calculerFractionRecouvrementDisques(double d, double r1, double r2) {
    if (d >= r1 + r2) return 0.0;
    if (d <= std::abs(r1 - r2)) {
        double rMin = std::min(r1, r2);
        return (rMin * rMin) / (r1 * r1);
    }
    double r1_2 = r1 * r1;
    double r2_2 = r2 * r2;
    double d_2  = d * d;

    double alpha = std::acos(std::fmax(-1.0, std::fmin(1.0, (d_2 + r1_2 - r2_2) / (2.0 * d * r1))));
    double beta  = std::acos(std::fmax(-1.0, std::fmin(1.0, (d_2 + r2_2 - r1_2) / (2.0 * d * r2))));

    double aireIntersection = r1_2 * alpha + r2_2 * beta 
                            - 0.5 * std::sqrt(std::fmax(0.0, (-d + r1 + r2) * (d + r1 - r2) * (d - r1 + r2) * (d + r1 + r2)));
    double aireCible = M_PI * r1_2;
    return std::fmax(0.0, std::fmin(1.0, aireIntersection / aireCible));
}

inline double separationAngulaireArcsec(double ra1Deg, double dec1Deg, double ra2Deg, double dec2Deg) {
    double a1 = ra1Deg * DEG2RAD, d1 = dec1Deg * DEG2RAD;
    double a2 = ra2Deg * DEG2RAD, d2 = dec2Deg * DEG2RAD;
    double cosSep = std::sin(d1) * std::sin(d2) + std::cos(d1) * std::cos(d2) * std::cos(a1 - a2);
    cosSep = std::fmax(-1.0, std::fmin(1.0, cosSep));
    return std::acos(cosSep) * RAD2DEG * 3600.0;
}

inline double obtenirElevationHorizonTopographique(double azimDeg) {
    double az = std::fmod(azimDeg, 360.0);
    if (az < 0.0) az += 360.0;
    if (az >= 0.0 && az < 45.0)    return 1.2;
    if (az >= 45.0 && az < 120.0)  return 2.8;
    if (az >= 120.0 && az < 210.0) return 4.5;
    if (az >= 210.0 && az < 315.0) return -0.1;
    return 1.5;
}

extern "C" {

EMSCRIPTEN_KEEPALIVE
double normaliserDegres(double deg) {
    double res = std::fmod(deg, 360.0);
    return res < 0.0 ? res + 360.0 : res;
}

EMSCRIPTEN_KEEPALIVE
double calculerOndulationGeoideEGM(double latDeg, double lonDeg) {
    double phi = latDeg * DEG2RAD;
    double lam = lonDeg * DEG2RAD;
    double N = 28.5 * std::sin(2.0 * phi) * std::cos(lam - 0.15)
             - 18.2 * std::cos(phi) * std::sin(2.0 * lam)
             + 14.0 * std::sin(phi)
             + 8.4 * std::cos(2.0 * phi) * std::cos(2.0 * lam);
    return N;
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
    double l0 = normaliserDegres(280.4664567 + 36000.76982779 * T + 0.0003032 * T * T);
    double m = normaliserDegres(357.52911 + 35999.05029 * T - 0.0001537 * T * T);
    double c = (1.914602 - 0.004817 * T - 0.000014 * T * T) * std::sin(m * DEG2RAD) 
             + (0.019993 - 0.000101 * T) * std::sin(2.0 * m * DEG2RAD)
             + 0.000289 * std::sin(3.0 * m * DEG2RAD);
    double sunTrueLong = normaliserDegres(l0 + c);

    double lRad = sunTrueLong * DEG2RAD;
    double raSunRad = std::atan2(std::cos(epsA) * std::sin(lRad), std::cos(lRad));
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
    double earthVx_km_s, double earthVy_km_s, double earthVz_km_s,
    double latDeg, double lonDeg, double altM,
    double eraRad, double xpSec, double ypSec,
    double tempC, double presHpa, double humiditePct, double extinctionCoeff,
    double magBruteAstre, int32_t corpsType,
    double dSunAstroUA, double dSunEarthUA, double rayonAstreKm,
    double periodDays, double eccentricity, double obliquityDeg, double sunLongDeg,
    double timestampSec,
    AstroResult* result
) {
    if (!result) return;
    std::memset(result, 0, sizeof(AstroResult));

    // Correction rigoureuse du temps de parcours de la lumière
    double distKm = std::sqrt(xICRF_km * xICRF_km + yICRF_km * yICRF_km + zICRF_km * zICRF_km);
    double tau = distKm / VITESSE_LUMIERE_KM_S;
    double xCorr = xICRF_km - vx_km_s * tau;
    double yCorr = yICRF_km - vy_km_s * tau;
    double zCorr = zICRF_km - vz_km_s * tau;

    double pnat[3] = { xCorr, yCorr, zCorr };

    // Calcul de la position géodésique et de la vitesse diurne de la station
    double phi = latDeg * DEG2RAD;
    double lambda = lonDeg * DEG2RAD;
    double a = 6378137.0;
    double f = 1.0 / 298.257223563;
    double e2 = f * (2.0 - f);

    double N_obs = a / std::sqrt(1.0 - e2 * std::sin(phi) * std::sin(phi));
    double xObs = (N_obs + altM) * std::cos(phi) * std::cos(lambda);
    double yObs = (N_obs + altM) * std::cos(phi) * std::sin(lambda);
    double zObs = (N_obs * (1.0 - e2) + altM) * std::sin(phi);

    // Vitesse angulaire de la Terre (~7.292115e-5 rad/s)
    double omegaEarth = 7.292115e-5;
    double vx_diurne = -omegaEarth * (yObs / 1000.0);
    double vy_diurne =  omegaEarth * (xObs / 1000.0);
    double vz_diurne =  0.0;

    // Combinaison de la vitesse orbitale de la Terre et de la vitesse diurne de l'observateur
    double v[3] = {
    (earthVx_km_s + vx_diurne) / VITESSE_LUMIERE_KM_S,
    (earthVy_km_s + vy_diurne) / VITESSE_LUMIERE_KM_S,
    (earthVz_km_s + vz_diurne) / VITESSE_LUMIERE_KM_S
};

// 2. Calcul de la norme de la vitesse (bbr en fraction de c)
double bbr = std::sqrt(v[0]*v[0] + v[1]*v[1] + v[2]*v[2]);

double pabr[3];
// CORRECTION : On passe la distance réelle (distKm) et la norme de vitesse (bbr) à SOFA iauAb
iauAb(pnat, v, distKm, bbr, pabr);

double xI = pabr[0] * 1000.0;
double yI = pabr[1] * 1000.0;
double zI = pabr[2] * 1000.0;

    double normICRF = std::sqrt(xI * xI + yI * yI + zI * zI);
    result->raDeg = normaliserDegres(std::atan2(yI, xI) * RAD2DEG);
    result->decDeg = (normICRF > 0.0) ? std::asin(std::fmax(-1.0, std::min(1.0, zI / normICRF))) * RAD2DEG : 0.0;
    result->ghaDeg = normaliserDegres((eraRad * RAD2DEG) - result->raDeg);

    if (normICRF > 0.0) {
        result->radialVelocityKmS = (xICRF_km * vx_km_s + yICRF_km * vy_km_s + zICRF_km * vz_km_s) / (normICRF / 1000.0);
    }

    double xpRad = xpSec * (M_PI / 180.0) / 3600.0;
    double ypRad = ypSec * (M_PI / 180.0) / 3600.0;
    double rpom[3][3];

    double cosX = std::cos(-xpRad);
    double sinX = std::sin(-xpRad);
    double cosY = std::cos(-ypRad);
    double sinY = std::sin(-ypRad);

    rpom[0][0] = cosX;
    rpom[0][1] = 0.0;
    rpom[0][2] = -sinX;

    rpom[1][0] = sinY * sinX;
    rpom[1][1] = cosY;
    rpom[1][2] = sinY * cosX;

    rpom[2][0] = cosY * sinX;
    rpom[2][1] = -sinY;
    rpom[2][2] = cosY * cosX;

    double cosERA = std::cos(eraRad);
    double sinERA = std::sin(eraRad);
    double xTmp =  xI * cosERA + yI * sinERA;
    double yTmp = -xI * sinERA + yI * cosERA;
    double zTmp =  zI;

    double xECEF = rpom[0][0] * xTmp + rpom[0][1] * yTmp + rpom[0][2] * zTmp;
    double yECEF = rpom[1][0] * xTmp + rpom[1][1] * yTmp + rpom[1][2] * zTmp;
    double zECEF = rpom[2][0] * xTmp + rpom[2][1] * yTmp + rpom[2][2] * zTmp;

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
    result->elevGeom = std::fmax(-90.0, std::fmin(90.0, std::atan2(U, rhoHorizontal) * RAD2DEG));

    double rKm = (rayonAstreKm > 0.0) ? rayonAstreKm : (corpsType == 1 ? RAYON_SOLEIL_KM : 1737.4);
    if (distM > 0.0) {
        result->angularDiamArcsec = (2.0 * std::asin(std::fmin(1.0, (rKm * 1000.0) / distM))) * RAD2DEG * 3600.0;
    }

    double rhNorm = std::fmax(0.0, std::min(1.0, humiditePct / 100.0));
    if (result->elevGeom > -5.0) {
        double refa, refb;
        iauRefco(presHpa, tempC, rhNorm, 0.55, &refa, &refb);
        double zObsRad = (90.0 - result->elevGeom) * DEG2RAD;
        if (zObsRad > 0 && zObsRad < (M_PI / 2.0 + 0.15)) {
            double tanZ = std::tan(zObsRad);
            double deltaZRad = (refa * tanZ + refb * tanZ * tanZ * tanZ);
            if (result->elevGeom < 5.0) {
                deltaZRad += 0.00005 * std::pow(5.0 - result->elevGeom, 2.5) * DEG2RAD;
            }
            result->elevRefractee = std::fmax(-90.0, std::fmin(90.0, result->elevGeom + (deltaZRad * RAD2DEG)));
        } else {
            result->elevRefractee = result->elevGeom;
        }
    } else {
        result->elevRefractee = result->elevGeom;
    }

    if (result->elevRefractee > 0.0) {
        double elevRad = result->elevRefractee * DEG2RAD;
        double airMassStd = 1.0 / (std::sin(elevRad) + 0.50572 * std::pow(6.07995 + std::fmax(0.0, result->elevRefractee), -1.6364));
        result->airMass = airMassStd * (presHpa / 1013.25);
    } else {
        result->airMass = -1.0; 
    }

    result->magnitudeApparente = magBruteAstre + (extinctionCoeff * std::fmax(0.0, result->airMass));

    double demiDiamDeg = (result->angularDiamArcsec / 3600.0) / 2.0;
    double altRefRiseSet = (corpsType == 1) ? (-0.5667 - demiDiamDeg) * DEG2RAD : (-0.5667) * DEG2RAD;
    double decRad = result->decDeg * DEG2RAD;
    double cosH0 = (std::sin(altRefRiseSet) - std::sin(phi) * std::sin(decRad)) / (std::cos(phi) * std::cos(decRad));

    double lhaDeg = normaliserDegres(result->ghaDeg + lonDeg);
    double utcHoursNow = std::fmod(timestampSec / 3600.0, 24.0);
    if (utcHoursNow < 0.0) utcHoursNow += 24.0;
    double transitUT = std::fmod(utcHoursNow - (lhaDeg <= 180.0 ? lhaDeg : lhaDeg - 360.0) / 15.0 + 24.0, 24.0);

    if (cosH0 >= 1.0) {
        result->dureeVisibiliteHeures = 0.0;
        result->leverUT = -1.0;
        result->coucherUT = -1.0;
    } else if (cosH0 <= -1.0) {
        result->dureeVisibiliteHeures = 24.0;
        result->leverUT = 0.0;
        result->coucherUT = 24.0;
    } else {
        double H0Hours = (std::acos(cosH0) * RAD2DEG) / 15.0;
        result->dureeVisibiliteHeures = 2.0 * H0Hours;
        result->leverUT = std::fmod(transitUT - H0Hours + 24.0, 24.0);
        result->coucherUT = std::fmod(transitUT + H0Hours + 24.0, 24.0);
    }

    double cosH6 = (std::sin(-6.0 * DEG2RAD) - std::sin(phi) * std::sin(decRad)) / (std::cos(phi) * std::cos(decRad));
    if (cosH6 > -1.0 && cosH6 < 1.0) {
        double H6Hours = (std::acos(cosH6) * RAD2DEG) / 15.0;
        result->crepusculeUT = std::fmod(transitUT + H6Hours + 24.0, 24.0);
    } else {
        result->crepusculeUT = -1.0;
    }

    if (corpsType == 1) {
        result->irradiance = (result->elevRefractee > 0.0) ? (1361.0 / (result->distUA * result->distUA)) * std::pow(0.7, result->airMass) : 0.0;
        if (result->elevRefractee <= 0.0) {
            double elevAbs = std::fmax(0.5, std::abs(result->elevGeom));
            result->shadowLength = 1.0 / std::tan(elevAbs * DEG2RAD);
        } else {
            result->shadowLength = -1.0;
        }
    } else {
        result->irradiance = 0.0;
        result->shadowLength = -1.0;
    }

    double jdNow = (timestampSec / 86400.0) + 2440587.5;
    double daysSinceJ2000 = jdNow - 2451545.0;

    if (corpsType == 1) {
        result->illuminatedFraction = 1.0;
        result->moonPhasePct = 100.0;
        result->astreAgeDays = (normaliserDegres(sunLongDeg) / 360.0) * 365.25636;
        result->surfaceBrightness = -26.74;
    } else if (result->distUA > 0.0 && dSunAstroUA > 0.0 && dSunEarthUA > 0.0) {
        double cosPhase = (result->distUA * result->distUA + dSunAstroUA * dSunAstroUA - dSunEarthUA * dSunEarthUA) 
                        / (2.0 * result->distUA * dSunAstroUA);
        cosPhase = std::fmax(-1.0, std::fmin(1.0, cosPhase));
        double phaseAngleRad = std::acos(cosPhase);

        result->illuminatedFraction = 0.5 * (1.0 + std::cos(phaseAngleRad));
        result->moonPhasePct = result->illuminatedFraction * 100.0;
        result->surfaceBrightness = result->magnitudeApparente + 2.5 * std::log10(1.0 / (result->angularDiamArcsec * result->angularDiamArcsec + 1e-6));

        if (corpsType == 2) {
            result->astreAgeDays = (phaseAngleRad / M_PI) * 14.76529;
        } else {
            double pDays = (periodDays > 0.0) ? periodDays : 365.256;
            result->astreAgeDays = std::fmod(std::fmod(daysSinceJ2000, pDays) + pDays, pDays);
        }
    } else {
        result->illuminatedFraction = 1.0;
        result->moonPhasePct = 100.0;
        result->astreAgeDays = 0.0;
        result->surfaceBrightness = 0.0;
    }

    if (corpsType == 1) {
        result->glowTypeCode = 1;
        if (result->elevRefractee > 0.0) {
            result->skyGlowMagArcsec2 = 3.5 + 1.5 * (1.0 - std::sin(result->elevRefractee * DEG2RAD));
        } else if (result->elevRefractee > -18.0) {
            result->skyGlowMagArcsec2 = 5.0 + (std::abs(result->elevRefractee) / 18.0) * 16.8;
        } else {
            result->skyGlowMagArcsec2 = 21.95;
        }
    } else if (corpsType == 2) {
        if (result->elevRefractee > -2.0 && result->illuminatedFraction >= 0.45) {
            result->glowTypeCode = 2;
            double facteurPhase = std::pow(result->illuminatedFraction, 2.5);
            double facteurHauteur = std::sin(std::fmax(0.05, result->elevRefractee + 2.0) * DEG2RAD);
            result->skyGlowMagArcsec2 = 21.95 - (4.45 * facteurPhase * std::pow(facteurHauteur, 0.4));
        } else {
            result->glowTypeCode = 0;
            result->skyGlowMagArcsec2 = 21.95;
        }
    } else {
        result->glowTypeCode = 0;
        result->skyGlowMagArcsec2 = 0.0;
    }

    double M_anom = normaliserDegres((daysSinceJ2000 / (periodDays > 0.0 ? periodDays : 365.256)) * 360.0) * DEG2RAD;
    double epsAstre = obliquityDeg * DEG2RAD;
    double yObl = std::tan(epsAstre / 2.0);
    yObl *= yObl;
    double eqTimeRad = yObl * std::sin(2.0 * M_anom) 
                     - 2.0 * eccentricity * std::sin(M_anom)
                     + 4.0 * eccentricity * yObl * std::sin(M_anom) * std::cos(2.0 * M_anom);
    result->astreEqTempsMin = (eqTimeRad * RAD2DEG) * 4.0;
    result->astreMeanTimeHours = std::fmod((lhaDeg / 15.0) + 12.0 + 24.0, 24.0);
    result->astreTrueTimeHours = std::fmod(result->astreMeanTimeHours + (result->astreEqTempsMin / 60.0) + 24.0, 24.0);

    double elevHorizonLocal = obtenirElevationHorizonTopographique(result->azim);
    if (result->elevRefractee < elevHorizonLocal) {
        result->visibiliteCode = 0;
    } else if (result->magnitudeApparente <= 6.0) {
        result->visibiliteCode = 1;
    } else if (result->magnitudeApparente <= 10.0) {
        result->visibiliteCode = 2;
    } else {
        result->visibiliteCode = 3;
    }
}

EMSCRIPTEN_KEEPALIVE
void evaluerOccultationsEtEclipses(AstroResult* resultsArray, int32_t count, int32_t idxSoleil, int32_t idxLune) {
    if (!resultsArray || count <= 0) return;

    AstroResult* soleil = (idxSoleil >= 0 && idxSoleil < count) ? &resultsArray[idxSoleil] : nullptr;
    AstroResult* lune   = (idxLune >= 0 && idxLune < count)     ? &resultsArray[idxLune]   : nullptr;

    if (soleil && lune) {
        double sepSolLuneArcsec = separationAngulaireArcsec(soleil->raDeg, soleil->decDeg, lune->raDeg, lune->decDeg);
        double rSolArcsec = soleil->angularDiamArcsec * 0.5;
        double rLuneArcsec = lune->angularDiamArcsec * 0.5;

        if (sepSolLuneArcsec < (rSolArcsec + rLuneArcsec)) {
            double frac = calculerFractionRecouvrementDisques(sepSolLuneArcsec, rSolArcsec, rLuneArcsec);
            soleil->occultationPct = frac * 100.0;
            soleil->occultationCode = 1;
            soleil->irradiance *= (1.0 - frac);
        }

        double raAntiSol = normaliserDegres(soleil->raDeg + 180.0);
        double decAntiSol = -soleil->decDeg;
        double sepLuneOmbreArcsec = separationAngulaireArcsec(lune->raDeg, lune->decDeg, raAntiSol, decAntiSol);

        double distLuneKm = lune->distUA * (UA_EN_METRES / 1000.0);
        double distSolKm  = soleil->distUA * (UA_EN_METRES / 1000.0);

        if (distLuneKm > 0.0 && distSolKm > 0.0) {
            double piLuneRad = std::asin(std::fmin(1.0, RAYON_TERRE_KM / distLuneKm));
            double piSolRad  = std::asin(std::fmin(1.0, RAYON_TERRE_KM / distSolKm));
            double sSolRad   = (rSolArcsec / 3600.0) * DEG2RAD;

            double rOmbreArcsec    = 1.02 * (piLuneRad + piSolRad - sSolRad) * RAD2DEG * 3600.0;
            double rPenombreArcsec = 1.02 * (piLuneRad + piSolRad + sSolRad) * RAD2DEG * 3600.0;

            if (sepLuneOmbreArcsec < (rOmbreArcsec + rLuneArcsec)) {
                double fracOmbre = calculerFractionRecouvrementDisques(sepLuneOmbreArcsec, rLuneArcsec, rOmbreArcsec);
                lune->occultationPct = fracOmbre * 100.0;
                lune->occultationCode = 2;
            } else if (sepLuneOmbreArcsec < (rPenombreArcsec + rLuneArcsec)) {
                double fracPenombre = calculerFractionRecouvrementDisques(sepLuneOmbreArcsec, rLuneArcsec, rPenombreArcsec);
                lune->occultationPct = fracPenombre * 100.0;
                lune->occultationCode = 3;
            }
        }
    }

    for (int32_t i = 0; i < count; ++i) {
        if (i == idxSoleil || i == idxLune) continue;
        AstroResult* astre = &resultsArray[i];
        double rAstreArcsec = astre->angularDiamArcsec * 0.5;

        if (lune) {
            double sep = separationAngulaireArcsec(astre->raDeg, astre->decDeg, lune->raDeg, lune->decDeg);
            double rLune = lune->angularDiamArcsec * 0.5;
            if (sep < (rLune + rAstreArcsec)) {
                astre->occultationPct = calculerFractionRecouvrementDisques(sep, rAstreArcsec, rLune) * 100.0;
                astre->occultationCode = 4;
                continue;
            }
        }

        for (int32_t j = 0; j < count; ++j) {
            if (i == j || j == idxSoleil || j == idxLune) continue;
            AstroResult* autre = &resultsArray[j];
            if (autre->distUA < astre->distUA) {
                double sepMut = separationAngulaireArcsec(astre->raDeg, astre->decDeg, autre->raDeg, autre->decDeg);
                double rAutre = autre->angularDiamArcsec * 0.5;
                if (sepMut < (rAutre + rAstreArcsec)) {
                    astre->occultationPct = calculerFractionRecouvrementDisques(sepMut, rAstreArcsec, rAutre) * 100.0;
                    astre->occultationCode = 4;
                }
            }
        }
    }
}

}
