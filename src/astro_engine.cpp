#include <emscripten/emscripten.h>
#include <cmath>
#include <algorithm>
#include <cstdint>

#ifndef M_PI
#define M_PI 3.14159265358979323846
#endif

#define DEG2RAD (M_PI / 180.0)
#define RAD2DEG (180.0 / M_PI)
#define UA_EN_METRES 149597870700.0
#define VITESSE_LUMIERE_M_S 299792458.0

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
    double moonAgeDays;        
    double crepusculeUT;       
    double dureeJourHeures;    
    double angularDiamArcsec;  
    double surfaceBrightness;  
    double illuminatedFraction;
    double radialVelocityKmS;  
    int32_t visibiliteCode;    
    int32_t seasonCode;        
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

    double eps0Arcsec = 84381.448 - 46.8150 * T - 0.00059 * T * T + 0.001813 * T * T * T;
    double obliquiteDeg = eps0Arcsec / 3600.0;

    double du = jd - 2451545.0;
    double eraRad = 2.0 * M_PI * (0.7790572732640 + 1.00273781191135448 * du);
    double eraDeg = normaliserDegres(eraRad * RAD2DEG);

    double gastDeg = normaliserDegres(eraDeg + (0.00264 * std::sin((125.04 - 1934.136 * T) * DEG2RAD)));
    double lstDeg = normaliserDegres(gastDeg + lonDeg);

    double l0 = normaliserDegres(280.46646 + 36000.76983 * T);
    double m = normaliserDegres(357.52911 + 35999.05029 * T);
    double c = (1.914602 - 0.004817 * T) * std::sin(m * DEG2RAD) + (0.019993 - 0.000101 * T) * std::sin(2.0 * m * DEG2RAD);
    double sunTrueLong = normaliserDegres(l0 + c);

    double y = std::tan((obliquiteDeg / 2.0) * DEG2RAD);
    y *= y;
    double l0Rad = l0 * DEG2RAD;
    double mRad = m * DEG2RAD;
    double eqTempsRad = y * std::sin(2.0 * l0Rad) - 2.0 * 0.016708634 * std::sin(mRad) 
                        + 4.0 * 0.016708634 * y * std::sin(mRad) * std::cos(2.0 * l0Rad) 
                        - 0.5 * y * y * std::sin(4.0 * l0Rad);

    metricsPtr[0] = (eqTempsRad * RAD2DEG) * 4.0; // Minutes
    metricsPtr[1] = obliquiteDeg;
    metricsPtr[2] = sunTrueLong;
    metricsPtr[3] = gastDeg;
    metricsPtr[4] = lstDeg;
}

EMSCRIPTEN_KEEPALIVE
void calculerDepuisECEF(
    double xICRF_km, double yICRF_km, double zICRF_km,
    double latDeg, double lonDeg, double altM,
    double eraRad, double tempC, double presHpa, double extinctionCoeff,
    double magBruteAstre,
    AstroResult* result
) {
    if (!result) return;

    double xI = xICRF_km * 1000.0;
    double yI = yICRF_km * 1000.0;
    double zI = zICRF_km * 1000.0;

    double normICRF = std::sqrt(xI * xI + yI * yI + zI * zI);
    result->raDeg = normaliserDegres(std::atan2(yI, xI) * RAD2DEG);
    result->decDeg = (normICRF > 0.0) ? std::asin(std::max(-1.0, std::min(1.0, zI / normICRF))) * RAD2DEG : 0.0;
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

    if (result->elevGeom > -0.5) {
        double h = std::max(result->elevGeom, -0.5);
        double refArcMin = 1.02 / std::tan((h + 10.3 / (h + 5.11)) * DEG2RAD);
        double facteurMeteo = (presHpa / 1013.25) * (283.15 / (273.15 + tempC));
        result->elevRefractee = result->elevGeom + (refArcMin * facteurMeteo) / 60.0;
    } else {
        result->elevRefractee = result->elevGeom;
    }

    if (result->elevRefractee > 0.0) {
        double sinH = std::sin(std::max(0.01, result->elevRefractee) * DEG2RAD);
        result->airMass = 1.0 / (sinH + 0.025 * std::exp(-11.0 * sinH));
    } else {
        result->airMass = 40.0;
    }

    result->magnitudeApparente = magBruteAstre + (extinctionCoeff * result->airMass);
    result->irradiance = (result->elevRefractee > 0.0) ? 1361.0 * std::pow(0.7, result->airMass) / (result->distUA * result->distUA) : 0.0;
    result->shadowLength = (result->elevRefractee > 0.0) ? 1.0 / std::tan(std::max(1e-4, result->elevRefractee * DEG2RAD)) : -1.0;

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
