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
    double azimut;
    double altitude;
};

struct DonneesMeteo {
    double pression_hpa; 
    double temperature_c;   
};

struct ÉlémentsKepler {
    std::string nom;
    double M0;   
    double n;    
    double e;    
};

const std::vector<ÉlémentsKepler> SYSTEME_SOLAIRE = {
    {"SOLEIL", 356.0470, 0.98560025, 0.016709},
    {"LUNE",   135.2708, 13.176358,  0.054900}
};

// Module de réfraction atmosphérique
double corrigerRefraction(double alt_brute, const DonneesMeteo& meteo) {
    if (alt_brute < -0.5) return alt_brute;
    double alt_deg = alt_brute < 0.0 ? 0.0 : alt_brute;
    double cotangente = 1.0 / std::tan((alt_deg + 7.31 / (alt_deg + 4.4)) * (PI / 180.0));
    return alt_brute + ((cotangente / 60.0) * (meteo.pression_hpa / 1013.25) * (288.15 / (273.15 + meteo.temperature_c)));
}

// Moteur de calcul astronomique ponctuel
HorizonCoords calculerPositionAstre(const ÉlémentsKepler& p, double joursJ2000, double latDeg, double lonDeg, double heureUTC, const DonneesMeteo& meteo) {
    double M_rad = (p.M0 + p.n * joursJ2000) * PI / 180.0;
    double lambda_rad = (p.M0 + p.n * joursJ2000 + (2.0 * p.e) * std::sin(M_rad) * 180.0 / PI) * PI / 180.0;
    double obliquite_rad = 23.439 * PI / 180.0;
    double declinaison_rad = std::asin(std::sin(lambda_rad) * std::sin(obliquite_rad));
    double ra_rad = std::atan2(std::sin(lambda_rad) * std::cos(obliquite_rad), std::cos(lambda_rad));

    double tempsSideral = (heureUTC * 15.0) + lonDeg;
    double angleHoraire_rad = (tempsSideral - (ra_rad * 180.0 / PI)) * PI / 180.0;
    double lat_rad = latDeg * PI / 180.0;

    double sin_alt = std::sin(lat_rad) * std::sin(declinaison_rad) + std::cos(lat_rad) * std::cos(declinaison_rad) * std::cos(angleHoraire_rad);
    double altitude_brute = std::asin(sin_alt) * 180.0 / PI;
    double altitude_finale = corrigerRefraction(altitude_brute, meteo);

    double cos_az = (std::sin(declinaison_rad) - std::sin(lat_rad) * sin_alt) / (std::cos(lat_rad) * std::cos(altitude_brute * PI / 180.0));
    if (cos_az > 1.0) cos_az = 1.0; if (cos_az < -1.0) cos_az = -1.0;
    double azimut = std::acos(cos_az) * 180.0 / PI;
    if (std::sin(angleHoraire_rad) > 0) azimut = 360.0 - azimut;

    return { azimut, altitude_finale };
}

int main() {
    double latitude = 43.284565;  // Paramètres géographiques par défaut
    double longitude = 5.358658;
    DonneesMeteo meteoLocale = { 1017.2, 19.5 };

    // Initialisation du serveur réseau HTTP
    int server_fd = socket(AF_INET, SOCK_STREAM, 0);
    int opt = 1; setsockopt(server_fd, SOL_SOCKET, SO_REUSEADDR, &opt, sizeof(opt));
    struct sockaddr_in address; address.sin_family = AF_INET;
    address.sin_addr.s_addr = INADDR_ANY; address.sin_port = htons(8080);
    bind(server_fd, (struct sockaddr*)&address, sizeof(address)); listen(server_fd, 3);

    std::cout << "[INIT] Moteur Sentinela v6.8 de secours prêt sur le port 8080." << std::endl;

    while (true) {
        int new_socket = accept(server_fd, nullptr, nullptr);
        if (new_socket >= 0) {
            char buffer[1024] = {0}; read(new_socket, buffer, 1024);
            std::string requete(buffer);

            if (requete.find("GET /manifest.json") != std::string::npos) {
                // Récupération de la base temporelle du jour à 00:00 UTC
                auto maintenant = std::chrono::system_clock::now();
                time_t temps_c = std::chrono::system_clock::to_time_t(maintenant);
                struct tm* utc = gmtime(&temps_c);
                
                // Calcul de la base J2000 pour aujourd'hui à 00:00 UTC
                double baseJoursJ2000 = (utc->tm_year - 100) * 365.25 + utc->tm_yday - 1.5;

                // Génération de la matrice JSON de 1440 minutes exigée par l'interface v6.8
                std::string json = "{\n  \"SOLEIL\": [\n";
                for (int m = 0; m < 1440; ++m) {
                    double heureUTC = m / 60.0;
                    double joursJ2000 = baseJoursJ2000 + (heureUTC / 24.0);
                    HorizonCoords coords = calculerPositionAstre(SYSTEME_SOLAIRE[0], joursJ2000, latitude, longitude, heureUTC, meteoLocale);
                    
                    json += "    {\"az\": " + std::to_string(coords.azimut) + ", \"alt\": " + std::to_string(coords.altitude) + "}";
                    if (m < 1439) json += ",\n";
                }
                
                json += "\n  ],\n  \"LUNE\": [\n";
                for (int m = 0; m < 1440; ++m) {
                    double heureUTC = m / 60.0;
                    double joursJ2000 = baseJoursJ2000 + (heureUTC / 24.0);
                    HorizonCoords coords = calculerPositionAstre(SYSTEME_SOLAIRE[1], joursJ2000, latitude, longitude, heureUTC, meteoLocale);
                    
                    json += "    {\"az\": " + std::to_string(coords.azimut) + ", \"alt\": " + std::to_string(coords.altitude) + "}";
                    if (m < 1439) json += ",\n";
                }
                json += "\n  ]\n}";

                // Sauvegarde physique locale au cas où le rafraîchissement se fait par fichier
                std::ofstream f("manifest.json");
                if (f.is_open()) { f << json; f.close(); }

                // Réponse réseau HTTP avec en-têtes CORS pour éliminer les blocages du navigateur
                std::string reponse = "HTTP/1.1 200 OK\r\n"
                                      "Content-Type: application/json\r\n"
                                      "Access-Control-Allow-Origin: *\r\n"
                                      "Connection: close\r\n\r\n" + json;
                write(new_socket, reponse.c_str(), reponse.length());
            } else {
                // Si requête racine, renvoyer un statut textuel générique
                std::string reponse_html = "HTTP/1.1 200 OK\r\nContent-Type: text/plain\r\n\r\nSentinela Engine Active. Target /manifest.json";
                write(new_socket, reponse_html.c_str(), reponse_html.length());
            }
            close(new_socket);
        }
        std::this_thread::sleep_for(std::chrono::milliseconds(5));
    }
    close(server_fd); return 0;
}
