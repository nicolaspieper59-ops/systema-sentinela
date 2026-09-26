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
    double moonPhasePct;  
    double moonAgeDays;   
    int visibiliteCode;   
    int seasonCode;       
    int padding;          
};

extern "C" {

EMSCRIPTEN_KEEPALIVE
inline double normaliserDegres(double deg) {
    double res = std::fmod(deg, 360.0);
    return res < 0.0 ? res + 360.0 : res;
}

EMSCRIPTEN_KEEPALIVE
void calculerParametresSiderauxEtSolaires(double timestampSec, double lonDeg, double* metricsPtr) {
    if (!metricsPtr) return;

    double jd = (timestampSec / 86400.0) + 2440587.5;
    double T = (jd - 2451545.0) / 36525.0;

    double l0 = normaliserDegres(280.46646 + 36000.76983 * T);
    double m = normaliserDegres(357.52911 + 35999.05029 * T);
    double c = (1.914602 - 0.004817 * T) * std::sin(m * DEG2RAD) + (0.019993 - 0.000101 * T) * std::sin(2.0 * m * DEG2RAD);
    double sunTrueLong = normaliserDegres(l0 + c);
    double obliquite = 23.439291 - 0.0130042 * T;

    double gast = normaliserDegres(280.46061837 + 360.98564736629 * (jd - 2451545.0) + 0.00038793 * T * T);
    double lst = normaliserDegres(gast + lonDeg);
    double eqTemps = 4.0 * (l0 - 0.0057183 - sunTrueLong); 

    metricsPtr[0] = eqTemps;
    metricsPtr[1] = obliquite;
    metricsPtr[2] = sunTrueLong;
    metricsPtr[3] = gast;
    metricsPtr[4] = lst;
}

EMSCRIPTEN_KEEPALIVE
void obtenirPositionAstreChebyshev(double timestampSec, double* outCoords) {
    if (!outCoords) return;
    outCoords[0] = 0.0;
    outCoords[1] = 0.0;
    outCoords[2] = 0.0;
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

    // Suppression des valeurs de secours : utilisation stricte des valeurs injectées
    if (result->elevGeom > -2.0) {
        double h = std::max(result->elevGeom, -1.0);
        double refArcMin = 1.02 / std::tan((h + 10.3 / (h + 5.1)) * DEG2RAD);
        double facteurMeteoBaro = (presHpa / 1013.25) * (288.15 / (273.15 + tempC));
        result->elevRefractee = result->elevGeom + (refArcMin * facteurMeteoBaro) / 60.0;
    } else {
        result->elevRefractee = result->elevGeom;
    }

    result->airMass = 0.0;
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
    double normR = std::sqrt(xECEF*xECEF + yECEF*yECEF + zECEF*zECEF);
    result->decDeg = (normR > 0.0) ? std::asin(zECEF / normR) * RAD2DEG : 0.0;
    result->ghaDeg = normaliserDegres((eraRad * RAD2DEG) - result->raDeg);

    double decRad = result->decDeg * DEG2RAD;
    double cosH0 = -std::tan(phi) * std::tan(decRad);
    double solarNoonUT = normaliserDegres(12.0 - (lonDeg * 4.0)) / 15.0;

    if (cosH0 < -1.0) {
        result->leverUT = 0.0;
        result->coucherUT = 24.0;
    } else if (cosH0 > 1.0) {
        result->leverUT = 6.0;
        result->coucherUT = 18.0;
    } else {
        double h0Deg = std::acos(cosH0) * RAD2DEG;
        double demiArcJour = h0Deg / 15.0;
        result->leverUT = normaliserDegres((solarNoonUT - demiArcJour) * 15.0) / 15.0;
        result->coucherUT = normaliserDegres((solarNoonUT + demiArcJour) * 15.0) / 15.0;
    }

    double jd = (timestampUtc / 86400.0) + 2440587.5;
    result->jde = jd;
    double sieclesJ2000 = (jd - 2451545.0) / 36525.0;
    result->deltaT = 64.6 + 31.5 * sieclesJ2000 + 65.5 * sieclesJ2000 * sieclesJ2000;

    result->moonPhasePct = 0.0;
    result->moonAgeDays = 0.0;
    result->seasonCode = -1;
    result->visibiliteCode = (result->elevRefractee < 0.0) ? 0 : (result->magnitudeApparente <= 5.5 ? 1 : 2);
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
    calculerDepuisECEF(xECEF, yECEF, zECEF, latDeg, lonDeg, altM, eraRad, timestampUtc, tempC, presHpa, extinctionCoeff, magBruteAstre, estVecteurTopocentrique, result);
}
}
