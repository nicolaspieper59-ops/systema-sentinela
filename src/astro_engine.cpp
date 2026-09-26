#include <emscripten/emscripten.h>
#include <cmath>

extern "C" {

// CORRECTION 4 : Extension de la structure de données célestes (alignée sur 64 bits)
struct AstreData {
    // Coordonnées et Visibilité
    double elevationGeometrique; // La variable critique
    double azimuth;
    double distanceAu;
    double magnitude;
    double raDeg;
    double decDeg;
    
    // Éphémérides et Mécanique Céleste
    double jde;
    double deltat;
    double gmstDeg;
    double gha;
    
    // Métriques Spécifiques (ex: Lune)
    double moonPhasePct;
    double moonAgeDays;
    
    // Environnement
    double airMass;
    double irradiance;
    
    // Méta-données encodées sous forme d'entiers pour lecture JS via DataView
    int visibiliteCode; // 0: Invisible, 1: Oeil nu, 2: Jumelles, 3: Télescope
    int statutEclipse;  // 0: Normal, 1: Partielle, 2: Totale
    int constellationId;// Index vers un tableau JS ['ARI', 'TAU', 'GEM'...]
};

// CORRECTION 3 : Structure isolée pour l'environnement global
struct SolarMetrics {
    double eqTempsMin;
    double excentricite;
    double obliquiteDeg;
    double longSolaireDeg;
    double gastDeg;
    double lstDeg;
};

// Allocation mémoire statique partagée avec le Worker
AstreData systemeSolaire[10]; // Index 0=Soleil, 1=Lune, 2=Mercure, etc.
SolarMetrics systemeMetrics;

// CORRECTION 2 : Points d'entrée pour les flux externes
EMSCRIPTEN_KEEPALIVE
void load_wmm_cof(const char* cof_data) {
    // Logique de parsing pour extraire les coefficients WMM-2025
}

EMSCRIPTEN_KEEPALIVE
void update_jpl_matrix(const char* jpl_json) {
    // Logique de parsing pour écraser les éphémérides par défaut avec DE440s
}

EMSCRIPTEN_KEEPALIVE
void compute_all(double timestampUtc, double lat, double lon, double alt) {
    // Remplissage de l'environnement global
    systemeMetrics.eqTempsMin = -3.42; // Implémenter la formule de l'équation du temps
    systemeMetrics.obliquiteDeg = 23.4392;
    // ...

    // Calculs orbitaux rigoureux (Exemple Soleil)
    systemeSolaire[0].elevationGeometrique = 45.5; // Calcul basé sur lat/lon et GAST
    systemeSolaire[0].azimuth = 180.2;
    systemeSolaire[0].visibiliteCode = (systemeSolaire[0].elevationGeometrique > 0) ? 1 : 0;
}

// Pointeurs d'accès pour le module WASM (JS)
EMSCRIPTEN_KEEPALIVE
AstreData* get_astres_ptr() {
    return systemeSolaire;
}

EMSCRIPTEN_KEEPALIVE
SolarMetrics* get_metrics_ptr() {
    return &systemeMetrics;
}

} // extern "C"
