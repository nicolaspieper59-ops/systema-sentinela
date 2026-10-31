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
    double azim;               // Azimut topocentrique (degrés 0..360)
    double elevGeom;           // Élévation géométrique (degrés)
    double elevRefractee;      // Élévation apparente après réfraction (degrés)
    double raDeg;              // Ascension Droite (degrés)
    double decDeg;             // Déclinaison (degrés)
    double distUA;             // Distance topocentrique (AU)
    double leverUT;            // Heure de lever (Heures UTC décimales ou -1)
    double coucherUT;          // Heure de coucher (Heures UTC décimales ou -1)
    double airMass;            // Masse d'air atmosphérique
    double irradiance;         // Irradiance solaire directe (W/m²)
    double deltaT;             // Delta T (secondes)
    double ghaDeg;             // Greenwich Hour Angle (degrés)
    double jde;                // Jour Julien Éphéméride
    double magnitudeApparente; // Magnitude apparente après extinction
    double shadowLength;       // Longueur de l'ombre portée pour un objet de 1m
    double moonPhasePct;       // Phase illuminée (%)
    double moonAgeDays;        // Âge de la Lune (jours)
    double crepusculeUT;       // Crépuscule civil du soir (Heures UTC décimales)
    double dureeJourHeures;    // Durée totale d'illumination (heures)
    double angularDiamArcsec;  // Diamètre angulaire apparent (arcsecondes)
    double surfaceBrightness;  // Brillance de surface
    double illuminatedFraction;// Fraction illuminée (0.0 à 1.0)
    double radialVelocityKmS;  // Vitesse radiale (km/s)
    int32_t visibiliteCode;    // Code de visibilité (0: non visible, 1: œil nu, 2: jumelles, 3: télescope)
    int32_t seasonCode;        // Code saisonnier
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

    // Jour Julien UTC
    double jd = (timestampSec / 86400.0) + 2440587.5;
    double T = (jd - 2451545.0) / 36525.0;

    // Obliquité moyenne de l'écliptique (IAU 2006 / SOFA)
    double eps0Arcsec = 84381.448 - 46.8150 * T - 0.00059 * T * T + 0.001813 * T * T * T;
    double obliquiteDeg = eps0Arcsec / 3600.0;

    // Temps Sidéral de Greenwich (ERA & GAST complet)
    double du = jd - 2451545.0;
    double eraRad = 2.0 * M_PI * (0.7790572732640 + 1.00273781191135448 * du);
    double eraDeg = normaliserDegres(eraRad * RAD2DEG);

    // Terme de nutation simplifié pour corriger ERA -> GAST (Greenwich Apparent Sidereal Time)
    double omega = (125.04 - 1934.136 * T) * DEG2RAD;
    double dPsiArcsec = -17.20 * std::sin(omega);
    double gastDeg = normaliserDegres(eraDeg + (dPsiArcsec * std::cos(obliquiteDeg * DEG2RAD) / 3600.0));
    double lstDeg = normaliserDegres(gastDeg + lonDeg);

    // Longitude solaire moyenne et équation du centre
    double l0 = normaliserDegres(280.46646 + 36000.76983 * T);
    double m = normaliserDegres(357.52911 + 35999.05029 * T);
    double c = (1.914602 - 0.004817 * T) * std::sin(m * DEG2RAD) 
             + (0.019993 - 0.000101 * T) * std::sin(2.0 * m * DEG2RAD)
             + 0.000289 * std::sin(3.0 * m * DEG2RAD);
    double sunTrueLong = normaliserDegres(l0 + c);

    // Équation du temps (rigoureuse en minutes)
    double y = std::tan((obliquiteDeg / 2.0) * DEG2RAD);
    y *= y;
    double l0Rad = l0 * DEG2RAD;
    double mRad = m * DEG2RAD;
    double eqTempsRad = y * std::sin(2.0 * l0Rad) 
                        - 2.0 * 0.016708634 * std::sin(mRad) 
                        + 4.0 * 0.016708634 * y * std::sin(mRad) * std::cos(2.0 * l0Rad) 
                        - 0.5 * y * y * std::sin(4.0 * l0Rad);

    metricsPtr[0] = (eqTempsRad * RAD2DEG) * 4.0; // Équation du Temps en minutes
    metricsPtr[1] = obliquiteDeg;                  // Obliquité écliplique (°)
    metricsPtr[2] = sunTrueLong;                   // Longitude vraie du Soleil (°)
    metricsPtr[3] = gastDeg;                       // GAST (°)
    metricsPtr[4] = lstDeg;                        // LST (°)
}

