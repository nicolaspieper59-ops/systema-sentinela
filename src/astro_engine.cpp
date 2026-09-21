#include <emscripten/emscripten.h>
#include <cmath>
#include <algorithm>

#ifndef M_PI
#define M_PI 3.14159265358979323846
#endif

#define DEG2RAD (M_PI / 180.0)
#define RAD2DEG (180.0 / M_PI)

// Structure mémoire 64-bit alignée pour transfert Zero-Copy (104 octets)
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
    int visibiliteCode;   
    int padding;          
};

struct SystemMetrics {
    double eqTempsMin;     
    double obliquiteDeg;   
    double longSolaireDeg; 
    double gastDeg;        
    double lstDeg;         
};

extern "C" {

EMSCRIPTEN_KEEPALIVE
inline double normaliserDegres(double deg) {
    double res = std::fmod(deg, 360.0);
    return res < 0.0 ? res + 360.0 : res;
}

// Evaluation rigoureuse de Clenshaw pour séries Chebyshev NumPy
double evaluerChebyshev(const double* coeffs, int degre, double xNorm) {
    double b2 = 0.0;
    double b1 = 0.0;
    double b0 = 0.0;
    
    for (int i = degre; i >= 1; --i) {
        b0 = coeffs[i] + 2.0 * xNorm * b1 - b2;
        b2 = b1;
        b1 = b0;
    }
    return coeffs[0] + xNorm * b1 - b2;
}

EMSCRIPTEN_KEEPALIVE
void obtenirPositionAstreChebyshev(
    double timestamp,
    const double* coeffsX, const double* coeffsY, const double* coeffsZ,
    int degre, double tStart, double tEnd,
    double* outCoords
) {
    if (!outCoords || timestamp < tStart || timestamp > tEnd) return;
    double xNorm = (tStart == tEnd) ? 0.0 : (2.0 * (timestamp - tStart) / (tEnd - tStart) - 1.0);
    
    outCoords[0] = evaluerChebyshev(coeffsX, degre, xNorm);
    outCoords[1] = evaluerChebyshev(coeffsY, degre, xNorm);
    outCoords[2] = evaluerChebyshev(coeffsZ, degre, xNorm);
}

EMSCRIPTEN_KEEPALIVE
void calculerParametresSiderauxEtSolaires(
    double timestampSec,
    double lonDeg,
    SystemMetrics* metrics
) {
    if (!metrics) return;

    double jd = (timestampSec / 86400.0) + 2440587.5;
    double d = jd - 2451545.0; 
    double T = d / 36525.0;    

    double L0 = normaliserDegres(280.46646 + 36000.76983 * T);
    double M = normaliserDegres(357.52911 + 35999.05029 * T);
    double MRad = M * DEG2RAD;

    double C = (1.914602 - 0.004817 * T) * std::sin(MRad) + (0.019993 - 0.000101 * T) * std::sin(2.0 * MRad);
    double sunLong = L0 + C;
    metrics->longSolaireDeg = normaliserDegres(sunLong);

    double eps = 23.4392911 - 0.0130042 * T;
    metrics->obliquiteDeg = eps;

    double alpha = normaliserDegres(std::atan2(std::cos(eps * DEG2RAD) * std::sin(sunLong * DEG2RAD), std::cos(sunLong * DEG2RAD)) * RAD2DEG);

    double eqTempsDeg = L0 - alpha;
    if (eqTempsDeg > 180.0) eqTempsDeg -= 360.0;
    if (eqTempsDeg < -180.0) eqTempsDeg += 360.0;
    metrics->eqTempsMin = eqTempsDeg * 4.0;

    double gmst = 280.46061837 + 360.98564736629 * d + 0.000387933 * T * T;
    double omega = (125.04 - 1934.136 * T) * DEG2RAD;
    double dPsi = -0.0048 * std::sin(omega); 
    
    metrics->gastDeg = normaliserDegres(gmst + dPsi * std::cos(eps * DEG2RAD));
    metrics->lstDeg = normaliserDegres(metrics->gastDeg + lonDeg);
}

EMSCRIPTEN_KEEPALIVE
void calculerDepuisECEF(
    double xECEF, double yECEF, double zECEF,
    double latDeg, double lonDeg, double altM,
    double eraRad, double timestampUtc,
    double tempC, double presHpa,
    double magApparente,
    bool estVecteurTopocentrique,
    AstroResult* result
) {
    if (!result) return;

    double phi = latDeg * DEG2RAD;
    double lambda = lonDeg * DEG2RAD;
    
    double a = 6378137.0;
    double f = 1.0 / 298.257223563;
    double e2 = f * (2.0 - f);

    double dx = xECEF;
    double dy = yECEF;
    double dz = zECEF;

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

    if (result->elevGeom > -2.0) {
        double h = std::max(result->elevGeom, -1.0);
        double refArcMin = 1.02 / std::tan((h + 10.3 / (h + 5.1)) * DEG2RAD);
        double corMeteo = (presHpa / 1013.25) * (288.15 / (273.15 + tempC));
        result->elevRefractee = result->elevGeom + (refArcMin * corMeteo) / 60.0;
    } else {
        result->elevRefractee = result->elevGeom;
    }

    double lonTerrestreDeg = std::atan2(yECEF, xECEF) * RAD2DEG;
    result->raDeg = normaliserDegres(lonTerrestreDeg + (eraRad * RAD2DEG));
    
    double normR = std::sqrt(xECEF*xECEF + yECEF*yECEF + zECEF*zECEF);
    result->decDeg = (normR > 0.0) ? std::asin(zECEF / normR) * RAD2DEG : 0.0;

    // Angle Horaire de Greenwich (GHA)
    result->ghaDeg = normaliserDegres((eraRad * RAD2DEG) - result->raDeg);

    // Delta T (Polynome Espenak-Meeus)
    double jd = (timestampUtc / 86400.0) + 2440587.5;
    double t = (2000.0 + (jd - 2451545.0) / 365.25) - 2000.0;
    result->deltaT = 62.92 + 0.32217 * t + 0.005589 * (t * t);

    // Air Mass & Irradiance adaptative
    result->airMass = 0.0;
    result->irradiance = 0.0;
    if (result->elevRefractee > 0.0) {
        double sinH = std::sin(std::max(0.01, result->elevRefractee) * DEG2RAD);
        result->airMass = 1.0 / (sinH + 0.025 * std::exp(-11.0 * sinH));
        
        if (magApparente < -20.0) { // Flux solaire direct
            result->irradiance = (1361.0 / (result->distUA * result->distUA)) * std::pow(0.7, result->airMass);
        } else { // Photons réfléchis (Lune/Planètes)
            result->irradiance = 2.54e-8 * std::pow(10.0, -0.4 * (magApparente + 0.2 * result->airMass));
        }
    }

    // Lever / Coucher analytique local
    double h0 = -0.8333 * DEG2RAD;
    double cosH0 = (std::sin(h0) - std::sin(phi) * std::sin(result->decDeg * DEG2RAD)) / 
                   (std::cos(phi) * std::cos(result->decDeg * DEG2RAD));

    if (cosH0 >= 1.0) {
        result->leverUT = -1.0;  // Nuit polaire
        result->coucherUT = -1.0;
    } else if (cosH0 <= -1.0) {
        result->leverUT = -2.0;  // Jour polaire
        result->coucherUT = -2.0;
    } else {
        double H0Deg = std::acos(cosH0) * RAD2DEG;
        result->leverUT = normaliserDegres(360.0 - H0Deg - (lonDeg + (eraRad * RAD2DEG) - result->raDeg)) / 15.0;
        result->coucherUT = normaliserDegres(H0Deg - (lonDeg + (eraRad * RAD2DEG) - result->raDeg)) / 15.0;
    }

    if (result->elevRefractee < 0.0) {
        result->visibiliteCode = 0;
    } else {
        double magEff = magApparente + (0.2 * result->airMass);
        if (magEff <= 5.5) result->visibiliteCode = 1;
        else if (magEff <= 9.5) result->visibiliteCode = 2;
        else result->visibiliteCode = 3;
    }
}

}
