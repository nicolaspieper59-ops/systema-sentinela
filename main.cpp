#include <fstream>
#include <iostream>
#include <cmath>
#include <chrono>
#include <thread>
#include <string>
#include <sstream>
#include <vector>
#include <sys/socket.h>
#include <netinet/in.h>
#include <unistd.h>

const double PI = 3.14159265358979323846;

struct HorizonCoords {
    std::string nom;
    double azimut;
    double altitude;
    double ra_deg;   // Ajout pour compatibilité v6.8
    double dec_deg;  // Ajout pour compatibilité v6.8
    std::string symbole;
};

struct DonneesMeteo {
    double pression_hpa; 
    double temperature_c;   
};

struct ÉlémentsKepler {
    std::string nom;
    std::string symbole;
    double M0;   
    double n;    
    double e;    
    double long_perihélie; 
};

// Base de données Keplerienne - Alignée sur les éphémérides de référence
const std::vector<ÉlémentsKepler> SYSTEME_SOLAIRE = {
    {"SOLEIL",  "☀️", 356.0470, 0.98560025, 0.016709, 102.9404},
    {"LUNE",    "🌙", 135.2708, 13.176358,  0.054900, 318.1500}, // Modélisation lunaire 33% phase
    {"MERCURE", "🪐", 174.7948, 4.09233444, 0.205630, 77.4561},
    {"VENUS",   "⭐", 50.1166,  1.60213034, 0.006772, 131.5637},
    {"MARS",    "🔴", 19.3881,  0.52402076, 0.093412, 336.0600},
    {"JUPITER", "🌌", 20.0202,  0.08308530, 0.048393, 14.3313},
    {"SATURNE", "🪐", 316.9670, 0.03344423, 0.054150, 92.8588}
};

// MODULE 2 : RÉFRACTION ATMOSPHÉRIQUE BAROMÉTRIQUE & THERMIQUE
double corrigerRefractionAtmospherique(double alt_brute, const DonneesMeteo& meteo) {
    if (alt_brute < -0.5) return alt_brute;
    double alt_deg = alt_brute < 0.0 ? 0.0 : alt_brute;
    
    // Équation de la cotangente corrigée par la densité de la colonne d'air locale
    double cotangente = 1.0 / std::tan((alt_deg + 7.31 / (alt_deg + 4.4)) * (PI / 180.0));
    double facteur_pression = meteo.pression_hpa / 1013.25;
    double facteur_temperature = 288.15 / (273.15 + meteo.temperature_c); 
    
    double refraction_minutes = (cotangente / 60.0) * facteur_pression * facteur_temperature;
    return alt_brute + refraction_minutes;
}

// Extraction automatique des coordonnées GPS du smartphone via Termux API
void interrogerCapteurGPS(double& lat, double& lon) {
    std::string cmd = "termux-location -p last -s network > gps.txt 2>/dev/null";
    if (std::system(cmd.c_str()) == 0) {
        std::ifstream fichier("gps.txt");
        std::string ligne;
        while (std::getline(fichier, ligne)) {
            size_t pLat = ligne.find("\"latitude\":");
            size_t pLon = ligne.find("\"longitude\":");
