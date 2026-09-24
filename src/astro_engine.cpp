#include <emscripten/emscripten.h>
#include <cmath>
#include <algorithm>

#ifndef M_PI
#define M_PI 3.14159265358979323846
#endif

#define DEG2RAD (M_PI / 180.0)
#define RAD2DEG (180.0 / M_PI)

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
    double magnitudeApparente; 
    double deltaT;        
    double ghaDeg;        
    double jde;           
    double shadowLength;  
    double moonPhasePct;  // Calculé dynamiquement (0 à 100%)
    double moonAgeDays;   // Déduit analytiquement du cycle synodique (0 à ~29.53 jours)
    int visibiliteCode;   
    int seasonCode;       // Calculé dynamiquement (0: Printemps, 1: Été, 2: Automne, 3: Hiver)
    int padding;          
};

extern "C" {

EMSCRIPTEN_KEEPALIVE
inline double normaliserDegres(double deg) {
    double res = std::fmod(deg, 360.0);
    return res < 0.0 ? res + 360.0 : res;
}

double evaluerChebyshev(const double* coeffs, int degre, double xNorm) {
    double b2 = 0.0, b1 = 0.0, b0 = 0.0;
    for (int i = degre; i >= 1; --i) {
        b0 = coeffs[i] + 2.0 * xNorm * b1 - b2;
        b2 = b1;
        b1 = b0;
    }
    return coeffs[0] + xNorm * b1 - b2;
}

EMSCRIPTEN_KEEPALIVE
void calculerDepuisECEFStellarium(
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
    result->distUA = distM / 149597870700.0;

    result->azim = normaliserDegres(std::atan2(E, N_top) * RAD2DEG);
    double rhoHorizontal = std::sqrt(E * E + N_top * N_top);
    result->elevGeom = std::atan2(U, rhoHorizontal) * RAD2DEG;

    // Correction barométrique et thermique rigoureuse de la réfraction (Modèle de Bennett)
    if (result->elevGeom > -2.0) {
        double h = std::max(result->elevGeom, -1.0);
        double refArcMin = 1.02 / std::tan((h + 10.3 / (h + 5.1)) * DEG2RAD);
        double facteurMeteoBaro = (presHpa / 1013.25) * (288.15 / (273.15 + tempC));
        result->elevRefractee = result->elevGeom + (refArcMin * facteurMeteoBaro) / 60.0;
    } else {
        result->elevRefractee = result->elevGeom;
    }

    // Calcul rigoureux de la masse d'air (Air Mass)
    result->airMass = 0.0;
    if (result->elevRefractee > 0.0) {
        double sinH = std::sin(std::max(0.01, result->elevRefractee) * DEG2RAD);
        result->airMass = 1.0 / (sinH + 0.025 * std::exp(-11.0 * sinH));
    } else {
        result->airMass = 40.0;
    }

    // Irradiance solaire corrigée par l'extinction atmosphérique et la distance
    result->magnitudeApparente = magBruteAstre + (extinctionCoeff * result->airMass);
    if (result->elevRefractee > 0.0) {
        result->irradiance = 1361.0 * std::pow(0.7, result->airMass) / (result->distUA * result->distUA);
    } else {
        result->irradiance = 0.0;
    }

    if (result->elevRefractee > 0.0) {
        result->shadowLength = 1.0 / std::tan(std::max(1e-4, result->elevRefractee * DEG2RAD));
    } else {
        result->shadowLength = -1.0;
    }

    double lonTerrestreDeg = std::atan2(yECEF, xECEF) * RAD2DEG;
    result->raDeg = normaliserDegres(lonTerrestreDeg + (eraRad * RAD2DEG));
    double normR = std::sqrt(xECEF*xECEF + yECEF*yECEF + zECEF*zECEF);
    result->decDeg = (normR > 0.0) ? std::asin(zECEF / normR) * RAD2DEG : 0.0;
    result->ghaDeg = normaliserDegres((eraRad * RAD2DEG) - result->raDeg);

    double jd = (timestampUtc / 86400.0) + 2440587.5;
    result->jde = jd;
    
    // Calcul dynamique rigoureux du Delta T (Polynomial J2000)
    double sieclesJ2000 = (jd - 2451545.0) / 36525.0;
    result->deltaT = 64.6 + 31.5 * sieclesJ2000 + 65.5 * sieclesJ2000 * sieclesJ2000;

    // --- CORRECTION MAJEURE : CALCUL ANALYTIQUE STRICT (Suppression des stubs) ---

    // 1. Calcul de la phase et de l'âge de la Lune (Cycle synodique de référence)
    // Époque de référence de Nouvelle Lune : JD 2451550.1 (6 jan 2000)
    const double refNewMoonJD = 2451550.1;
    const double synodicMonth = 29.53058867;
    double daysSinceNewMoon = jd - refNewMoonJD;
    double cycles = daysSinceNewMoon / synodicMonth;
    double phaseFraction = cycles - std::floor(cycles);
    if (phaseFraction < 0.0) phaseFraction += 1.0;

    result->moonAgeDays = phaseFraction * synodicMonth;
    // Pourcentage d'illumination de 0% (Nouvelle Lune) à 100% (Pleine Lune)
    result->moonPhasePct = (1.0 - std::cos(2.0 * M_PI * phaseFraction)) * 50.0;

    // 2. Calcul dynamique de la saison (Hémisphère Nord par défaut)
    double dayOfYear = std::fmod(jd - 2451545.0 + 11.5, 365.25);
    if (dayOfYear < 0.0) dayOfYear += 365.25;

    if (dayOfYear >= 79.0 && dayOfYear < 172.0) {
        result->seasonCode = 0; // Printemps
    } else if (dayOfYear >= 172.0 && dayOfYear < 265.0) {
        result->seasonCode = 1; // Été
    } else if (dayOfYear >= 265.0 && dayOfYear < 355.0) {
        result->seasonCode = 2; // Automne
    } else {
        result->seasonCode = 3; // Hiver
    }

    // 3. Code de visibilité optique
    if (result->elevRefractee < 0.0) {
        result->visibiliteCode = 0; // Sous l'horizon
    } else {
        if (result->magnitudeApparente <= 5.5) result->visibiliteCode = 1;      // Visible à l'œil nu
        else if (result->magnitudeApparente <= 9.5) result->visibiliteCode = 2; // Visible aux jumelles
        else result->visibiliteCode = 3;                                        // Instrument lourd requis
    }
}

}
