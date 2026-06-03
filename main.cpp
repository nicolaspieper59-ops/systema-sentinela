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
#include <signal.h>
#include <sys/time.h>

const double PI = 3.14159265358979323846;

struct HorizonCoords {
    std::string nom;
    double azimut;
    double altitude;
    double ra_deg;   
    double dec_deg;  
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

const std::vector<ÉlémentsKepler> SYSTEME_SOLAIRE = {
    {"SOLEIL",  "☀️", 356.0470, 0.98560025, 0.016709, 102.9404},
    {"LUNE",    "🌙", 135.2708, 13.176358,  0.054900, 318.1500}, 
    {"MERCURE", "🪐", 174.7948, 4.09233444, 0.205630, 77.4561},
    {"VENUS",   "⭐", 50.1166,  1.60213034, 0.006772, 131.5637},
    {"MARS",    "🔴", 19.3881,  0.52402076, 0.093412, 336.0600},
    {"JUPITER", "🌌", 20.0202,  0.08308530, 0.048393, 14.3313},
    {"SATURNE", "🪐", 316.9670, 0.03344423, 0.054150, 92.8588}
};

double corrigerRefractionAtmospherique(double alt_brute, const DonneesMeteo& meteo) {
    if (alt_brute < -0.5) return alt_brute;
    double alt_deg = alt_brute < 0.0 ? 0.0 : alt_brute;
    double cotangente = 1.0 / std::tan((alt_deg + 7.31 / (alt_deg + 4.4)) * (PI / 180.0));
    return alt_brute + ((cotangente / 60.0) * (meteo.pression_hpa / 1013.25) * (288.15 / (273.15 + meteo.temperature_c)));
}

void interrogerCapteurGPS(double& lat, double& lon) {
    std::string cmd = "timeout 2 termux-location -p last -s network > gps.txt 2>/dev/null";
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
    double altitude_finale = corrigerRefractionAtmospherique(altitude_brute, meteo);

    double cos_az = (std::sin(declinaison_rad) - std::sin(lat_rad) * sin_alt) / (std::cos(lat_rad) * std::cos(altitude_brute * PI / 180.0));
    if (cos_az > 1.0) cos_az = 1.0; if (cos_az < -1.0) cos_az = -1.0;
    double azimut = std::acos(cos_az) * 180.0 / PI;
    if (std::sin(angleHoraire_rad) > 0) azimut = 360.0 - azimut;

    return { p.nom, azimut, altitude_finale, ra_rad * 180.0 / PI, declinaison_rad * 180.0 / PI, p.symbole };
}

int main() {
    signal(SIGPIPE, SIG_IGN);

    double latitude = 43.284565;
    double longitude = 5.358658;
    interrogerCapteurGPS(latitude, longitude);
    DonneesMeteo meteoLocale = { 1017.2, 19.5 };

    auto maintenant = std::chrono::system_clock::now();
    time_t temps_c = std::chrono::system_clock::to_time_t(maintenant);
    struct tm* utc = gmtime(&temps_c);
    double baseJoursJ2000 = (utc->tm_year - 100) * 365.25 + utc->tm_yday - 1.5;

    std::string json_cache = "{\n";
    for (size_t i = 0; i < SYSTEME_SOLAIRE.size(); ++i) {
        const auto& p = SYSTEME_SOLAIRE[i];
        json_cache += "  \"" + p.nom + "\": [\n";
        for (int m = 0; m < 1440; ++m) {
            double heureUTC = m / 60.0;
            double joursJ2000 = baseJoursJ2000 + (heureUTC / 24.0);
            HorizonCoords astre = calculerCoordonnees(p, joursJ2000, latitude, longitude, heureUTC, meteoLocale);
            json_cache += "    {\"az\": " + std::to_string(astre.azimut) + ", \"alt\": " + std::to_string(astre.altitude) + "}";
            if (m < 1439) json_cache += ",\n";
        }
        json_cache += "\n  ]";
        if (i < SYSTEME_SOLAIRE.size() - 1) json_cache += ",\n";
        else json_cache += "\n";
    }
    json_cache += "}";

    std::ofstream fichier_manifest("manifest.json");
    if (fichier_manifest.is_open()) { fichier_manifest << json_cache; fichier_manifest.close(); }

    int server_fd = socket(AF_INET, SOCK_STREAM, 0);
    int opt = 1; setsockopt(server_fd, SOL_SOCKET, SO_REUSEADDR, &opt, sizeof(opt));
    struct sockaddr_in address; address.sin_family = AF_INET;
    address.sin_addr.s_addr = INADDR_ANY; address.sin_port = htons(8080);
    bind(server_fd, (struct sockaddr*)&address, sizeof(address)); listen(server_fd, 20);

    std::cout << "[ONLINE] Sentinela Engine v8.3 opérationnel." << std::endl;

    while (true) {
        int new_socket = accept(server_fd, nullptr, nullptr);
        if (new_socket >= 0) {
            struct timeval tv; tv.tv_sec = 0; tv.tv_usec = 50000;
            setsockopt(new_socket, SOL_SOCKET, SO_RCVTIMEO, (const char*)&tv, sizeof(tv));

            // CORRECTION CRITIQUE : Augmentation à 8192 octets pour lire toute la requête du navigateur
            char buffer[8192] = {0}; 
            int octets_lus = read(new_socket, buffer, 8191);
            
            if (octets_lus <= 0) { close(new_socket); continue; }

            std::string requete(buffer);

            if (requete.find("OPTIONS") != std::string::npos) {
                std::string reponse = "HTTP/1.1 204 No Content\r\n"
                                      "Access-Control-Allow-Origin: *\r\n"
                                      "Access-Control-Allow-Methods: GET, OPTIONS\r\n"
                                      "Access-Control-Allow-Headers: *\r\n"
                                      "Connection: close\r\n\r\n";
                write(new_socket, reponse.c_str(), reponse.length());
            }
            else if (requete.find("GET /manifest.json") != std::string::npos) {
                // CORRECTION CRITIQUE : Ajout de Content-Length pour éviter les interruptions de flux
                std::string reponse = "HTTP/1.1 200 OK\r\n"
                                      "Content-Type: application/json; charset=UTF-8\r\n"
                                      "Content-Length: " + std::to_string(json_cache.length()) + "\r\n"
                                      "Access-Control-Allow-Origin: *\r\n"
                                      "Connection: close\r\n\r\n" + json_cache;
                write(new_socket, reponse.c_str(), reponse.length());
            }
            else {
                auto m_maintenant = std::chrono::system_clock::now();
                time_t m_temps_c = std::chrono::system_clock::to_time_t(m_maintenant);
                struct tm* m_utc = gmtime(&m_temps_c);
                double m_heureUTC = m_utc->tm_hour + m_utc->tm_min / 60.0 + m_utc->tm_sec / 3600.0;
                double m_joursJ2000 = (m_utc->tm_year - 100) * 365.25 + m_utc->tm_yday + (m_heureUTC / 24.0) - 1.5;

                std::string cartes_html = "";
                for (const auto& p : SYSTEME_SOLAIRE) {
                    HorizonCoords astre = calculerCoordonnees(p, m_joursJ2000, latitude, longitude, m_heureUTC, meteoLocale);
                    std::string vue = (astre.altitude > 0) ? "<span style='color:#2ea043;font-weight:bold;'>🟢 VISIBLE</span>" : "<span style='color:#8b949e;'>🔴 HORIZON INF</span>";
                    cartes_html += "<div class='card'>"
                                   "<h3>" + astre.symbole + " " + astre.nom + " <span class='status'>" + vue + "</span></h3>"
                                   "<div class='data'>🧭 AZIMUT : " + std::to_string(astre.azimut) + "°</div>"
                                   "<div class='data'>📐 ALTITUDE : " + std::to_string(astre.altitude) + "°</div>"
                                   "</div>";
                }

                std::string html_body = "<html><head><meta http-equiv='refresh' content='1'>"
                    "<style>body{background:#0d1117;color:#c9d1d9;font-family:monospace;padding:20px;text-align:center;}"
                    "h1{color:#58a6ff;}.hud-bar{background:#161b22;border:1px solid #30363d;padding:12px 25px;display:inline-block;border-radius:30px;font-size:12px;margin-bottom:25px;}"
                    ".card{border:1px solid #30363d;background:#161b22;padding:15px;margin:12px auto;width:440px;border-radius:10px;text-align:left;}"
                    ".card h3{margin:0 0 12px 0;color:#58a6ff;display:flex;justify-content:space-between;}"
                    ".data{font-size:15px;margin:6px 0;}</style></head>"
                    "<body><h1>SYSTEMA SENTINELA v8.3</h1>"
                    "<div class='hud-bar'>📍 LAT " + std::to_string(latitude) + " | LON " + std::to_string(longitude) + "</div>" + cartes_html + "</body></html>";

                std::string reponse = "HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=UTF-8\r\n"
                                      "Content-Length: " + std::to_string(html_body.length()) + "\r\n"
                                      "Access-Control-Allow-Origin: *\r\n"
                                      "Connection: close\r\n\r\n" + html_body;
                write(new_socket, reponse.c_str(), reponse.length());
            }
            close(new_socket);
        }
        std::this_thread::sleep_for(std::chrono::milliseconds(1));
    }
    close(server_fd); return 0;
}
