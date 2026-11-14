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
#define RAYON_TERRE_KM 6378.137

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
    double occultationPct;        // 23 (Nouveau : % d'éclipse ou d'occultation)
    int32_t visibiliteCode;       // Byte offset 192
    int32_t occultationCode;      // Byte offset 196 (0: Aucune, 1: Éclipse Sol., 2: Éclipse Lun. Ombre, 3: Éclipse Lun. Pénombre, 4: Occulté par Lune/Planète)
};

// Calcul de l'aire d'intersection de deux cercles de rayons r1 et r2 séparés par une distance d
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

// Séparation angulaire sphérique en arcsecondes
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
    double latDeg, double lonDeg, double altM,
    double eraRad, double tempC, double presHpa, double extinctionCoeff,
    double magBruteAstre, int32_t estSoleil,
    double dSunAstroUA, double dSunEarthUA, double rayonAstreKm,
    AstroResult* result
) {
    if (!result) return;
    std::memset(result, 0, sizeof(AstroResult));

    double xI = xICRF_km * 1000.0;
    double yI = yICRF_km * 1000.0;
    double zI = zICRF_km * 1000.0;

    double normICRF = std::sqrt(xI * xI + yI * yI + zI * zI);
    result->raDeg = normaliserDegres(std::atan2(yI, xI) * RAD2DEG);
    result->decDeg = (normICRF > 0.0) ? std::asin(std::fmax(-1.0, std::min(1.0, zI / normICRF))) * RAD2DEG : 0.0;
    result->ghaDeg = normaliserDegres((eraRad * RAD2DEG) - result->raDeg);

    // Vitesse radiale géocentrique Doppler (km/s)
    if (normICRF > 0.0) {
        result->radialVelocityKmS = (xICRF_km * vx_km_s + yICRF_km * vy_km_s + zICRF_km * vz_km_s) / (normICRF / 1000.0);
    }

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
    // Correctif strict de normalisation de l'élévation topocentrique [-90°, +90°]
    result->elevGeom = std::fmax(-90.0, std::fmin(90.0, std::atan2(U, rhoHorizontal) * RAD2DEG));

    double rKm = (rayonAstreKm > 0.0) ? rayonAstreKm : (estSoleil ? RAYON_SOLEIL_KM : 1737.4);
    if (distM > 0.0) {
        result->angularDiamArcsec = (2.0 * std::asin(std::fmin(1.0, (rKm * 1000.0) / distM))) * RAD2DEG * 3600.0;
    }

    if (result->elevGeom > -5.0) {
        double refa, refb;
        iauRefco(presHpa, tempC, 50.0, 0.55, &refa, &refb);
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
    
    if (estSoleil == 1) {
        result->irradiance = (result->elevRefractee > 0.0) ? (1361.0 / (result->distUA * result->distUA)) * std::pow(0.7, result->airMass) : 0.0;
        result->shadowLength = (result->elevRefractee > 0.0) ? 1.0 / std::tan(std::fmax(1e-4, result->elevRefractee * DEG2RAD)) : -1.0;

        double demiDiamDeg = (result->angularDiamArcsec / 3600.0) / 2.0;
        double altRef = (-0.5667 - demiDiamDeg) * DEG2RAD;
        double decRad = result->decDeg * DEG2RAD;
        double cosH0 = (std::sin(altRef) - std::sin(phi) * std::sin(decRad)) / (std::cos(phi) * std::cos(decRad));
        
        if (cosH0 >= 1.0) {
            result->dureeJourHeures = 0.0; result->leverUT = -1.0; result->coucherUT = -1.0;
        } else if (cosH0 <= -1.0) {
            result->dureeJourHeures = 24.0; result->leverUT = 0.0; result->coucherUT = 24.0;
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

    if (estSoleil == 1) {
        result->illuminatedFraction = 1.0;
        result->moonPhasePct = 100.0;
        result->moonAgeDays = -1.0;
        result->surfaceBrightness = -26.74;
    } else if (result->distUA > 0.0 && dSunAstroUA > 0.0 && dSunEarthUA > 0.0) {
        double cosPhase = (result->distUA * result->distUA + dSunAstroUA * dSunAstroUA - dSunEarthUA * dSunEarthUA) 
                        / (2.0 * result->distUA * dSunAstroUA);
        cosPhase = std::fmax(-1.0, std::fmin(1.0, cosPhase));
        double phaseAngleRad = std::acos(cosPhase);

        result->illuminatedFraction = 0.5 * (1.0 + std::cos(phaseAngleRad));
        result->moonPhasePct = result->illuminatedFraction * 100.0;
        result->moonAgeDays = (result->distUA < 0.05) ? (phaseAngleRad / M_PI) * 14.765 : -1.0;
        result->surfaceBrightness = result->magnitudeApparente + 2.5 * std::log10(1.0 / (result->angularDiamArcsec * result->angularDiamArcsec + 1e-6));
    } else {
        result->illuminatedFraction = 1.0;
        result->moonPhasePct = 100.0;
        result->moonAgeDays = -1.0;
        result->surfaceBrightness = 0.0;
    }

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

// Évaluation croisée globale des éclipses solaires, éclipses lunaires (ombre/pénombre) et occultations planétaires
EMSCRIPTEN_KEEPALIVE
void evaluerOccultationsEtEclipses(AstroResult* resultsArray, int32_t count, int32_t idxSoleil, int32_t idxLune) {
    if (!resultsArray || count <= 0) return;

    AstroResult* soleil = (idxSoleil >= 0 && idxSoleil < count) ? &resultsArray[idxSoleil] : nullptr;
    AstroResult* lune   = (idxLune >= 0 && idxLune < count)     ? &resultsArray[idxLune]   : nullptr;

    // 1. Éclipse Solaire (Lune devant le Soleil)
    if (soleil && lune) {
        double sepSolLuneArcsec = separationAngulaireArcsec(soleil->raDeg, soleil->decDeg, lune->raDeg, lune->decDeg);
        double rSolArcsec = soleil->angularDiamArcsec * 0.5;
        double rLuneArcsec = lune->angularDiamArcsec * 0.5;

        if (sepSolLuneArcsec < (rSolArcsec + rLuneArcsec)) {
            double frac = calculerFractionRecouvrementDisques(sepSolLuneArcsec, rSolArcsec, rLuneArcsec);
            soleil->occultationPct = frac * 100.0;
            soleil->occultationCode = 1; // Éclipse solaire
            // Réduction proportionnelle de l'irradiance solaire
            soleil->irradiance *= (1.0 - frac);
        }

        // 2. Éclipse Lunaire (Lune dans le cône d'ombre / pénombre terrestre antisolaire)
        double raAntiSol = normaliserDegres(soleil->raDeg + 180.0);
        double decAntiSol = -soleil->decDeg;
        double sepLuneOmbreArcsec = separationAngulaireArcsec(lune->raDeg, lune->decDeg, raAntiSol, decAntiSol);

        double distLuneKm = lune->distUA * (UA_EN_METRES / 1000.0);
        double distSolKm  = soleil->distUA * (UA_EN_METRES / 1000.0);

        if (distLuneKm > 0.0 && distSolKm > 0.0) {
            // Parallaxes horizontales et rayons angulaires du cône d'ombre (élargissement Danjon +2%)
            double piLuneRad = std::asin(std::fmin(1.0, RAYON_TERRE_KM / distLuneKm));
            double piSolRad  = std::asin(std::fmin(1.0, RAYON_TERRE_KM / distSolKm));
            double sSolRad   = (rSolArcsec / 3600.0) * DEG2RAD;

            double rOmbreArcsec    = 1.02 * (piLuneRad + piSolRad - sSolRad) * RAD2DEG * 3600.0;
            double rPenombreArcsec = 1.02 * (piLuneRad + piSolRad + sSolRad) * RAD2DEG * 3600.0;

            if (sepLuneOmbreArcsec < (rOmbreArcsec + rLuneArcsec)) {
                double fracOmbre = calculerFractionRecouvrementDisques(sepLuneOmbreArcsec, rLuneArcsec, rOmbreArcsec);
                lune->occultationPct = fracOmbre * 100.0;
                lune->occultationCode = 2; // Éclipse de Lune (Ombre)
            } else if (sepLuneOmbreArcsec < (rPenombreArcsec + rLuneArcsec)) {
                double fracPenombre = calculerFractionRecouvrementDisques(sepLuneOmbreArcsec, rLuneArcsec, rPenombreArcsec);
                lune->occultationPct = fracPenombre * 100.0;
                lune->occultationCode = 3; // Éclipse de Lune (Pénombre)
            }
        }
    }

    // 3. Occultations des planètes par la Lune ou conjonctions serrés/occultations mutuelles
    for (int32_t i = 0; i < count; ++i) {
        if (i == idxSoleil || i == idxLune) continue;
        AstroResult* astre = &resultsArray[i];
        double rAstreArcsec = astre->angularDiamArcsec * 0.5;

        // Test d'occultation par la Lune
        if (lune) {
            double sep = separationAngulaireArcsec(astre->raDeg, astre->decDeg, lune->raDeg, lune->decDeg);
            double rLune = lune->angularDiamArcsec * 0.5;
            if (sep < (rLune + rAstreArcsec)) {
                astre->occultationPct = calculerFractionRecouvrementDisques(sep, rAstreArcsec, rLune) * 100.0;
                astre->occultationCode = 4; // Occulté par la Lune
                continue;
            }
        }

        // Test d'occultation mutuelle entre planètes
        for (int32_t j = 0; j < count; ++j) {
            if (i == j || j == idxSoleil || j == idxLune) continue;
            AstroResult* autre = &resultsArray[j];
            if (autre->distUA < astre->distUA) {
                double sepMut = separationAngulaireArcsec(astre->raDeg, astre->decDeg, autre->raDeg, autre->decDeg);
                double rAutre = autre->angularDiamArcsec * 0.5;
                if (sepMut < (rAutre + rAstreArcsec)) {
                    astre->occultationPct = calculerFractionRecouvrementDisques(sepMut, rAstreArcsec, rAutre) * 100.0;
                    astre->occultationCode = 4; // Occultation planétaire mutuelle
                }
            }
        }
    }
}

}
