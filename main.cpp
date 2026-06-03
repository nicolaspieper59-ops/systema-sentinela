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
            if (pLat != std::string::npos) lat = std::stod(ligne.substr(pLat + 11));
            if (pLon != std::string::npos) lon = std::stod(ligne.substr(pLon + 12));
        }
    }
}

HorizonCoords calculerCoordonnees(const ÉlémentsKepler& p, double joursJ2000, double latDeg, double lonDeg, double heureUTC, const DonneesMeteo& meteo) {
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

    // Application de la matrice de réfraction barométrique
    double altitude_finale = corrigerRefractionAtmospherique(altitude_brute, meteo);

    double cos_az = (std::sin(declinaison_rad) - std::sin(lat_rad) * sin_alt) / (std::cos(lat_rad) * std::cos(altitude_brute * PI / 180.0));
    if (cos_az > 1.0) cos_az = 1.0; if (cos_az < -1.0) cos_az = -1.0;
    double azimut = std::acos(cos_az) * 180.0 / PI;
    if (std::sin(angleHoraire_rad) > 0) azimut = 360.0 - azimut;

    return { p.nom, azimut, altitude_finale, p.symbole };
}

int main() {
    // Coordonnées de base (Marseille - Fallback si pas de signal)
    double latitude = 43.284565;
    double longitude = 5.358658;
    interrogerCapteurGPS(latitude, longitude);

    // Initialisation des données météo barométriques
    DonneesMeteo meteoLocale = { 1017.2, 19.5 }; // 1017.2 hPa, 19.5°C au sol

int new_socket = accept(server_fd, nullptr, nullptr);
        if (new_socket >= 0) {
            char buffer[1024] = {0}; read(new_socket, buffer, 1024);

            auto maintenant = std::chrono::system_clock::now();
            time_t temps_c = std::chrono::system_clock::to_time_t(maintenant);
            struct tm* utc = gmtime(&temps_c);
            double heureUTC = utc->tm_hour + utc->tm_min / 60.0 + utc->tm_sec / 3600.0;
            double joursJ2000 = (utc->tm_year - 100) * 365.25 + utc->tm_yday + (heureUTC / 24.0) - 1.5;

            std::string cartes_html = "";
            std::string json_flux = "{\n";

            for (size_t i = 0; i < SYSTEME_SOLAIRE.size(); ++i) {
                const auto& p = SYSTEME_SOLAIRE[i];
                HorizonCoords astre = calculerCoordonnees(p, joursJ2000, latitude, longitude, heureUTC, meteoLocale);
                
                // 1. Génération du HTML pour le Cockpit HUD v8.0
                std::string vue = (astre.altitude > 0) ? "<span style='color:#2ea043;font-weight:bold;'>🟢 VISIBLE</span>" : "<span style='color:#8b949e;'>🔴 HORIZON INF</span>";
                cartes_html += "<div class='card'>"
                               "<h3>" + astre.symbole + " " + astre.nom + " <span class='status'>" + vue + "</span></h3>"
                               "<div class='data'>🧭 AZIMUT : " + std::to_string(astre.azimut) + "°</div>"
                               "<div class='data'>📐 ALTITUDE : " + std::to_string(astre.altitude) + "° <small>(Baro-corrigée)</small></div>"
                               "</div>";

                // 2. Construction de la matrice JSON pour l'interface v6.8 (Uniquement SOLEIL et LUNE)
                if (astre.nom == "SOLEIL" || astre.nom == "LUNE") {
                    json_flux += "  \"" + astre.nom + "\": {\n";
                    json_flux += "    \"h\": " + std::to_string(astre.altitude) + ",\n";
                    json_flux += "    \"Az\": " + std::to_string(astre.azimut) + "\n";
                    json_flux += "  }";
                    if (astre.nom == "SOLEIL") json_flux += ",\n"; // Virgule de séparation standard
                    else json_flux += "\n";
                }
            }
            json_flux += "}";

            // Écriture immédiate du manifeste mis à jour sur le stockage local
            std::ofstream fichier_manifest("manifest.json");
            if (fichier_manifest.is_open()) {
                fichier_manifest << json_flux;
                fichier_manifest.close();
            }

            // Envoi de la réponse HTML au navigateur (Cockpit HUD)
            std::string html = 
                "HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=UTF-8\r\n\r\n"
                "<html><head><meta http-equiv='refresh' content='0.2'>"
                "<style>body{background:#0d1117;color:#c9d1d9;font-family:monospace;padding:20px;text-align:center;}"
                "h1{color:#58a6ff;margin-bottom:2px;} .hud-bar{background:#161b22;border:1px solid #30363d;padding:12px 25px;display:inline-block;border-radius:30px;font-size:12px;color:#8b949e;margin-bottom:25px;box-shadow:0 4px 10px rgba(0,0,0,0.4);}"
                ".card{border:1px solid #30363d;background:#161b22;padding:15px;margin:12px auto;width:440px;border-radius:10px;text-align:left;box-shadow:0 2px 5px rgba(0,0,0,0.2);}"
                ".card h3{margin:0 0 12px 0;color:#58a6ff;font-size:16px;border-bottom:1px solid #21262d;padding-bottom:6px;display:flex;justify-content:space-between;align-items:center;}"
                ".data{font-size:15px;margin:6px 0;color:#e6edf3;} small{color:#8b949e;font-size:11px;}</style></head>"
                "<body>"
                "<h1>SYSTEMA SENTINELA v8.0</h1>"
                "<div class='hud-bar'>📍 LAT " + std::to_string(latitude) + " | LON " + std::to_string(longitude) + " &nbsp;&nbsp;|&nbsp;&nbsp; 🌀 " + std::to_string(meteoLocale.pression_hpa) + " hPa &nbsp;&nbsp;|&nbsp;&nbsp; 🌡️ " + std::to_string(meteoLocale.temperature_c) + "°C</div>"
                + cartes_html +
                "</body></html>";

            write(new_socket, html.c_str(), html.length());
            close(new_socket);
        }
        std::this_thread::sleep_for(std::chrono::milliseconds(10));
    }
    close(server_fd); return 0;
}
