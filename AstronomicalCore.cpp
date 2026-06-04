#include <iostream>
#include <cmath>
#include <string>

const double PI = 3.14159265358979323846;
const double RAYON_TERRE_KM = 6378.137;
const double DISTANCE_LUNE_KM = 384400.0;

struct PositionTopocentrique {
    double latitude;
    double longitude;
    double altitude_metres;
};

// 1. CORRECTION DE LA RÉFRACTION EN FONCTION DE L'ALTITUDE (GROTTE VS MONTAGNE)
double calculerRefractionDynamique(double altitude_brute_deg, double altitude_observateur_m) {
    if (altitude_brute_deg < -0.5) return altitude_brute_deg; // L'astre est trop bas

    // Équation de nivellement barométrique : la pression diminue avec l'altitude
    // P0 = 1013.25 hPa au niveau de la mer. En montagne la pression baisse, en grotte elle augmente.
    double pression_hpa = 1013.25 * std::pow(1.0 - (0.0065 * altitude_observateur_m) / 288.15, 5.255);
    double temperature_kelvin = 288.15 - (0.0065 * altitude_observateur_m);

    double cotangente = 1.0 / std::tan((altitude_brute_deg + 7.31 / (altitude_brute_deg + 4.4)) * (PI / 180.0));
    double correction_arcmin = (cotangente / 60.0) * (pression_hpa / 1013.25) * (288.15 / temperature_kelvin);

    return altitude_brute_deg + correction_arcmin;
}

// 2. CORRECTION DE LA PARALLAXE DE LA LUNE SELON L'ALTITUDE
// Plus l'observateur s'élève sur une montagne, plus sa distance relative à la Lune change
double appliquerParallaxeLune(double altitude_apparente_deg, const PositionTopocentrique& obs) {
    double rayon_local = RAYON_TERRE_KM + (obs.altitude_metres / 1000.0);
    
    // Calcul de la parallaxe horizontale équatoriale
    double pi_parallaxe = std::asin(RAYON_TERRE_KM / DISTANCE_LUNE_KM);
    
    // Correction de l'altitude observée
    double altitude_rad = altitude_apparente_deg * PI / 180.0;
    double correction_parallaxe = pi_parallaxe * std::cos(altitude_rad) * (rayon_local / RAYON_TERRE_KM);
    
    return altitude_apparente_deg - (correction_parallaxe * 180.0 / PI);
}

int main() {
    // Exemple d'application : Comparaison d'un astre observé au niveau de la mer vs en montagne
    PositionTopocentrique plageMarseille = { 43.28, 5.36, 0.0 };
    PositionTopocentrique sommetMontagne = { 43.28, 5.36, 3000.0 };

    double altitude_visée_brute = 5.0; // L'astre est bas sur l'horizon (sensible à la réfraction)

    std::cout << "--- ANALYSE DE RÉFRACTION ATMOSPHÉRIQUE REALISTE ---" << std::endl;
    std::cout << "Altitude brute de l'astre : " << altitude_visée_brute << "°" << std::endl;
    std::cout << "Position Corrigée au niveau de la mer : " 
              << calculerRefractionDynamique(altitude_visée_brute, plageMarseille.altitude_metres) << "°" << std::endl;
    std::cout << "Position Corrigée au sommet (3000m)   : " 
              << calculerRefractionDynamique(altitude_visée_brute, sommetMontagne.altitude_metres) << "°" << std::endl;

    return 0;
}
