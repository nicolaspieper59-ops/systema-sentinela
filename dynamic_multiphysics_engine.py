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

    // Correction barométrique et thermique rigoureuse de la réfraction
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
    
    double sieclesJ2000 = (jd - 2451545.0) / 36525.0;
    result->deltaT = 64.6 + 31.5 * sieclesJ2000 + 65.5 * sieclesJ2000 * sieclesJ2000;

    result->moonPhasePct = 0.0;
    result->moonAgeDays = 0.0;
    result->seasonCode = -1;

    if (result->elevRefractee < 0.0) {
        result->visibiliteCode = 0;
    } else {
        if (result->magnitudeApparente <= 5.5) result->visibiliteCode = 1;
        else if (result->magnitudeApparente <= 9.5) result->visibiliteCode = 2;
        else result->visibiliteCode = 3;
    }
}

} // extern "C"