EMSCRIPTEN_KEEPALIVE
void calculerDepuisECEF(
    double xICRF_km, double yICRF_km, double zICRF_km,
    double latDeg, double lonDeg, double altM,
    double eraRad, double tempC, double presHpa, double extinctionCoeff,
    double magBruteAstre, int32_t estSoleil,
    AstroResult* result
) {
    if (!result) return;
    std::memset(result, 0, sizeof(AstroResult));

    // Convertir les coordonnées ICRF de km en mètres
    double xI = xICRF_km * 1000.0;
    double yI = yICRF_km * 1000.0;
    double zI = zICRF_km * 1000.0;

    // Coordonnées célestes équatoriales (RA, Dec, GHA)
    double normICRF = std::sqrt(xI * xI + yI * yI + zI * zI);
    result->raDeg = normaliserDegres(std::atan2(yI, xI) * RAD2DEG);
    result->decDeg = (normICRF > 0.0) ? std::asin(std::fmax(-1.0, std::min(1.0, zI / normICRF))) * RAD2DEG : 0.0;
    result->ghaDeg = normaliserDegres((eraRad * RAD2DEG) - result->raDeg);

    // Transformation de rotation Terrestre : ICRF vers ECEF
    double cosERA = std::cos(eraRad);
    double sinERA = std::sin(eraRad);
    double xECEF =  xI * cosERA + yI * sinERA;
    double yECEF = -xI * sinERA + yI * cosERA;
    double zECEF =  zI;

    // Calcul de la position de l'observateur sur l'ellipsoïde WGS84
    double phi = latDeg * DEG2RAD;
    double lambda = lonDeg * DEG2RAD;
    double a = 6378137.0; // Demi-grand axe WGS84
    double f = 1.0 / 298.257223563;
    double e2 = f * (2.0 - f);

    double N_obs = a / std::sqrt(1.0 - e2 * std::sin(phi) * std::sin(phi));
    double xObs = (N_obs + altM) * std::cos(phi) * std::cos(lambda);
    double yObs = (N_obs + altM) * std::cos(phi) * std::sin(lambda);
    double zObs = (N_obs * (1.0 - e2) + altM) * std::sin(phi);

    // Vecteur relatif de l'observateur à l'astre en ECEF
    double dx = xECEF - xObs;
    double dy = yECEF - yObs;
    double dz = zECEF - zObs;

    // Conversion ECEF vers Repère Topocentrique Local (East, North, Up - ENU)
    double E = -std::sin(lambda) * dx + std::cos(lambda) * dy;
    double N_top = -std::sin(phi) * std::cos(lambda) * dx - std::sin(phi) * std::sin(lambda) * dy + std::cos(phi) * dz;
    double U = std::cos(phi) * std::cos(lambda) * dx + std::cos(phi) * std::sin(lambda) * dy + std::sin(phi) * dz;

    // Distance géométrique topocentrique
    double distM = std::sqrt(dx * dx + dy * dy + dz * dz);
    result->distUA = distM / UA_EN_METRES;

    // Azimut et élévation géométrique
    result->azim = normaliserDegres(std::atan2(E, N_top) * RAD2DEG);
    double rhoHorizontal = std::sqrt(E * E + N_top * N_top);
    result->elevGeom = std::atan2(U, rhoHorizontal) * RAD2DEG;

    // Calcul du diamètre angulaire apparent (arcsecondes)
    if (result->distUA > 0.0) {
        double rayonAstreKm = estSoleil ? RAYON_SOLEIL_KM : 1737.4; // Soleil ou défaut Lune/planète
        result->angularDiamArcsec = (2.0 * std::asin((rayonAstreKm * 1000.0) / distM)) * RAD2DEG * 3600.0;
    }

    // Réfraction atmosphérique rigoureuse (Formule de Bennett sécurisée sous l'horizon)
    if (result->elevGeom > -2.0) {
        double h = std::fmax(result->elevGeom, -1.9);
        double refArcMin = 1.02 / std::tan((h + 10.3 / (h + 5.11)) * DEG2RAD);
        double facteurMeteo = (presHpa / 1013.25) * (283.15 / (273.15 + tempC));
        result->elevRefractee = result->elevGeom + (refArcMin * facteurMeteo) / 60.0;
    } else {
        result->elevRefractee = result->elevGeom;
    }

    // Masse d'air atmosphérique (Modèle de Pickering / Rozenberg sécurisé)
    if (result->elevRefractee > 0.0) {
        double sinH = std::sin(std::fmax(0.01, result->elevRefractee) * DEG2RAD);
        result->airMass = 1.0 / (sinH + 0.025 * std::exp(-11.0 * sinH));
    } else {
        result->airMass = -1.0; 
    }

    // Magnitude apparente avec absorption/extinction atmosphérique
    result->magnitudeApparente = magBruteAstre + (extinctionCoeff * std::fmax(0.0, result->airMass));
    
    // Propriétés photométriques et éphémérides du Soleil
    if (estSoleil == 1) {
        result->irradiance = (result->elevRefractee > 0.0) ? (1361.0 / (result->distUA * result->distUA)) * std::pow(0.7, result->airMass) : 0.0;
        result->shadowLength = (result->elevRefractee > 0.0) ? 1.0 / std::tan(std::fmax(1e-4, result->elevRefractee * DEG2RAD)) : -1.0;

        // Calcul des heures de lever et coucher avec correction de demi-diamètre solaire
        double demiDiamDeg = (result->angularDiamArcsec / 3600.0) / 2.0;
        double altRef = (-0.5667 - demiDiamDeg) * DEG2RAD; // Réfraction standard 34' + demi-diamètre
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

        // Crépuscule civil (-6°)
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

    // Code de visibilité instrumental / œil nu
    if (result->elevRefractee <= 0.0) {
        result->visibiliteCode = 0; // Sous l'horizon
    } else if (result->magnitudeApparente <= 6.0) {
        result->visibiliteCode = 1; // Œil nu
    } else if (result->magnitudeApparente <= 10.0) {
        result->visibiliteCode = 2; // Jumelles
    } else {
        result->visibiliteCode = 3; // Télescope
    }
}

}
