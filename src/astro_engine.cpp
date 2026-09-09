/**
 * ============================================================================
 * SYSTEMA SENTINELA — KERNEL C++ WEBMASSEMBLY (ASTROMÉTRIE & CHEBYSHEV)
 * Version rigoureuse optimisée v18.8
 * ============================================================================
 */

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
    int visibiliteCode;   
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

// Évaluation d'une série de Chebyshev par l'algorithme de Clenshaw
double evaluerChebyshev(const double* coeffs, int degre, double xNorm) {
    double b2 = 0.0;
    double b1 = 0.0;
    double b0 = 0.0;
    
    for (int i = degre; i >= 1; --i) {
        b0 = 2.0 * xNorm * b1 - b2 + coeffs[i];
        b2 = b1;
        b1 = b0;
    }
    return xNorm * b1 - b2 + (coeffs[0] * 0.5);
}

EMSCRIPTEN_KEEPALIVE
void obtenirPositionAstreChebyshev(
    double timestamp,
    const double* coeffsX, const double* coeffsY, const double* coeffsZ,
    int degre, double tStart, double tEnd,
    double* outCoords
) {
    if (!outCoords || timestamp < tStart || timestamp > tEnd) return;
    
    double tMin = tStart;
    double tMax = tEnd;
    double xNorm = (tMin == tMax) ? 0.0 : (2.0 * (timestamp - tMin) / (tMax - tMin) - 1.0);
    
    outCoords[0] = evaluerChebyshev(coeffsX, degre, xNorm);
    outCoords[1] = evaluerChebyshev(coeffsY, degre, xNorm);
    outCoords[2] = evaluerChebyshev(coeffsZ, degre, xNorm);
}

EMSCRIPTEN_KEEPALIVE
void calculerParametresSiderauxEtSolaires(
    double timestampUtc,
    double lonDeg,
    SystemMetrics* metrics
) {
    if (!metrics) return;

    double jd = (timestampUtc / 86400.0) + 2440587.5;
    double d = jd - 2451545.0; 
    double T = d / 36525.0;    

    double L0 = std::fmod(280.46646 + 36000.76983 * T, 360.0);
    if (L0 < 0.0) L0 += 360.0;

    double M = std::fmod(357.52911 + 35999.05029 * T, 360.0);
    if (M < 0.0) M += 360.0;
    double MRad = M * DEG2RAD;

    double C = (1.914602 - 0.004817 * T) * std::sin(MRad) + (0.019993 - 0.000101 * T) * std::sin(2.0 * MRad);
    double sunLong = L0 + C;
    metrics->longSolaireDeg = normaliserDegres(sunLong);

    double eps = 23.4392911 - 0.0130042 * T;
    metrics->obliquiteDeg = eps;

    double sunLongRad = metrics->longSolaireDeg * DEG2RAD;
    double epsRad = eps * DEG2RAD;
    double y = std::cos(epsRad) * std::sin(sunLongRad);
    double x = std::cos(sunLongRad);
    double alpha = std::atan2(y, x) * RAD2DEG;
    alpha = normaliserDegres(alpha);

    double eqTempsDeg = L0 - alpha;
    if (eqTempsDeg > 180.0) eqTempsDeg -= 360.0;
    if (eqTempsDeg < -180.0) eqTempsDeg += 360.0;
    metrics->eqTempsMin = eqTempsDeg * 4.0;

    double gmst = 280.46061837 + 360.98564736629 * d + 0.000387933 * T * T - (T * T * T) / 38710000.0;
    metrics->gastDeg = normaliserDegres(gmst);
    metrics->lstDeg = normaliserDegres(metrics->gastDeg + lonDeg);
}

EMSCRIPTEN_KEEPALIVE
void calculerDepuisECEF(
    double xECEF, double yECEF, double zECEF,
    double latDeg, double lonDeg, double altM,
    double eraRad,
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

    // Modèle de réfraction de Bennett
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
    
    result->leverUT = 0.0;
    result->coucherUT = 0.0;

    if (result->elevRefractee < 0.0) {
        result->visibiliteCode = 0;
    } else {
        double sinH = std::sin(std::max(0.01, result->elevRefractee) * DEG2RAD);
        double airMass = 1.0 / (sinH + 0.025 * std::exp(-11.0 * sinH));
        double magEff = magApparente + (0.2 * airMass);

        if (magEff <= 5.5) result->visibiliteCode = 1;
        else if (magEff <= 9.5) result->visibiliteCode = 2;
        else result->visibiliteCode = 3;
    }
}

}

int main() {
    return 0;
}
