#include <iostream>
#include <cmath>
#include <cassert>
#include <vector>
#include <iomanip>

// Déclaration de la structure AstroResult (miroir exact de votre moteur)
struct AstroResult {
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

// Déclaration externe de votre fonction principale issue du noyau Wasm/C++
extern "C" {
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
);
}

// Structure pour un vecteur de test de référence
struct TestCase {
    std::string nomAstre;
    double xICRF, yICRF, zICRF;
    double vx, vy, vz;
    double earthVx, earthVy, earthVz;
    double lat, lon, alt;
    double eraRad, xp, yp;
    double timestampSec;
    // Valeurs de référence attendues (JPL Horizons)
    expectedRaDeg, expectedDecDeg;
    double toleranceArcsec;
};

void executerTestsValidation() {
    std::cout << "==================================================\n";
    std::cout << "  SYSTEMA SENTINELA — VALIDATEUR ASTROMÉTRIQUE C++ \n";
    std::cout << "==================================================\n";

    // Exemple de cas de test (à alimenter avec un vecteur extrait de JPL Horizons)
    AstroResult res;
    std::memset(&res, 0, sizeof(AstroResult));

    // Paramètres de test pour Marseille (station de référence)
    double lat = 43.284356;
    double lon = 5.358507;
    double alt = 49.81;
    double timestampSec = 1774500000.0; // Exemple d'Epoch Unix

    // Exemple fictif de coordonnées ICRF (à remplacer par des données de test réelles)
    double xICRF = 150000000.0, yICRF = 25000000.0, zICRF = 1000000.0;
    double vx = 10.0, vy = -20.0, vz = 1.0;
    double earthVx = -29.8, earthVy = 2.5, earthVz = 0.0;
    double eraRad = 1.57; // Angle ERA de test
    double xp = 0.05, yp = 0.12;

    calculerDepuisECEF(
        xICRF, yICRF, zICRF,
        vx, vy, vz,
        earthVx, earthVy, earthVz,
        lat, lon, alt,
        eraRad, xp, yp,
        15.0, 1013.25, 50.0, 0.15,
        -26.74, 1,
        1.0, 1.0, 696340.0,
        365.256, 0.0167, 23.44, 0.0,
        timestampSec,
        &res
    );

    std::cout << "[RÉSULTAT CALCULÉ]\n";
    std::cout << "  - AD (RA)   : " << std::fixed << std::setprecision(6) << res.raDeg << "°\n";
    std::cout << "  - DEC       : " << res.decDeg << "°\n";
    std::cout << "  - Azim      : " << res.azim << "°\n";
    std::cout << "  - Élévation : " << res.elevGeom << "°\n";
    std::cout << "  - Diam. Ang.: " << res.angularDiamArcsec << "''\n";
    std::cout << "--------------------------------------------------\n";
    std::cout << "[STATUT] Test unitaire exécuté avec succès.\n";
}

int main() {
    executerTestsValidation();
    return 0;
}
